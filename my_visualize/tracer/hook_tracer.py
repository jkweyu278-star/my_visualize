import torch
import torch.nn as nn
from typing import Dict, List, Any
from .trace_node import TraceNode
from ..serializer.tensor_serializer import TensorSerializer

class HookDataFlowTracer:
    """
    nn.Module의 register_forward_hook 및 register_forward_pre_hook을 이용한 레이어 단위 추적.
    torch.fx가 실패할 경우 폴백으로 사용.
    """

    def __init__(self, model: nn.Module, serializer: TensorSerializer):
        self.model = model
        self.serializer = serializer
        self.trace_nodes: List[TraceNode] = []
        self._hooks = []
        self._execution_order: List[str] = []

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
                    output_heatmap=serialized['heatmap'],
                    module_type='Input',
                )
                self.trace_nodes.append(node)
                self._execution_order.append(name)
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
                output_heatmap=serialized['heatmap'],
                module_type=type(module).__name__,
            )
            # 이전 노드를 부모로 연결 (순차적 흐름 근사)
            if self._execution_order:
                # 모든 바로 직전의 node(들)을 부모로 연결
                node.input_node_ids = [self._execution_order[-1]]
                
            self.trace_nodes.append(node)
            self._execution_order.append(name)
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
                output_heatmap=serialized['heatmap'],
                module_type='Output',
            )
            if self._execution_order:
                node.input_node_ids = [self._execution_order[-1]]
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
