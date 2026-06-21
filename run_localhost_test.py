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

# Define 1-layer MLP
class OneLayerMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(10, 5)
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.fc(x))

def main():
    print("Step 1: Running 1-layer MLP and tracing it...")
    model = OneLayerMLP()
    x = torch.randn(2, 10)
    
    # Trace model (will output index.html via mock IPython)
    my_visualize(model, title="1-Layer MLP Localhost Test", x=x)
    
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
