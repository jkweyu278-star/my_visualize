import sys
import os
from http.server import SimpleHTTPRequestHandler
import socketserver

# Add my_visualize path to python path
sys.path.append('/Users/imjunhyeong/Projects/my_visualize')

# Mock IPython display to intercept HTML and save to index.html
class MockHTML:
    def __init__(self, html_str):
        self.html_str = html_str

class MockIPython:
    class display:
        @staticmethod
        def HTML(html_str):
            return MockHTML(html_str)
        @staticmethod
        def display(obj):
            if isinstance(obj, MockHTML):
                with open("index.html", "w", encoding="utf-8") as f:
                    full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Simple Transformer Encoder Debugger</title>
    <style>
        body {{
            background-color: #0b0f19;
            margin: 0;
            padding: 20px;
            color: #f1f5f9;
        }}
    </style>
</head>
<body>
    {obj.html_str}
</body>
</html>"""
                    f.write(full_html)
                print("[Localhost Test] Generated index.html successfully!")
            return obj

sys.modules['IPython'] = MockIPython
sys.modules['IPython.display'] = MockIPython.display

import torch
import torch.nn as nn
from my_visualize import my_visualize


# nn.TransformerEncoderLayer/nn.MultiheadAttention 같은 torch.nn 내장 모듈은
# torch.fx 기본 leaf-module 규칙(torch.nn 네임스페이스는 안을 들여다보지 않음)에
# 걸려 어텐션 내부 구조가 통째로 하나의 블랙박스 노드로 합쳐진다. 직접 풀어 쓰면
# fx가 Linear/LayerNorm 단위까지 내부를 추적해 시각화가 훨씬 더 풍부해진다.
class SimpleSelfAttention(nn.Module):
    def __init__(self, d_model, nhead):
        super().__init__()
        self.nhead = nhead
        self.head_dim = d_model // nhead
        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, d_model)
        self.out_proj = nn.Linear(d_model, d_model)

    def forward(self, x):
        b, t, d = x.shape
        q = self.q_proj(x).view(b, t, self.nhead, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(b, t, self.nhead, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(b, t, self.nhead, self.head_dim).transpose(1, 2)
        attn_scores = torch.matmul(q, k.transpose(-2, -1)) / (self.head_dim ** 0.5)
        attn_weights = torch.softmax(attn_scores, dim=-1)
        attn_out = torch.matmul(attn_weights, v)
        attn_out = attn_out.transpose(1, 2).reshape(b, t, d)
        return self.out_proj(attn_out)


class FeedForward(nn.Module):
    def __init__(self, d_model, dim_feedforward):
        super().__init__()
        self.linear1 = nn.Linear(d_model, dim_feedforward)
        self.activation = nn.ReLU()
        self.linear2 = nn.Linear(dim_feedforward, d_model)

    def forward(self, x):
        return self.linear2(self.activation(self.linear1(x)))


class SimpleTransformerLayer(nn.Module):
    def __init__(self, d_model, nhead, dim_feedforward):
        super().__init__()
        self.attn = SimpleSelfAttention(d_model, nhead)
        self.norm1 = nn.LayerNorm(d_model)
        self.ff = FeedForward(d_model, dim_feedforward)
        self.norm2 = nn.LayerNorm(d_model)

    def forward(self, x):
        x = self.norm1(x + self.attn(x))
        x = self.norm2(x + self.ff(x))
        return x


class SimpleTransformerEncoder(nn.Module):
    """임베딩 + Positional Embedding + N개의 SimpleTransformerLayer + 출력 헤드로
    구성된 작은 인코더형 트랜스포머."""

    def __init__(self, vocab_size=200, d_model=32, nhead=4, num_layers=2,
                 dim_feedforward=64, max_len=16):
        super().__init__()
        self.token_embedding = nn.Embedding(vocab_size, d_model)
        self.pos_embedding = nn.Embedding(max_len, d_model)
        # 속성 이름을 "layers"로 둬야 dag.js의 레이어 그룹 탐지 정규식
        # (layers?|h|block|blk)이 "layers.0", "layers.1" 묶음을 인식해
        # 반복 레이어를 접기/펼치기 그룹으로 보여줄 수 있다.
        self.layers = nn.ModuleList([
            SimpleTransformerLayer(d_model, nhead, dim_feedforward)
            for _ in range(num_layers)
        ])
        self.output_head = nn.Linear(d_model, vocab_size)

    def forward(self, input_ids):
        seq_len = input_ids.shape[1]
        positions = torch.arange(seq_len, device=input_ids.device).unsqueeze(0)
        x = self.token_embedding(input_ids) + self.pos_embedding(positions)
        for layer in self.layers:
            x = layer(x)
        return self.output_head(x)


def main():
    print("Step 1: Tracing a simple Transformer encoder with the real my_visualize() pipeline...")

    torch.manual_seed(0)
    model = SimpleTransformerEncoder()
    input_ids = torch.randint(0, 200, (1, 12))
    result = model(input_ids)

    my_visualize(
        model=model,
        result=result,
        title="Simple Transformer Encoder",
        input_ids=input_ids,
    )

    # Start web server (이미 돌고 있다면 allow_reuse_address에 의해 주소 공유되나 안전하게 포트 점유 에러 핸들링)
    port = 8080
    print(f"Step 2: Starting HTTP server on port {port}...")
    handler = SimpleHTTPRequestHandler
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    try:
        with socketserver.ThreadingTCPServer(("", port), handler) as httpd:
            print(f"Server is running at: http://localhost:{port}/")
            print("Press Ctrl+C to stop the server.")
            httpd.serve_forever()
    except Exception as e:
        print(f"[Localhost Server] 이미 실행 중이거나 포트가 열려 있습니다. 브라우저에서 http://localhost:{port}/ 를 확인하세요. ({e})")

if __name__ == '__main__':
    main()
