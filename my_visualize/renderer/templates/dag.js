// DAG 시각화 핵심 로직
// ============================================================

function initDAG() {
  try {
    const panelElement = document.getElementById(dagPanelId);

    if (!panelElement) {
      console.error('[my_visualize] dag-panel 엘리먼트를 찾을 수 없습니다:', dagPanelId);
      return;
    }

    // clientWidth가 0이면 getBoundingClientRect로 재시도
    let rawWidth = panelElement.clientWidth;
    if (rawWidth <= 0) {
      rawWidth = panelElement.getBoundingClientRect().width;
    }
    const WIDTH = (rawWidth > 0) ? rawWidth : 800;

    console.log('[my_visualize] DAG 초기화 시작 | 컨테이너 너비:', WIDTH, '| 노드:', nodes.length, '| 엣지:', edges.length);

    const HEIGHT = 550;
    const NODE_W = 130, NODE_H = 45;
    const arrowId = "arrow-" + uniqueId;

    // SVG 캔버스 생성
    const svg = d3.select('#' + dagPanelId)
      .append('svg')
      .attr('width', '100%')
      .attr('height', HEIGHT)
      .style('background', '#0b0f19')
      .style('border-radius', '8px')
      .call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => g.attr('transform', e.transform)));

    const g = svg.append('g');

    // 화살표 마커 정의
    svg.append('defs').append('marker')
      .attr('id', arrowId)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#818cf8');

    // 노드별 x/y 포지션 계산 (depth 기반 레이아웃)
    const depthGroups = d3.group(nodes, d => d.depth);
    const maxDepth = d3.max(nodes, d => d.depth) || 0;

    nodes.forEach(node => {
      const group = depthGroups.get(node.depth);
      const idx = group.indexOf(node);

      // X좌표: 깊이에 비례해서 배치
      if (maxDepth === 0) {
        node.x = WIDTH / 2 - NODE_W / 2;
      } else {
        node.x = (node.depth / maxDepth) * (WIDTH - NODE_W - 60) + 30;
      }

      // Y좌표: 해당 깊이의 노드 개수에 맞게 균등 배분
      node.y = (idx + 1) * (HEIGHT / (group.length + 1));
    });

    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    // 엣지(연결선) 렌더링
    g.selectAll('.edge')
      .data(edges)
      .join('line')
      .attr('class', 'edge')
      .attr('x1', d => {
        const s = nodeMap[d.source];
        return s ? s.x + NODE_W : 0;
      })
      .attr('y1', d => {
        const s = nodeMap[d.source];
        return s ? s.y : 0;
      })
      .attr('x2', d => {
        const t = nodeMap[d.target];
        return t ? t.x : 0;
      })
      .attr('y2', d => {
        const t = nodeMap[d.target];
        return t ? t.y : 0;
      })
      .attr('stroke', '#4f46e5')
      .attr('stroke-width', 2)
      .attr('marker-end', 'url(#' + arrowId + ')')
      .attr('opacity', 0.5)
      .attr('stroke-dasharray', d => {
        const t = nodeMap[d.target];
        return (t && t.op_type === 'output') ? '4 4' : 'none';
      });

    // 노드 렌더링
    const nodeGroups = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x}, ${d.y - NODE_H / 2})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        // 이전 선택 취소하고 현재 선택 강조
        g.selectAll('.node rect').attr('stroke', '#334155').attr('stroke-width', 1.5);
        d3.select(e.currentTarget).select('rect').attr('stroke', '#c084fc').attr('stroke-width', 2.5);
        showDataPanel(d);
      })
      .on('mouseover', function(e, d) {
        const rect = d3.select(this).select('rect');
        if (rect.attr('stroke') !== '#c084fc') {
          rect.attr('stroke', '#818cf8').attr('stroke-width', 2);
        }
      })
      .on('mouseout', function(e, d) {
        const rect = d3.select(this).select('rect');
        if (rect.attr('stroke') !== '#c084fc') {
          rect.attr('stroke', '#334155').attr('stroke-width', 1.5);
        }
      });

    // 노드 박스
    nodeGroups.append('rect')
      .attr('width', NODE_W)
      .attr('height', NODE_H)
      .attr('rx', 8)
      .attr('fill', d => getNodeColor(d.op_type))
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5);

    // 노드 라벨 (이름)
    nodeGroups.append('text')
      .attr('x', NODE_W / 2).attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f1f5f9')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .text(d => d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name);

    // 노드 shape 표시
    nodeGroups.append('text')
      .attr('x', NODE_W / 2).attr('y', 33)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', 9)
      .attr('font-family', 'monospace')
      .text(d => d.output_shape ? `[${d.output_shape.join('×')}]` : '[]');

    console.log('[my_visualize] ✅ DAG 렌더링 완료 | 노드:', nodes.length, '| 엣지:', edges.length);

  } catch(err) {
    console.error('[my_visualize] ❌ DAG 렌더링 오류:', err);

    // dag-panel에 오류 메시지 표시
    const panelEl = document.getElementById(dagPanelId);
    if (panelEl) {
      panelEl.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;
                    height:200px; color:#f87171; text-align:center; padding:16px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" style="margin-bottom:8px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p style="margin:0; font-size:12px; font-weight:600;">DAG 렌더링 오류 (버전: ${typeof version !== 'undefined' ? version : 'unknown (kernel reload required)'})</p>
          <p style="margin:4px 0 0 0; font-size:10px; color:#94a3b8; word-break:break-all; max-width:300px;">
            ${err.message || String(err)}
          </p>
        </div>`;
    }
  }
}

// 색상 매핑
function getNodeColor(opType) {
  const colors = {
    'input':          '#1e3a8a',
    'call_module':    '#4c1d95',
    'call_function':  '#064e3b',
    'call_method':    '#78350f',
    'output':         '#881337',
  };
  return colors[opType] || '#1f2937';
}

// DOM paint 보장 후 실행:
// - VS Code Jupyter: script 실행 시 DOM이 아직 layout되지 않을 수 있으므로
//   requestAnimationFrame으로 한 프레임 뒤에 실행
// - Colab / 일반 Jupyter: 이미 완료된 상태이므로 즉시 실행
let dagInitialized = false;
function safeInitDAG() {
  if (dagInitialized) return;
  dagInitialized = true;
  requestAnimationFrame(function() { initDAG(); });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  safeInitDAG();
} else {
  window.addEventListener('DOMContentLoaded', safeInitDAG);
  window.addEventListener('load', safeInitDAG);
}
