from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

@dataclass
class TraceNode:
    node_id: str              # 고유 ID (예: "block_0_linear")
    name: str                 # 표시 이름 (예: "Linear")
    op_type: str              # 연산 종류 (예: "call_module", "call_function")
    target: str               # 실제 타깃 (예: "torch.nn.functional.relu")

    # 연결 정보
    input_node_ids: List[str] = field(default_factory=list)  # 부모 노드 ID들

    # 입력 텐서 정보
    input_shapes: List[List[int]] = field(default_factory=list)

    # 출력 텐서 정보
    output_shape: Optional[List[int]] = None
    output_dtype: Optional[str] = None

    # 실제 데이터 통계
    output_stats: Dict[str, float] = field(default_factory=dict)
    # {mean, std, min, max, norm}

    # 시각화용 샘플 데이터 (최대 256개 원소, 균일 샘플링)
    output_sample: List[float] = field(default_factory=list)

    # 원본 순서 그대로의 맨 앞 원소들 (예: "처음 8개 차원")
    output_head_values: List[float] = field(default_factory=list)

    # 2D 히트맵용 데이터 (텐서가 2D 이상일 경우)
    output_heatmap: Optional[List[List[float]]] = None

    # 메타 정보
    depth: int = 0            # 레이어 깊이 (레이아웃용)
    module_type: str = ""     # nn.Linear, nn.LayerNorm 등

    def to_dict(self) -> Dict[str, Any]:
        """JSON 직렬화"""
        return {
            'id': self.node_id,
            'name': self.name,
            'op_type': self.op_type,
            'target': self.target,
            'inputs': self.input_node_ids,
            'input_shapes': self.input_shapes,
            'output_shape': self.output_shape,
            'output_dtype': self.output_dtype,
            'stats': self.output_stats,
            'sample': self.output_sample,
            'head_values': self.output_head_values,
            'heatmap': self.output_heatmap,
            'depth': self.depth,
            'module_type': self.module_type,
        }
