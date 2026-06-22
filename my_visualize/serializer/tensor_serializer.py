import torch
from typing import Any, Dict, List, Optional

class TensorSerializer:
    """
    텐서를 JSON 직렬화 가능한 형태로 변환.
    - 메모리 효율을 위해 최대 샘플 크기 제한
    - 2D 출력은 히트맵으로 변환
    """

    MAX_SAMPLE_SIZE = 256      # 샘플 최대 원소 수
    MAX_HEATMAP_DIM = (32, 32) # 히트맵 최대 크기
    HEAD_VALUES_COUNT = 8      # 패널에 "실제값"으로 보여줄 맨 앞 원소 개수

    def _extract_tensor(self, val: Any) -> Optional[torch.Tensor]:
        if isinstance(val, torch.Tensor):
            return val
        if isinstance(val, (list, tuple)):
            for item in val:
                t = self._extract_tensor(item)
                if t is not None:
                    return t
        if isinstance(val, dict):
            for k, v in val.items():
                t = self._extract_tensor(v)
                if t is not None:
                    return t
        return None

    def serialize(self, tensor: Any) -> Dict:
        """텐서 → 직렬화 딕셔너리 변환"""
        extracted = self._extract_tensor(tensor)
        if extracted is None:
            return self._empty_result()

        t = extracted.detach().cpu().float()
        shape = list(t.shape)
        dtype = str(extracted.dtype)

        stats = self._compute_stats(t)
        sample = self._get_sample(t)
        heatmap = self._get_heatmap(t)
        head_values = self._get_head_values(t)

        return {
            'shape': shape,
            'dtype': dtype,
            'stats': stats,
            'sample': sample,
            'heatmap': heatmap,
            'head_values': head_values,
        }

    def _compute_stats(self, t: torch.Tensor) -> Dict[str, float]:
        flat = t.flatten().float()
        if flat.numel() == 0:
            return {}
        # NaN 이나 Inf 처리
        flat = flat[torch.isfinite(flat)]
        if flat.numel() == 0:
            return {
                'mean': 0.0,
                'std': 0.0,
                'min': 0.0,
                'max': 0.0,
                'norm': 0.0,
                'numel': t.numel(),
            }
        return {
            'mean': float(flat.mean()),
            'std': float(flat.std()) if flat.numel() > 1 else 0.0,
            'min': float(flat.min()),
            'max': float(flat.max()),
            'norm': float(flat.norm()),
            'numel': t.numel(),
        }

    def _get_sample(self, t: torch.Tensor) -> List[float]:
        # NaN/Inf 필터링
        flat = t.flatten()
        flat = flat[torch.isfinite(flat)]
        if flat.numel() == 0:
            return []
        if flat.numel() > self.MAX_SAMPLE_SIZE:
            # 균일 샘플링
            indices = torch.linspace(0, flat.numel() - 1, self.MAX_SAMPLE_SIZE).long()
            flat = flat[indices]
        return [round(float(v), 6) for v in flat.tolist()]

    def _get_head_values(self, t: torch.Tensor) -> List[float]:
        """원본 순서 그대로 맨 앞 원소들을 반환 (sample()과 달리 균일 샘플링하지
        않으므로 텐서가 커도 "처음 N개 차원" 그 자체를 보여줄 수 있다)."""
        flat = t.flatten()[:self.HEAD_VALUES_COUNT]
        return [round(float(v), 6) for v in flat.tolist()]

    def _get_heatmap(self, t: torch.Tensor) -> Optional[List[List[float]]]:
        """2D 이상 텐서를 2D 히트맵으로 압축"""
        # NaN/Inf 필터링
        t = torch.where(torch.isfinite(t), t, torch.tensor(0.0, device=t.device))
        
        if t.dim() < 2:
            return None

        # 마지막 2차원으로 축소 (batch, seq_len, dim → seq_len, dim)
        while t.dim() > 2:
            if t.shape[0] == 1:
                t = t[0]
            else:
                t = t.mean(dim=0)

        # 크기 제한
        h, w = self.MAX_HEATMAP_DIM
        if t.shape[0] > h:
            indices = torch.linspace(0, t.shape[0] - 1, h).long()
            t = t[indices]
        if t.shape[1] > w:
            indices = torch.linspace(0, t.shape[1] - 1, w).long()
            t = t[:, indices]

        # 정규화 [-1, 1]
        min_v, max_v = float(t.min()), float(t.max())
        if max_v > min_v:
            t = (t - min_v) / (max_v - min_v) * 2 - 1
        else:
            t = torch.zeros_like(t)

        return t.tolist()

    def _empty_result(self) -> Dict:
        return {'shape': [], 'dtype': 'unknown', 'stats': {}, 'sample': [], 'heatmap': None, 'head_values': []}
