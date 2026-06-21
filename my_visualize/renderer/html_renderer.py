import os
import json
import uuid
from typing import Dict
from IPython.display import display, HTML


def _detect_environment() -> str:
    """실행 환경 감지 (Colab / VS Code / 일반 Jupyter)"""
    try:
        import google.colab  # noqa: F401
        return "colab"
    except ImportError:
        pass

    # VS Code Jupyter 감지
    if os.environ.get("VSCODE_PID") or os.environ.get("TERM_PROGRAM") == "vscode":
        return "vscode"

    # 일반 Jupyter 환경
    return "jupyter"


class HtmlRenderer:
    VERSION = "v0.1.6-base64"

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
        env = _detect_environment()
        node_count = len(graph_json.get('nodes', []))
        edge_count = len(graph_json.get('edges', []))

        print(f"[my_visualize] 🎨 렌더링 시작 | 환경: {env} | 노드: {node_count}개 | 엣지: {edge_count}개")

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
        html, body {{
          background-color: #0b0f19;
          margin: 0;
          padding: 0;
          overflow: hidden;
        }}
        @keyframes fadeIn {{
          from {{ opacity: 0; transform: translateY(4px); }}
          to   {{ opacity: 1; transform: translateY(0); }}
        }}
        </style>

        <div id="viz-container-{unique_id}" class="viz-container">
          <h3 class="viz-title">{title}</h3>
          <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            <div id="dag-panel-{unique_id}" class="dag-panel" style="position: relative; flex: 2.2; min-width: 450px; border: 1px solid #1e293b; border-radius: 12px; background: #0b0f19;">
              <!-- 범주(Legend) 좌하단 배치 -->
              <div class="dag-legend" style="position: absolute; bottom: 12px; left: 12px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px); border: 1px solid #1e293b; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #94a3b8; z-index: 10; pointer-events: none; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 2px;">범주 (Node Type)</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; display: inline-block;"></span>
                  <span>Input</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #a855f7; display: inline-block;"></span>
                  <span>Module (레이어)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                  <span>Function (함수)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; display: inline-block;"></span>
                  <span>Method (메서드)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444; display: inline-block;"></span>
                  <span>Output</span>
                </div>
              </div>
            </div>
            <div id="data-panel-{unique_id}" class="data-panel" style="flex: 1; min-width: 250px; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; background: #0f172a; color: #f1f5f9; max-height: 550px; overflow-y: auto;">
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 250px; text-align: center; color: #64748b;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <p style="margin: 0; font-size: 13px;">노드를 클릭하면<br>실제 입출력 텐서의 시각화와 통계가 표시됩니다.</p>
                <p style="margin: 8px 0 0 0; font-size: 10px; color: #475569;">환경: {env} | 노드: {node_count}개</p>
              </div>
            </div>
          </div>
        </div>

        <script>
        (function() {{
            // 글로벌 JS 오류 핸들러: 오류 발생 시 data-panel에 표시
            var _origOnerror = window.onerror;
            window.onerror = function(msg, src, line, col, err) {{
                console.error('[my_visualize] 전역 JS 오류 캡처 | ' + msg + ' @ ' + src + ':' + line);
                var panel = document.getElementById("data-panel-{unique_id}");
                if (panel) {{
                    panel.innerHTML = '<div style="color:#f87171; padding:16px; font-size:12px;">' +
                        '<strong>⚠️ JS 렌더링 오류 발생</strong><br><br>' +
                        '<span style="color:#94a3b8;">' + msg + '</span><br>' +
                        '<span style="color:#475569; font-size:10px;">' + src + ':' + line + ':' + col + '</span>' +
                        '</div>';
                }}
                if (typeof _origOnerror === 'function') _origOnerror(msg, src, line, col, err);
                return false;
            }};

            // 환경 정보 콘솔 출력
            console.log('[my_visualize] 실행 환경:', '{env}', '| 고유 ID:', '{unique_id}');

            const uniqueId = "{unique_id}";
            const dagPanelId = "dag-panel-{unique_id}";
            const dataPanelId = "data-panel-{unique_id}";
            const version = "{self.VERSION}";

            const nodes = {nodes_json};
            const edges = {edges_json};

            // panel.js 와 dag.js를 여기에 인라인 삽입하여 실행
            {d3_content}
            {panel_js}
            {dag_js}
        }})();
        </script>
        """

        # 주피터 노트북에 HTML 렌더링 시도 (RequireJS 및 특수문자 이스케이프 깨짐 방지를 위해 base64 iframe 격리 렌더링)
        import base64
        encoded_html = base64.b64encode(html.encode('utf-8')).decode('utf-8')
        iframe_html = f"""
        <iframe src="data:text/html;charset=utf-8;base64,{encoded_html}" 
                width="100%" 
                height="620px" 
                frameborder="0" 
                style="border: none; border-radius: 12px; background: #0b0f19;">
        </iframe>
        """
        display(HTML(iframe_html))
        print(f"[my_visualize] ✅ 렌더링 완료 | 환경: {env}")

        # 로컬 파일로 추가 저장 (VS Code 주피터 뷰어에서 인라인 스크립트 실행이 완전 차단될 때를 대비한 폴백)
        output_filename = os.path.join(os.getcwd(), "my_visualize_output.html")
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
            print(f"[my_visualize] 💾 폴백 HTML 저장: {output_filename}")
            print(f"[my_visualize]    → 브라우저에서 직접 열거나 VS Code '파일 열기'로 확인 가능")
        except Exception as e:
            print(f"[my_visualize] ⚠️ 파일 저장 실패: {e}")
