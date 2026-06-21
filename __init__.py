import torch
import torch.nn as nn
from typing import Any, List

from .tracer.fx_tracer import FxDataFlowTracer
from .tracer.hook_tracer import HookDataFlowTracer
from .serializer.tensor_serializer import TensorSerializer
from .renderer.html_renderer import HtmlRenderer

def my_visualize(
    model: nn.Module,
    result: Any = None,
    title: str = "Data Flow Visualization",
    max_nodes: int = 200,
    **inputs
):
    """
    AI 모델의 데이터 흐름을 추적하고 Colab에 인터랙티브 시각화를 렌더링합니다.

    Parameters
    ----------
    model : nn.Module
        추적할 PyTorch 모델
    result : Any, optional
        모델의 최종 출력 (참조용, 추적에는 내부 실행 결과 사용)
    title : str
        시각화 제목
    max_nodes : int
        표시할 최대 노드 수 (큰 모델에서 성능 제한)
    **inputs :
        모델 입력값 (input1=A1, input2=A2, ...)

    Example
    -------
    >>> import torch
    >>> from my_visualize import my_visualize
    >>>
    >>> model = MyModel()
    >>> A1 = torch.randn(1, 128)
    >>> A2 = torch.randn(1, 64)
    >>> RESULT = model(A1, A2)
    >>>
    >>> my_visualize(model=model, input1=A1, input2=A2, result=RESULT)
    """
    if not inputs:
        raise ValueError("[my_visualize] 에러: 추적을 진행할 입력 데이터(예: input1=A1)가 최소 하나 이상 필요합니다.")

    # 모델의 학습/평가 모드 상태 기억
    was_training = model.training
    model.eval()

    serializer = TensorSerializer()
    renderer = HtmlRenderer()
    input_names = list(inputs.keys())
    input_values = list(inputs.values())

    graph_json = None
    method = ""

    # 1. torch.fx 시도
    try:
        tracer = FxDataFlowTracer(model, serializer)
        tracer.run(*input_values)
        graph_json = tracer.get_trace_graph()
        method = "fx"
        print(f"[my_visualize] ✅ torch.fx 추적 성공 ({len(graph_json['nodes'])}개 노드)")

    except Exception as fx_error:
        # torch.fx 실패 시 forward hook으로 폴백
        print(f"[my_visualize] ⚠️ torch.fx 실패 ({fx_error}), hook 방식으로 폴백합니다.")
        
        tracer = HookDataFlowTracer(model, serializer)
        tracer.register_hooks(input_names=input_names)
        
        try:
            with torch.no_grad():
                model(*input_values)
            graph_json = tracer.get_trace_graph()
            method = "hook"
            print(f"[my_visualize] ✅ Hook 추적 성공 ({len(graph_json['nodes'])}개 노드)")
        except Exception as hook_error:
            print(f"[my_visualize] ❌ Hook 추적도 실패했습니다: {hook_error}")
            raise hook_error
        finally:
            tracer.remove_hooks()

    # 모델 모드 원상 복구
    if was_training:
        model.train()

    if graph_json is None:
        raise RuntimeError("[my_visualize] 에러: 그래프 생성에 실패했습니다.")

    # 3. 노드 수 제한
    if len(graph_json['nodes']) > max_nodes:
        print(f"[my_visualize] ⚠️ 노드 {len(graph_json['nodes'])}개 → 상위 {max_nodes}개로 제한")
        graph_json['nodes'] = graph_json['nodes'][:max_nodes]
        allowed_ids = {n['id'] for n in graph_json['nodes']}
        graph_json['edges'] = [
            e for e in graph_json['edges']
            if e['source'] in allowed_ids and e['target'] in allowed_ids
        ]

    # 4. 렌더링
    renderer.render(graph_json, title=f"{title} [{method} mode]")

__all__ = ['my_visualize']
