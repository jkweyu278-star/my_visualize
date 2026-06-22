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
    <title>mmContext Multimodal Debugger</title>
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

from my_visualize.renderer.html_renderer import HtmlRenderer

def main():
    print("Step 1: Generating Mock mmContext Tracing data...")

    # Nodes 리스트 생성
    nodes = [
        # --- [PART 1] 오믹스 타워 (Omics Tower) ---
        {
            "id": "omics_input",
            "name": "omics_input",
            "op_type": "input",
            "depth": 0,
            "output_shape": [1, 1],
            "target": "sample_idx:SRX9415983",
            "output_dtype": "string"
        },
        {
            "id": "omics_encoder.embeddings",
            "name": "omics_encoder.embeddings",
            "op_type": "call_module",
            "depth": 1,
            "output_shape": [1, 10000],
            "target": "omics_encoder.embeddings (Embedding Lookup)",
            "output_dtype": "float32",
            "stats": {
                "mean": 0.174465,
                "std": 0.374994,
                "L2 Norm": 41.3575
            },
            "sample": [0.0, 0.0, 0.0, 0.000249, 0.0, 0.0, 0.0, 0.000747, 0.0, 0.000498]
        },
        {
            "id": "omics_adapter.net.0",
            "name": "omics_adapter.net.0",
            "op_type": "call_module",
            "depth": 2,
            "output_shape": [1, 1024],
            "target": "omics_adapter.net.0 (Linear: 10000 ──> 1024)",
            "output_dtype": "float32",
            "stats": {
                "mean": -0.3333,
                "std": 0.2602,
                "L2 Norm": 13.5296
            },
            "sample": [-0.30047, -0.08734, -0.34185, -0.31589, 0.05524]
        },
        {
            "id": "omics_adapter.net.1",
            "name": "omics_adapter.net.1",
            "op_type": "call_module",
            "depth": 3,
            "output_shape": [1, 1024],
            "target": "omics_adapter.net.1 (ReLU)",
            "output_dtype": "float32",
            "stats": {
                "mean": 0.0035,
                "std": 0.0174,
                "L2 Norm": 0.5673
            },
            "sample": [0.0, 0.0, 0.0, 0.0, 0.05524]
        },
        {
            "id": "omics_adapter.net.2",
            "name": "omics_adapter.net.2",
            "op_type": "call_module",
            "depth": 4,
            "output_shape": [1, 2048],
            "target": "omics_adapter.net.2 (Linear: 1024 ──> 2048)",
            "output_dtype": "float32",
            "stats": {
                "mean": -0.0003,
                "std": 0.0209,
                "L2 Norm": 0.9479
            },
            "sample": [0.00827, 0.01492, -0.01133, 0.02030, -0.02560]
        },
        {
            "id": "omics_adapter.net.3",
            "name": "omics_adapter.net.3",
            "op_type": "call_module",
            "depth": 5,
            "output_shape": [1, 2048],
            "target": "omics_adapter.net.3 (BatchNorm1d)",
            "output_dtype": "float32",
            "stats": {
                "mean": -0.0051,
                "std": 0.2345,
                "L2 Norm": 10.6144
            },
            "sample": [0.07031, 0.21684, -0.20886, 0.06009, -0.16613]
        },

        # --- [PART 2] 텍스트 타워 (Text Tower) ---
        {
            "id": "text_input",
            "name": "text_input",
            "op_type": "input",
            "depth": 0,
            "output_shape": [1, 58],
            "target": "This measurement was conducted with NextSeq 500. A cultured cell line...",
            "output_dtype": "string"
        },
        {
            "id": "text_encoder.embeddings",
            "name": "text_encoder.embeddings",
            "op_type": "call_module",
            "depth": 1,
            "output_shape": [1, 58, 768],
            "target": "text_encoder.embeddings (Embedding Layer)",
            "output_dtype": "float32",
            "stats": {
                "mean": 0.0038,
                "std": 0.4185,
                "L2 Norm": 11.5443
            },
            "sample": [0.11041, 0.29012, 0.01755, -0.36340, 0.41793]
        }
    ]

    # PubMedBERT 12개 레이어 데이터 주입
    means = [-0.0162, -0.0151, -0.0160, -0.0157, -0.0169, -0.0176, -0.0218, -0.0175, -0.0197, -0.0204, -0.0312, -0.0140]
    stds = [0.5796, 0.5319, 0.5612, 0.5769, 0.6440, 0.7050, 0.7656, 0.6913, 0.7300, 0.7354, 0.7523, 0.5892]
    norms = [16.0346, 14.7119, 15.5346, 15.9626, 17.8265, 19.5181, 21.2141, 19.1466, 20.1495, 20.2660, 20.8468, 16.3313]

    for i in range(12):
        nodes.append({
            "id": f"text_encoder.layer.{i}",
            "name": f"text_encoder.layer.{i}",
            "op_type": "call_module",
            "depth": 2 + i,
            "output_shape": [1, 58, 768],
            "target": f"text_encoder.layer.{i} (Transformer Layer)",
            "output_dtype": "float32",
            "stats": {
                "mean": means[i],
                "std": stds[i],
                "L2 Norm": norms[i]
            }
        })

    # 어댑터 및 Pooling 추가
    nodes.extend([
        {
            "id": "text_cls_pooling",
            "name": "text_cls_pooling",
            "op_type": "call_function",
            "depth": 14,
            "output_shape": [1, 768],
            "target": "select_cls_token ([CLS] Pooling)",
            "output_dtype": "float32",
            "stats": {
                "mean": -0.0083,
                "std": 0.6244,
                "L2 Norm": 17.2949
            },
            "sample": [-0.24683, 0.23303, 0.63190, -0.22831, -0.65114]
        },
        {
            "id": "text_adapter.net.0",
            "name": "text_adapter.net.0",
            "op_type": "call_module",
            "depth": 15,
            "output_shape": [1, 1024],
            "target": "text_adapter.net.0 (Linear: 768 ──> 1024)",
            "output_dtype": "float32",
            "stats": {
                "mean": -0.1589,
                "std": 0.3186,
                "L2 Norm": 11.3887
            },
            "sample": [0.42673, -0.30846, -0.09362, 0.01045, -0.00480]
        },
        {
            "id": "text_adapter.net.1",
            "name": "text_adapter.net.1",
            "op_type": "call_module",
            "depth": 16,
            "output_shape": [1, 1024],
            "target": "text_adapter.net.1 (ReLU)",
            "output_dtype": "float32",
            "stats": {
                "mean": 0.0593,
                "std": 0.1222,
                "L2 Norm": 4.3447
            },
            "sample": [0.42673, 0.0, 0.0, 0.01045, 0.0]
        },
        {
            "id": "text_adapter.net.2",
            "name": "text_adapter.net.2",
            "op_type": "call_module",
            "depth": 17,
            "output_shape": [1, 2048],
            "target": "text_adapter.net.2 (Linear: 1024 ──> 2048)",
            "output_dtype": "float32",
            "stats": {
                "mean": 0.0014,
                "std": 0.1149,
                "L2 Norm": 5.1969
            },
            "sample": [0.15179, -0.10324, 0.10982, 0.12481, 0.14245]
        },
        {
            "id": "text_adapter.net.3",
            "name": "text_adapter.net.3",
            "op_type": "call_module",
            "depth": 18,
            "output_shape": [1, 2048],
            "target": "text_adapter.net.3 (BatchNorm1d)",
            "output_dtype": "float32",
            "stats": {
                "mean": 0.0115,
                "std": 0.9935,
                "L2 Norm": 44.9523
            },
            "sample": [1.23336, -0.68871, 1.25727, 0.76399, 1.09768]
        },
        # --- [PART 3] 코사인 유사도 연산 (Alignment) ---
        {
            "id": "cosine_similarity",
            "name": "cosine_similarity",
            "op_type": "call_function",
            "depth": 19,
            "output_shape": [1],
            "target": "cosine_similarity(omics_embedding, text_embedding)",
            "output_dtype": "float32",
            "stats": {
                "omics L2 Norm (||A||)": 10.614351,
                "text L2 Norm (||B||)": 44.952309,
                "dot product (A · B)": 22.767433,
                "normalizer (||A|| * ||B||)": 477.139595,
                "cosine similarity (Cos θ)": 0.047717
            }
        },
        {
            "id": "similarity_output",
            "name": "similarity_output",
            "op_type": "output",
            "depth": 20,
            "output_shape": [1],
            "target": "output",
            "output_dtype": "float32"
        }
    ])

    # Edges 리스트 생성
    edges = [
        # 오믹스 타워 흐름
        {"source": "omics_input", "target": "omics_encoder.embeddings", "op_type": "input"},
        {"source": "omics_encoder.embeddings", "target": "omics_adapter.net.0", "op_type": "call_module"},
        {"source": "omics_adapter.net.0", "target": "omics_adapter.net.1", "op_type": "call_module"},
        {"source": "omics_adapter.net.1", "target": "omics_adapter.net.2", "op_type": "call_module"},
        {"source": "omics_adapter.net.2", "target": "omics_adapter.net.3", "op_type": "call_module"},
        {"source": "omics_adapter.net.3", "target": "cosine_similarity", "op_type": "call_function"},

        # 텍스트 타워 흐름
        {"source": "text_input", "target": "text_encoder.embeddings", "op_type": "input"},
        {"source": "text_encoder.embeddings", "target": "text_encoder.layer.0", "op_type": "call_module"}
    ]

    for i in range(11):
        edges.append({"source": f"text_encoder.layer.{i}", "target": f"text_encoder.layer.{i+1}", "op_type": "call_module"})

    edges.extend([
        {"source": "text_encoder.layer.11", "target": "text_cls_pooling", "op_type": "call_function"},
        {"source": "text_cls_pooling", "target": "text_adapter.net.0", "op_type": "call_module"},
        {"source": "text_adapter.net.0", "target": "text_adapter.net.1", "op_type": "call_module"},
        {"source": "text_adapter.net.1", "target": "text_adapter.net.2", "op_type": "call_module"},
        {"source": "text_adapter.net.2", "target": "text_adapter.net.3", "op_type": "call_module"},
        {"source": "text_adapter.net.3", "target": "cosine_similarity", "op_type": "call_function"},

        # 최종 출력
        {"source": "cosine_similarity", "target": "similarity_output", "op_type": "output"}
    ])

    graph_json = {
        "nodes": nodes,
        "edges": edges
    }

    # 렌더링 호출 (로컬 index.html 및 my_visualize_output.html 저장)
    renderer = HtmlRenderer()
    renderer.render(graph_json, title="mmContext Multimodal Precision Debugger (v0.2.0)")

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
