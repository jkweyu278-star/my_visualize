import torch
import torch.fx
from typing import Any, Dict, List
from .trace_node import TraceNode
from ..serializer.tensor_serializer import TensorSerializer

class FxDataFlowTracer(torch.fx.Interpreter):
    """
    torch.fx.Interpreter를 상속.
    모델의 각 연산(op)을 실행하면서 입출력 텐서의 실제 값과 통계를 기록.
    """

    def __init__(self, module: torch.nn.Module, serializer: TensorSerializer):
        # symbolic_trace를 사용해 모델을 graph module로 변환
        graph_module = torch.fx.symbolic_trace(module)
        super().__init__(graph_module)
        self.serializer = serializer
        self.trace_nodes: List[TraceNode] = []
        self._node_map: Dict[str, TraceNode] = {}  # node.name → TraceNode

    def run_node(self, node: torch.fx.Node) -> Any:
        # 부모 클래스에서 실제 연산 실행
        result = super().run_node(node)

        # placeholder(입력), output(최종출력), get_attr(파라미터) 처리
        if node.op == 'placeholder':
            trace_node = self._make_input_node(node, result)
        elif node.op == 'output':
            trace_node = self._make_output_node(node, result)
        elif node.op in ('call_module', 'call_function', 'call_method'):
            trace_node = self._make_op_node(node, result)
        else:
            return result

        self.trace_nodes.append(trace_node)
        self._node_map[node.name] = trace_node
        return result

    def _make_input_node(self, node: torch.fx.Node, result: Any) -> TraceNode:
        serialized = self.serializer.serialize(result)
        return TraceNode(
            node_id=node.name,
            name=f"Input: {node.name}",
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

    def _make_output_node(self, node: torch.fx.Node, result: Any) -> TraceNode:
        input_ids = [n.name for n in node.all_input_nodes if n.name in self._node_map]
        input_shapes = []
        for n in node.all_input_nodes:
            if n.name in self._node_map:
                input_shapes.append(self._node_map[n.name].output_shape or [])

        serialized = self.serializer.serialize(result)
        return TraceNode(
            node_id=node.name,
            name="Output",
            op_type='output',
            target='output',
            input_node_ids=input_ids,
            input_shapes=input_shapes,
            output_shape=serialized['shape'],
            output_dtype=serialized['dtype'],
            output_stats=serialized['stats'],
            output_sample=serialized['sample'],
            output_head_values=serialized['head_values'],
            output_heatmap=serialized['heatmap'],
            module_type='Output',
        )

    def _make_op_node(self, node: torch.fx.Node, result: Any) -> TraceNode:
        # 입력 노드 ID 목록 수집
        input_ids = [n.name for n in node.all_input_nodes if n.name in self._node_map]

        # 입력 shape 수집
        input_shapes = []
        for n in node.all_input_nodes:
            if n.name in self._node_map:
                input_shapes.append(self._node_map[n.name].output_shape or [])

        # target 이름 추출
        if node.op == 'call_module':
            submodule = dict(self.module.named_modules()).get(str(node.target))
            module_type = type(submodule).__name__ if submodule else str(node.target)
            target_str = f"{module_type}"
        else:
            target_str = str(node.target)
            module_type = target_str.split('.')[-1]

        serialized = self.serializer.serialize(result)

        return TraceNode(
            node_id=node.name,
            name=module_type,
            op_type=node.op,
            target=target_str,
            input_node_ids=input_ids,
            input_shapes=input_shapes,
            output_shape=serialized['shape'],
            output_dtype=serialized['dtype'],
            output_stats=serialized['stats'],
            output_sample=serialized['sample'],
            output_head_values=serialized['head_values'],
            output_heatmap=serialized['heatmap'],
            module_type=module_type,
        )

    def get_trace_graph(self) -> Dict:
        """JSON 직렬화 가능한 그래프 반환"""
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
