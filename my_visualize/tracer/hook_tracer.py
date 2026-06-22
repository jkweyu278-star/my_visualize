import re
import torch
import torch.nn as nn
from typing import Dict, List, Any, Optional
from .trace_node import TraceNode
from ..serializer.tensor_serializer import TensorSerializer

class HookDataFlowTracer:
    """
    nn.Module의 register_forward_hook 및 register_forward_pre_hook을 이용한 레이어 단위 추적.
    torch.fx가 실패할 경우 폴백으로 사용.
    """

    # cosine_similarity 같은 합성 함수형 연산은 sum/div/mul 등의 기본 텐서 연산으로
    # 분해되어 grad_fn에 그 디테일만 남는다. 이런 이름은 의미가 없으므로 병합 노드
    # 라벨로 쓰지 않고 일반적인 "Merge"로 대체한다.
    _GENERIC_GRAD_FN_NAMES = {
        'Sum', 'Mul', 'Div', 'Add', 'Sub', 'Clone', 'Mean', 'Pow', 'Sqrt',
        'View', 'Reshape', 'Expand', 'T', 'Permute', 'Copy', 'ToCopy',
        'Unsqueeze', 'Squeeze', 'Norm', 'LinalgVectorNorm', 'AccumulateGrad',
    }

    def __init__(self, model: nn.Module, serializer: TensorSerializer):
        self.model = model
        self.serializer = serializer
        self.trace_nodes: List[TraceNode] = []
        self._hooks = []
        self._execution_order: List[str] = []
        # 텐서 객체 identity(id) 및 메모리 주소(data_ptr) -> 이 텐서를 만든 노드 id.
        # 실행 순서가 아니라 실제로 어떤 노드의 출력 텐서가 입력으로 쓰였는지를 추적해
        # 두 개 이상의 독립된 분기(예: 듀얼 타워)가 한 forward 안에서 실행될 때도
        # 정확한 부모-자식 엣지를 복원하기 위함.
        self._tensor_to_node: Dict[int, str] = {}
        # register_tensors가 끝나면 지역변수(hook의 inp/out)가 스코프를 벗어나
        # 텐서가 GC될 수 있는데, 그러면 파이썬/PyTorch가 같은 id()/data_ptr()를
        # 다른 텐서에 재사용해서 엉뚱한 과거 노드와 잘못 매칭될 수 있다(특히 동일
        # shape 텐서가 빠르게 생성/소멸되는 깊은 모델에서 자주 발생). 트레이싱이
        # 끝날 때까지 모든 텐서를 강하게 참조해 GC/주소 재사용을 막는다.
        self._kept_tensors: List[torch.Tensor] = []

    def register_hooks(self, input_names: List[str] = None):
        """모든 leaf 모듈 및 메인 모델에 hook 등록"""
        # 1. 메인 모델 pre-hook (입력 캡처)
        pre_hook = self.model.register_forward_pre_hook(self._make_pre_hook(input_names))
        self._hooks.append(pre_hook)

        # 2. leaf 모듈 forward hook (연산 캡처)
        for name, module in self.model.named_modules():
            if name == "":
                continue
            if len(list(module.children())) == 0:  # leaf only
                hook = module.register_forward_hook(self._make_hook(name, module))
                self._hooks.append(hook)

        # 3. 메인 모델 forward hook (최종 출력 캡처)
        post_hook = self.model.register_forward_hook(self._make_post_hook())
        self._hooks.append(post_hook)

    def register_tensors(self, obj: Any, node_id: str):
        """obj(텐서 또는 텐서를 담은 dict/list/tuple) 내의 모든 텐서를 node_id가 생성한 것으로 등록"""
        if isinstance(obj, torch.Tensor):
            self._kept_tensors.append(obj)  # GC로 인한 id()/data_ptr() 재사용 방지
            self._tensor_to_node[id(obj)] = node_id
            try:
                if obj.device.type != 'meta' and obj.layout == torch.strided:
                    self._tensor_to_node[obj.data_ptr()] = node_id
            except Exception:
                pass
        elif isinstance(obj, dict):
            for v in obj.values():
                self.register_tensors(v, node_id)
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                self.register_tensors(item, node_id)

    def find_inputs(self, obj: Any) -> List[str]:
        """obj 내의 텐서들을 만든 노드 id 목록을 (등록된 적이 있다면) 찾아 반환"""
        res = []
        if isinstance(obj, torch.Tensor):
            if id(obj) in self._tensor_to_node:
                res.append(self._tensor_to_node[id(obj)])
            else:
                try:
                    if obj.device.type != 'meta' and obj.layout == torch.strided:
                        ptr = obj.data_ptr()
                        if ptr in self._tensor_to_node:
                            res.append(self._tensor_to_node[ptr])
                except Exception:
                    pass
        elif isinstance(obj, dict):
            for v in obj.values():
                res.extend(self.find_inputs(v))
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                res.extend(self.find_inputs(item))
        return list(dict.fromkeys(res))  # 순서를 유지한 중복 제거

    def _find_first_tensor(self, obj: Any) -> Optional[torch.Tensor]:
        """출력값(텐서/딕셔너리/ModelOutput 등) 안에서 대표 텐서 하나를 찾아 반환"""
        if isinstance(obj, torch.Tensor):
            return obj
        if hasattr(obj, 'last_hidden_state'):
            return self._find_first_tensor(obj.last_hidden_state)
        if isinstance(obj, dict):
            for v in obj.values():
                t = self._find_first_tensor(v)
                if t is not None:
                    return t
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                t = self._find_first_tensor(item)
                if t is not None:
                    return t
        return None

    def _make_pre_hook(self, input_names: List[str] = None):
        def pre_hook(module, inp):
            for i, val in enumerate(inp):
                name = input_names[i] if (input_names and i < len(input_names)) else f"input_{i}"
                serialized = self.serializer.serialize(val)
                node = TraceNode(
                    node_id=name,
                    name=f"Input: {name}",
                    op_type='input',
                    target='input',
                    output_shape=serialized['shape'],
                    output_dtype=serialized['dtype'],
                    output_stats=serialized['stats'],
                    output_sample=serialized['sample'],
                    output_head_values=serialized['head_values'],
                    output_heatmap=serialized['heatmap'],
                    module_type='Input',
                )
                self.trace_nodes.append(node)
                self._execution_order.append(name)
                self.register_tensors(val, name)
        return pre_hook

    def _make_hook(self, name: str, module: nn.Module):
        def hook(mod, inp, out):
            serialized = self.serializer.serialize(out)
            # 입력 shape들 수집
            input_shapes = []
            for i in inp:
                if isinstance(i, torch.Tensor):
                    input_shapes.append(list(i.shape))
                elif isinstance(i, (list, tuple)):
                    for item in i:
                        if isinstance(item, torch.Tensor):
                            input_shapes.append(list(item.shape))

            node = TraceNode(
                node_id=name,
                name=type(module).__name__,
                op_type='call_module',
                target=name,
                input_shapes=input_shapes,
                output_shape=serialized['shape'],
                output_dtype=serialized['dtype'],
                output_stats=serialized['stats'],
                output_sample=serialized['sample'],
                output_head_values=serialized['head_values'],
                output_heatmap=serialized['heatmap'],
                module_type=type(module).__name__,
            )

            # 실제 입력 텐서의 출처(identity)를 추적해 진짜 부모를 찾는다.
            # 여러 독립된 분기(듀얼 타워 등)가 한 forward 안에서 실행될 때
            # "직전에 실행된 노드"는 다른 분기의 노드일 수 있으므로 신뢰할 수 없다.
            matched_inputs = self.find_inputs(inp)
            if not matched_inputs and self._execution_order:
                # 텐서 추적으로 못 찾은 경우(in-place 연산 등)에 한해서만
                # 실행 순서 기반 추정으로 폴백
                matched_inputs = [self._execution_order[-1]]
            node.input_node_ids = matched_inputs

            self.trace_nodes.append(node)
            self._execution_order.append(name)
            self.register_tensors(out, name)
        return hook

    def _make_post_hook(self):
        def post_hook(module, inp, out):
            serialized = self.serializer.serialize(out)
            node = TraceNode(
                node_id="output",
                name="Output",
                op_type='output',
                target='output',
                output_shape=serialized['shape'],
                output_dtype=serialized['dtype'],
                output_stats=serialized['stats'],
                output_sample=serialized['sample'],
                output_head_values=serialized['head_values'],
                output_heatmap=serialized['heatmap'],
                module_type='Output',
            )

            # leaf 노드: 추적된 call_module/call_function 노드 중 다른 어떤 노드의
            # 입력으로도 쓰이지 않은 "가지 끝" (= 아직 합쳐지지 않은 분기의 끝)
            consumed_ids = {pid for n in self.trace_nodes for pid in n.input_node_ids}
            leaf_ids = [
                n.node_id for n in self.trace_nodes
                if n.node_id not in consumed_ids and n.op_type != 'input'
            ]

            final_parents = leaf_ids
            if len(leaf_ids) >= 2:
                # 2개 이상의 분기가 합쳐지는 지점. cosine_similarity, torch.cat 등의
                # 병합 연산은 보통 nn.Module이 아닌 함수형 호출이라 hook이 잡지 못하므로,
                # 두 분기 사이에 명시적인 merge 노드를 만들어 끼워 넣는다.
                # 가능하면 최종 출력 텐서의 grad_fn에서 연산 이름을 얻어 라벨로 쓰지만,
                # cosine_similarity처럼 sum/div/mul 등으로 분해되는 합성 연산은 grad_fn이
                # 그 내부 구현 디테일(예: "Sum")을 가리킬 뿐 의미있는 이름이 아니므로,
                # 그런 경우엔 일반적인 "Merge" 라벨로 대체한다.
                merge_tensor = self._find_first_tensor(out)
                grad_fn = getattr(merge_tensor, 'grad_fn', None) if merge_tensor is not None else None
                merge_name = None
                if grad_fn is not None:
                    raw_name = re.sub(r'Backward\d*$', '', type(grad_fn).__name__)
                    if raw_name and raw_name not in self._GENERIC_GRAD_FN_NAMES:
                        merge_name = raw_name
                merge_name = merge_name or 'Merge'

                merge_id = f"merge::{merge_name}::{len(self.trace_nodes)}"
                merge_node = TraceNode(
                    node_id=merge_id,
                    name=merge_name,
                    op_type='call_function',
                    target=merge_name,
                    input_node_ids=leaf_ids,
                    output_shape=serialized['shape'],
                    output_dtype=serialized['dtype'],
                    output_stats=serialized['stats'],
                    output_sample=serialized['sample'],
                    output_head_values=serialized['head_values'],
                    output_heatmap=serialized['heatmap'],
                    module_type=merge_name,
                )
                self.trace_nodes.append(merge_node)
                self._execution_order.append(merge_id)
                final_parents = [merge_id]

            if not final_parents and self._execution_order:
                final_parents = [self._execution_order[-1]]

            node.input_node_ids = final_parents
            self.trace_nodes.append(node)
            self._execution_order.append("output")
        return post_hook

    def remove_hooks(self):
        for h in self._hooks:
            h.remove()
        self._hooks.clear()

    def get_trace_graph(self) -> Dict:
        self._assign_depths()
        return {
            'nodes': [n.to_dict() for n in self.trace_nodes],
            'edges': [
                {'source': inp_id, 'target': n.node_id}
                for n in self.trace_nodes
                for inp_id in n.input_node_ids
            ]
        }

    def _assign_depths(self):
        """DAG 레이아웃을 위한 레이어 깊이 계산 (위상 정렬)"""
        id_to_node = {n.node_id: n for n in self.trace_nodes}
        for node in self.trace_nodes:
            if not node.input_node_ids:
                node.depth = 0
            else:
                parent_depths = [id_to_node[pid].depth for pid in node.input_node_ids if pid in id_to_node]
                node.depth = max(parent_depths, default=0) + 1
