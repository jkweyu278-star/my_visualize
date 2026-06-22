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

    // 1. 모든 그룹 수집 및 초기화 (최초 1회 전부 collapsed 상태)
    const allGroupKeys = new Set(nodes.map(n => getNodeGroup(n.id)).filter(g => g !== null));
    const collapsedGroups = new Set();
    
    // 2개 이상의 노드를 가진 그룹만 기본적으로 축소 처리
    const groupNodeCounts = d3.rollup(nodes, v => v.length, n => getNodeGroup(n.id));
    allGroupKeys.forEach(key => {
      if ((groupNodeCounts.get(key) || 0) > 1) {
        collapsedGroups.add(key);
      }
    });

    const padding = 15;

    function renderGraph() {
      // 캔버스 초기화
      g.selectAll('*').remove();

      // 2. 활성 노드 목록 구축
      const activeNodes = [];
      const addedCollapsedGroups = new Set();

      nodes.forEach(node => {
        const group = getNodeGroup(node.id);
        if (group && collapsedGroups.has(group)) {
          if (!addedCollapsedGroups.has(group)) {
            addedCollapsedGroups.add(group);
            activeNodes.push({
              id: group,
              name: getGroupLabel(group),
              op_type: 'call_module',
              isGroupNode: true,
              groupKey: group,
              depth: node.depth,
              output_shape: null,
              target: group
            });
          }
          // 가상 노드의 depth를 이 그룹에 속한 최소 depth로 맞춤
          const virtualNode = activeNodes.find(n => n.id === group);
          if (virtualNode && node.depth < virtualNode.depth) {
            virtualNode.depth = node.depth;
          }
        } else {
          activeNodes.push({
            ...node,
            isGroupNode: false
          });
        }
      });

      // 3. 활성 연결선 목록 구축 및 중복 제거
      const getActiveId = (nodeId) => {
        const group = getNodeGroup(nodeId);
        if (group && collapsedGroups.has(group)) {
          return group;
        }
        return nodeId;
      };

      const uniqueEdges = new Map();
      edges.forEach(e => {
        const s = getActiveId(e.source);
        const t = getActiveId(e.target);
        if (s !== t) {
          const key = `${s}->${t}`;
          if (!uniqueEdges.has(key)) {
            uniqueEdges.set(key, { source: s, target: t, op_type: e.op_type });
          }
        }
      });
      const activeEdges = Array.from(uniqueEdges.values());

      // 4. 활성 노드 기반 depth 레이아웃 계산 (Flexible Constant Spacing)
      const DEPTH_SPACING = 150; // 각 단계별 고정 가로 간격
      
      // 활성화된 모든 노드들의 고유 depth 값 수집 및 정렬
      const uniqueDepths = Array.from(new Set(activeNodes.map(d => d.depth))).sort((a, b) => a - b);
      const totalGraphWidth = (uniqueDepths.length - 1) * DEPTH_SPACING;
      
      // 컨테이너 너비(WIDTH)보다 그래프 전체 가로 길이가 작으면 중앙 정렬, 크면 고정 마진 50px에서 시작
      const startX = (totalGraphWidth < (WIDTH - 100)) ? (WIDTH - totalGraphWidth) / 2 : 50;

      const depthGroups = d3.group(activeNodes, d => d.depth);

      activeNodes.forEach(node => {
        const group = depthGroups.get(node.depth);
        const idx = group.indexOf(node);

        const depthIdx = uniqueDepths.indexOf(node.depth);
        node.x = startX + (depthIdx * DEPTH_SPACING);
        node.y = (idx + 1) * (HEIGHT / (group.length + 1));
      });


      const activeNodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));

      // 5. 확장된(그룹이 해제된) 레이어 박스 그리기
      const expandedGroups = Array.from(allGroupKeys).filter(g => !collapsedGroups.has(g) && (groupNodeCounts.get(g) || 0) > 1);
      
      const expandedGroupBounds = expandedGroups.map(key => {
        const groupNodes = activeNodes.filter(n => getNodeGroup(n.id) === key);
        if (groupNodes.length === 0) return null;
        
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
      }).filter(b => b !== null);

      const groupG = g.append('g').attr('class', 'groups');
      const groupElements = groupG.selectAll('.group-container')
        .data(expandedGroupBounds)
        .join('g')
        .attr('class', 'group-container')
        .style('cursor', 'pointer')
        .on('click', (e, d) => {
          e.stopPropagation();
          // 클릭 시 다시 축소
          collapsedGroups.add(d.key);
          renderGraph();
        });

      groupElements.append('rect')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('width', d => d.width)
        .attr('height', d => d.height)
        .attr('rx', 8)
        .attr('fill', 'rgba(30, 41, 59, 0.12)')
        .attr('stroke', 'rgba(129, 140, 248, 0.25)')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4 4')
        .append('title')
        .text(d => `클릭 시 레이어 축소: ${d.label}`);

      groupElements.append('text')
        .attr('x', d => d.x + 8)
        .attr('y', d => d.y + 12)
        .attr('fill', '#818cf8')
        .attr('font-size', 9)
        .attr('font-weight', 600)
        .attr('font-family', 'sans-serif')
        .text(d => `${d.label.toUpperCase()} [-]`);

      // 6. 연결선(Edge) 렌더링
      g.selectAll('.edge')
        .data(activeEdges)
        .join('line')
        .attr('class', 'edge')
        .attr('x1', d => {
          const s = activeNodeMap[d.source];
          const radius = s && s.isGroupNode ? 12 : NODE_R;
          return s ? s.x + radius : 0;
        })
        .attr('y1', d => {
          const s = activeNodeMap[d.source];
          return s ? s.y : 0;
        })
        .attr('x2', d => {
          const t = activeNodeMap[d.target];
          const radius = t && t.isGroupNode ? 12 : NODE_R;
          return t ? t.x - radius : 0;
        })
        .attr('y2', d => {
          const t = activeNodeMap[d.target];
          return t ? t.y : 0;
        })
        .attr('stroke', '#4f46e5')
        .attr('stroke-width', 2)
        .attr('marker-end', 'url(#' + arrowId + ')')
        .attr('opacity', 0.5)
        .attr('stroke-dasharray', d => {
          const t = activeNodeMap[d.target];
          return (t && t.op_type === 'output') ? '4 4' : 'none';
        });

      // 7. 노드 렌더링
      const nodeGroups = g.selectAll('.node')
        .data(activeNodes)
        .join('g')
        .attr('class', 'node')
        .attr('transform', d => `translate(${d.x}, ${d.y})`)
        .style('cursor', 'pointer')
        .on('click', (e, d) => {
          e.stopPropagation();
          if (d.isGroupNode) {
            // 그룹 노드 클릭 시 확장
            collapsedGroups.delete(d.groupKey);
            renderGraph();
          } else {
            // 일반 노드 클릭 시 기존 데이터 업데이트
            g.selectAll('.node circle').attr('stroke', '#334155').attr('stroke-width', 1.5).attr('r', n => n.isGroupNode ? 12 : NODE_R);
            d3.select(e.currentTarget).select('circle').attr('stroke', '#c084fc').attr('stroke-width', 2.5).attr('r', 10);
            showDataPanel(d);
          }
        })
        .on('mouseover', function(e, d) {
          const circle = d3.select(this).select('circle');
          const maxR = d.isGroupNode ? 15 : 10;
          if (circle.attr('stroke') !== '#c084fc') {
            circle.attr('stroke', '#818cf8').attr('stroke-width', 2).attr('r', maxR);
          } else {
            circle.attr('r', maxR);
          }
        })
        .on('mouseout', function(e, d) {
          const circle = d3.select(this).select('circle');
          const origR = d.isGroupNode ? 12 : NODE_R;
          if (circle.attr('stroke') !== '#c084fc') {
            circle.attr('stroke', d.isGroupNode ? '#818cf8' : '#334155').attr('stroke-width', d.isGroupNode ? 2.5 : 1.5).attr('r', origR);
          } else {
            circle.attr('r', origR);
          }
        });

      // 원형 노드 추가
      nodeGroups.append('circle')
        .attr('r', d => d.isGroupNode ? 12 : NODE_R)
        .attr('fill', d => getNodeColor(d.op_type))
        .attr('stroke', d => d.isGroupNode ? '#818cf8' : '#334155')
        .attr('stroke-width', d => d.isGroupNode ? 2.5 : 1.5)
        .attr('stroke-dasharray', d => d.isGroupNode ? '3 2' : 'none')
        .style('transition', 'r 0.15s ease, stroke-width 0.15s ease');

      // 그룹 노드일 때 중앙에 '+' 텍스트 추가
      nodeGroups.filter(d => d.isGroupNode)
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#f1f5f9')
        .attr('font-size', '13px')
        .attr('font-weight', 'bold')
        .attr('pointer-events', 'none')
        .text('+');

      // 툴팁 설정
      nodeGroups.append('title')
        .text(d => {
          if (d.isGroupNode) {
            return `레이어 그룹: ${d.name}\n클릭 시 내부 노드 확장`;
          }
          const shapeStr = d.output_shape ? `[${d.output_shape.join('×')}]` : '[]';
          return `${d.name}\n종류: ${d.op_type}\n대상: ${d.target}\n크기: ${shapeStr}`;
        });
    }

    // 초기 그래프 렌더링 호출
    renderGraph();
    console.log('[my_visualize] ✅ DAG 초기화 완료');

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
  // 1. layers.N, layer.N, h.N, block.N 등 레이어 패턴 매칭 (점, 언더바, 또는 구분자 없음 모두 지원)
  const match = nodeId.match(/^(.*?\b(layers?|h|block|blk)[._]?\d+)/i);
  if (match) {
    return match[1];
  }
  // 2. 일반 계층 구조인 경우 마지막 세그먼트를 제외한 상위 전체를 그룹으로 사용
  const parts = nodeId.split('.');
  if (parts.length > 1) {
    return parts.slice(0, parts.length - 1).join('.');
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
