import os
import json
import uuid
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
        # 고유 ID 생성 (페이지 내 다중 위젯 충돌 방지)
        unique_id = f"viz_{uuid.uuid4().hex[:8]}"

        nodes_json = json.dumps(graph_json['nodes'])
        edges_json = json.dumps(graph_json['edges'])

        css_content = self._read_file('style.css')
        d3_content = self._read_file('d3.v7.min.js')
        dag_js = self._read_file('dag.js')
        panel_js = self._read_file('panel.js')

        # D3.js 라이브러리를 CDN에서 받아오지 않고 로컬에서 인라인 번들링하여
        # VS Code 등의 외부 네트워크(CDN) 차단 환경(CSP)을 완전히 우회합니다.
        html = f"""
        <style>
        {css_content}
        </style>
        
        <div id="viz-container-{unique_id}" class="viz-container">
          <h3 class="viz-title">{title}</h3>
          <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            <div id="dag-panel-{unique_id}" class="dag-panel" style="flex: 2.2; min-width: 450px; border: 1px solid #1e293b; border-radius: 12px; background: #0b0f19;"></div>
            <div id="data-panel-{unique_id}" class="data-panel" style="flex: 1; min-width: 250px; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; background: #0f172a; color: #f1f5f9; max-height: 550px; overflow-y: auto;">
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
            // 인라인 D3.js 번들 로드
            {d3_content}

            const uniqueId = "{unique_id}";
            const dagPanelId = "dag-panel-{unique_id}";
            const dataPanelId = "data-panel-{unique_id}";

            const nodes = {nodes_json};
            const edges = {edges_json};

            // panel.js 와 dag.js를 여기에 인라인 삽입하여 실행
            {panel_js}
            {dag_js}
        }})();
        </script>
        """
        
        # 주피터 노트북에 HTML 렌더링 시도
        display(HTML(html))

        # 로컬 파일로 추가 저장 (VS Code 주피터 뷰어에서 인라인 스크립트 실행이 완전 차단될 때를 대비한 폴백)
        output_filename = "my_visualize_output.html"
        try:
            full_page_html = f"""<!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>{title}</title>
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
                {html}
            </body>
            </html>"""
            
            with open(output_filename, 'w', encoding='utf-8') as f:
                f.write(full_page_html)
            print(f"[my_visualize] 💾 시각화 결과가 파일로 저장되었습니다: {output_filename} (더블 클릭하여 브라우저/VS Code 탭에서 직접 열어보실 수 있습니다)")
        except Exception as e:
            pass
