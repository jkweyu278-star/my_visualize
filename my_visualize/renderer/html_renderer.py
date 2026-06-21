import os
import json
from typing import Dict
from IPython.display import display, HTML

class HtmlRenderer:
    def __init__(self):
        # templates 디렉토리의 파일들을 읽어서 로드
        self.current_dir = os.path.dirname(os.path.abspath(__file__))
        self.templates_dir = os.path.join(self.current_dir, 'templates')

    def _read_file(self, filename: str) -> str:
        path = os.path.join(self.templates_dir, filename)
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return f.read()
        return ""

    def render(self, graph_json: Dict, title: str = "Data Flow Visualization"):
        nodes_json = json.dumps(graph_json['nodes'])
        edges_json = json.dumps(graph_json['edges'])

        css_content = self._read_file('style.css')
        dag_js = self._read_file('dag.js')
        panel_js = self._read_file('panel.js')

        # D3가 로드된 상태에서 로직을 실행하도록 IIFE(즉시 실행 함수) 및 동적 로드 사용
        html = f"""
        <style>
        {css_content}
        </style>
        
        <div id="viz-container">
          <h3 class="viz-title">{title}</h3>
          <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            <div id="dag-panel" style="flex: 2.2; min-width: 450px; border: 1px solid #1e293b; border-radius: 12px; background: #0b0f19;"></div>
            <div id="data-panel" style="flex: 1; min-width: 250px; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; background: #0f172a; color: #f1f5f9; max-height: 550px; overflow-y: auto;">
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 250px; text-align: center; color: #64748b;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <p style="margin: 0; font-size: 13px;">노드를 클릭하면<br>실제 입출력 텐서의 시각화와 통계가 표시됩니다.</p>
              </div>
            </div>
          </div>
        </div>
        
        <script>
        (function() {{
            function loadD3(callback) {{
                if (window.d3) {{
                    callback();
                    return;
                }}
                var script = document.createElement("script");
                script.type = "text/javascript";
                script.src = "https://d3js.org/d3.v7.min.js";
                script.onload = callback;
                document.head.appendChild(script);
            }}

            loadD3(function() {{
                const nodes = {nodes_json};
                const edges = {edges_json};

                // panel.js 와 dag.js를 여기에 인라인 삽입하여 실행
                {panel_js}
                {dag_js}
            }});
        }})();
        </script>
        """
        display(HTML(html))
