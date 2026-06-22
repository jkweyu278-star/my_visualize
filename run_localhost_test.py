import sys
import os
import torch
import torch.nn as nn
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
                    # Wrap in a full HTML page boilerplate for browser rendering
                    full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>my_visualize Localhost Test</title>
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

from my_visualize import my_visualize

# Define nested MLP for grouping and 3D tensor shape tests
class Block1(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Linear(10, 24)
        self.act = nn.ReLU()

    def forward(self, x):
        out = self.act(self.conv(x))
        return out.view(2, 3, 8)  # Shape [2, 3, 8] -> W=2, D=3, H=8

class Block2(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Linear(48, 4000)
        self.act = nn.ReLU()

    def forward(self, x):
        # x is [2, 3, 8], we flatten it to [2, 24] or [1, 48]
        x_flat = x.view(1, 48)
        out = self.act(self.conv(x_flat))
        return out.view(1, 4, 1000)  # Shape [1, 4, 1000] -> W=1, D=4, H=1000

class NestedMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.layer1 = Block1()
        self.layer2 = Block2()

    def forward(self, x):
        return self.layer2(self.layer1(x))

def main():
    print("Step 1: Running Nested MLP with 3D outputs and tracing it...")
    model = NestedMLP()
    x = torch.randn(2, 10)
    
    # Trace model (will output index.html via mock IPython)
    my_visualize(model, title="3D Tensor Expansion & Truncation Localhost Test (v0.2.0)", x=x)
    
    # Start web server
    port = 8080
    print(f"Step 2: Starting HTTP server on port {port}...")
    
    handler = SimpleHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"Server is running at: http://localhost:{port}/")
        print("Press Ctrl+C to stop the server.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server...")
            httpd.shutdown()

if __name__ == '__main__':
    main()
