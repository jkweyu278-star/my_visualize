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
    const NODE_R = 7;
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
      .attr('refX', NODE_R + 6).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
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

      // X좌표: 깊이에 비례해서 배치 (원의 중심 기준)
      if (maxDepth === 0) {
        node.x = WIDTH / 2;
      } else {
        node.x = (node.depth / maxDepth) * (WIDTH - 80) + 40;
      }

      // Y좌표: 해당 깊이의 노드 개수에 맞게 균등 배분
      node.y = (idx + 1) * (HEIGHT / (group.length + 1));
    });

    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    // 그룹 바운딩 박스(Bounding Box) 계산 및 렌더링
    const groups = d3.groups(nodes.filter(n => getNodeGroup(n.id) !== null), n => getNodeGroup(n.id))
      .filter(([key, groupNodes]) => groupNodes.length > 1);

    const padding = 15;
    const groupBounds = groups.map(([key, groupNodes]) => {
      const xs = groupNodes.map(n => n.x);
      const ys = groupNodes.map(n => n.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return {
        key: key,
        label: getGroupLabel(key),
        x: minX - padding,
        y: minY - padding - 8,
        width: (maxX - minX) + 2 * padding,
        height: (maxY - minY) + 2 * padding + 8
      };
    });

    const groupG = g.append('g').attr('class', 'groups');

    const groupElements = groupG.selectAll('.group-container')
      .data(groupBounds)
      .join('g')
      .attr('class', 'group-container');

    groupElements.append('rect')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .attr('width', d => d.width)
      .attr('height', d => d.height)
      .attr('rx', 8)
      .attr('fill', 'rgba(30, 41, 59, 0.15)')
      .attr('stroke', 'rgba(129, 140, 248, 0.25)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4');

    groupElements.append('text')
      .attr('x', d => d.x + 8)
      .attr('y', d => d.y + 12)
      .attr('fill', '#818cf8')
      .attr('font-size', 9)
      .attr('font-weight', 600)
      .attr('font-family', 'sans-serif')
      .text(d => d.label.toUpperCase());

    // 엣지(연결선) 렌더링
    g.selectAll('.edge')
      .data(edges)
      .join('line')
      .attr('class', 'edge')
      .attr('x1', d => {
        const s = nodeMap[d.source];
        return s ? s.x + NODE_R : 0;
      })
      .attr('y1', d => {
        const s = nodeMap[d.source];
        return s ? s.y : 0;
      })
      .attr('x2', d => {
        const t = nodeMap[d.target];
        return t ? t.x - NODE_R : 0;
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

    // 노드 렌더링 (원형 노드로 변경)
    const nodeGroups = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x}, ${d.y})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        // 이전 선택 취소하고 현재 선택 강조
        g.selectAll('.node circle').attr('stroke', '#334155').attr('stroke-width', 1.5).attr('r', NODE_R);
        d3.select(e.currentTarget).select('circle').attr('stroke', '#c084fc').attr('stroke-width', 2.5).attr('r', 10);
        showDataPanel(d);
      })
      .on('mouseover', function(e, d) {
        const circle = d3.select(this).select('circle');
        if (circle.attr('stroke') !== '#c084fc') {
          circle.attr('stroke', '#818cf8').attr('stroke-width', 2).attr('r', 10);
        } else {
          circle.attr('r', 10);
        }
      })
      .on('mouseout', function(e, d) {
        const circle = d3.select(this).select('circle');
        if (circle.attr('stroke') !== '#c084fc') {
          circle.attr('stroke', '#334155').attr('stroke-width', 1.5).attr('r', NODE_R);
        } else {
          circle.attr('r', NODE_R);
        }
      });

    // 원형 노드 추가
    nodeGroups.append('circle')
      .attr('r', NODE_R)
      .attr('fill', d => getNodeColor(d.op_type))
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5)
      .style('transition', 'r 0.15s ease, stroke-width 0.15s ease');

    // 마우스 호버 시 보여줄 상세 툴팁 지정 (네이티브 SVG 툴팁)
    nodeGroups.append('title')
      .text(d => {
        const shapeStr = d.output_shape ? `[${d.output_shape.join('×')}]` : '[]';
        return `${d.name}\n종류: ${d.op_type}\n대상: ${d.target}\n크기: ${shapeStr}`;
      });

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

// 색상 매핑 (선명한 네온 컬러)
function getNodeColor(opType) {
  const colors = {
    'input':          '#3b82f6',
    'call_module':    '#a855f7',
    'call_function':  '#10b981',
    'call_method':    '#f59e0b',
    'output':         '#ef4444',
  };
  return colors[opType] || '#64748b';
}

// 상위 모듈 그룹 탐지 헬퍼
function getNodeGroup(nodeId) {
  if (!nodeId) return null;
  // 1. layers.N, layer.N, h.N, block.N 등 레이어 패턴 매칭
  const match = nodeId.match(/^(.*?\b(layers?|h|block|blk)\.\d+)/i);
  if (match) {
    return match[1];
  }
  // 2. 일반 계층 구조인 경우 첫 3개 세그먼트를 그룹으로 사용
  const parts = nodeId.split('.');
  if (parts.length > 2) {
    return parts.slice(0, 3).join('.');
  }
  return null;
}

// 그룹 키를 인간 친화적인 라벨로 단순화
function getGroupLabel(groupKey) {
  const parts = groupKey.split('.');
  if (parts.length >= 2) {
    for (let i = 0; i < parts.length; i++) {
      if (/^(layers?|h|block|blk|layer)$/i.test(parts[i]) && i + 1 < parts.length) {
        return parts[i] + '.' + parts[i+1];
      }
    }
  }
  return parts.slice(-2).join('.');
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
