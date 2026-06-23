// DAG 시각화 핵심 로직
// ============================================================
//
// 레이아웃 엔진: dagre (Sugiyama 스타일 레이어드 그래프 알고리즘)
// - rank 할당(network-simplex), 레이어 내 순서 결정(median heuristic 기반
//   교차 최소화), 좌표 할당(Brandes-Köpf)을 모두 dagre.layout()이 처리한다.
// - 이전 구현은 브랜치 이름에 "omics"/"text" 문자열이 포함되는지로 분기를
//   하드코딩 판별하고, 같은 레이어 내 노드 순서를 알파벳 정렬로만 정했다.
//   이 두 가지가 "임의의 모델에서 범용적으로 동작하지 않음"과 "엣지가
//   꼬여 보임" 두 증상의 직접적인 원인이었으므로, 레이어/순서/좌표 계산을
//   전부 dagre에 위임해 브랜치 개수나 이름에 무관하게 동작하도록 한다.
// - 레이어 그룹 접기/펼치기, 텐서 격자 확장, 패널 클릭 등 인터랙션은
//   기존 그대로 유지한다. dagre는 좌표만 계산할 뿐 렌더링에는 관여하지 않는다.

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
    const GROUP_R = 12;
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

    // 1-2. 텐서 격자 확장 및 세로 생략(Truncation) 상태 관리용 Set
    const expandedTensors = new Set();
    const fullyExpandedTensors = new Set();

    // 텐서 shape 파서 헬퍼: [W, D, H] 반환
    function parseTensorShape(shape) {
      if (!shape || !Array.isArray(shape) || shape.length === 0) {
        return { w: 1, d: 1, h: 1 };
      }
      if (shape.length === 1) {
        return { w: shape[0], d: 1, h: 1 };
      }
      if (shape.length === 2) {
        return { w: shape[0], d: 1, h: shape[1] };
      }
      // 3차원 이상
      return { w: shape[0], d: shape[1], h: shape[2] };
    }

    // 텐서가 격자로 확장됐을 때 보이는 행(row) 개수 (생략 버튼/접기 버튼 포함)
    function getVisibleRowCount(nodeId, h) {
      if (h <= 10) return h;
      if (fullyExpandedTensors.has(nodeId)) return h + 1; // + 접기 버튼
      return 11; // 5 + 생략버튼 + 5
    }

    function getRowsToGen(nodeId, h) {
      const rowsToGen = [];
      if (h <= 10 || fullyExpandedTensors.has(nodeId)) {
        for (let r = 0; r < h; r++) rowsToGen.push({ r, type: 'normal' });
        if (h > 10 && fullyExpandedTensors.has(nodeId)) rowsToGen.push({ r: h, type: 'collapse_btn' });
      } else {
        for (let r = 0; r < 5; r++) rowsToGen.push({ r, type: 'normal' });
        rowsToGen.push({ r: 5, type: 'omitted_btn' });
        for (let r = h - 5; r < h; r++) rowsToGen.push({ r, type: 'normal' });
      }
      return rowsToGen;
    }

    const padding = 15;
    const ROW_SPACING = 10;     // 텐서 격자 내부 행 간격
    const NODE_D = NODE_R * 2;
    const GROUP_D = GROUP_R * 2;
    const CELL_W = 60;          // 텐서 격자 1개 열이 가로로 차지하는 예약 폭
    const NODE_SEP = 18;        // dagre: 같은 rank 내 노드 간 간격
    const RANK_SEP = 50;        // dagre: rank(레이어) 간 간격

    // 상위 모듈 그룹으로 축소돼 있을 때의 대표 id (그룹키), 아니면 원래 id
    function getSkeletonId(origId) {
      const group = getNodeGroup(origId);
      if (group && collapsedGroups.has(group)) return group;
      return origId;
    }

    function renderGraph() {
      // 캔버스 초기화
      g.selectAll('*').remove();

      // 1. 그룹 축소 상태만 반영한 "스켈레톤" 그래프 구성 (텐서 격자 확장은
      //    스켈레톤 단계에서는 단일 노드의 width/height 예약으로만 반영하고,
      //    실제 격자 분해는 dagre 레이아웃이 끝난 뒤 2단계에서 수행한다.)
      const skeleton = new Map(); // skeletonId -> { isGroupNode, origNode?, width, height }

      nodes.forEach(node => {
        const group = getNodeGroup(node.id);
        if (group && collapsedGroups.has(group)) {
          if (!skeleton.has(group)) {
            skeleton.set(group, { isGroupNode: true, groupKey: group, width: GROUP_D, height: GROUP_D });
          }
        } else if (!skeleton.has(node.id)) {
          let width = NODE_D, height = NODE_D;
          if (expandedTensors.has(node.id)) {
            const { w, h } = parseTensorShape(node.output_shape);
            const visibleRows = getVisibleRowCount(node.id, h);
            width = Math.max(NODE_D, w * CELL_W);
            height = Math.max(NODE_D, visibleRows * ROW_SPACING);
          }
          skeleton.set(node.id, { isGroupNode: false, origNode: node, width, height });
        }
      });

      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP });
      dagreGraph.setDefaultEdgeLabel(() => ({}));
      skeleton.forEach((entry, sid) => {
        dagreGraph.setNode(sid, { width: entry.width, height: entry.height });
      });

      const skeletonEdgeKeys = new Set();
      edges.forEach(e => {
        const s = getSkeletonId(e.source);
        const t = getSkeletonId(e.target);
        if (s === t || !skeleton.has(s) || !skeleton.has(t)) return;
        const key = s + '->' + t;
        if (!skeletonEdgeKeys.has(key)) {
          skeletonEdgeKeys.add(key);
          dagreGraph.setEdge(s, t);
        }
      });

      dagre.layout(dagreGraph);

      // 2. 스켈레톤 좌표를 기반으로 실제 화면에 그릴 활성 노드 목록 구축.
      //    (그룹 가상 노드는 그대로, 텐서 확장 노드는 예약된 영역 안에서
      //    열/행 격자로 분해한다.)
      const activeNodes = [];

      skeleton.forEach((entry, sid) => {
        const dn = dagreGraph.node(sid);
        if (entry.isGroupNode) {
          activeNodes.push({
            id: sid,
            name: getGroupLabel(sid),
            op_type: 'call_module',
            isGroupNode: true,
            groupKey: sid,
            output_shape: null,
            target: sid,
            x: dn.x,
            y: dn.y,
          });
          return;
        }

        const node = entry.origNode;
        if (expandedTensors.has(node.id)) {
          const { w, h } = parseTensorShape(node.output_shape);
          const leftX = dn.x - entry.width / 2 + CELL_W / 2;

          for (let c = 0; c < w; c++) {
            const colX = leftX + c * CELL_W;
            const rowsToGen = getRowsToGen(node.id, h);
            const topY = dn.y - ((rowsToGen.length - 1) * ROW_SPACING) / 2;

            rowsToGen.forEach((item, rIdx) => {
              const subNodeId = `${node.id}_col_${c}_row_${item.r}`;
              activeNodes.push({
                id: subNodeId,
                parentTensorId: node.id,
                name: item.type === 'normal' ? `${node.name}[${c}, ${item.r}]` : '',
                op_type: node.op_type,
                isSubNode: true,
                isOmissionButton: item.type === 'omitted_btn',
                isCollapseButton: item.type === 'collapse_btn',
                colIdx: c,
                rowIdx: item.r,
                totalRows: h,
                parsedShape: { w, d: 1, h },
                output_shape: node.output_shape,
                target: node.target,
                stats: node.stats,
                heatmap: node.heatmap,
                sample: node.sample,
                output_dtype: node.output_dtype,
                x: colX,
                y: topY + rIdx * ROW_SPACING,
              });
            });
          }
        } else {
          activeNodes.push({
            ...node,
            isGroupNode: false,
            isSubNode: false,
            parsedShape: parseTensorShape(node.output_shape),
            x: dn.x,
            y: dn.y,
          });
        }
      });

      // 3. 활성 연결선 목록 구축 (그룹/텐서 확장에 따른 엣지 재배선)
      const getActiveNodeIdsForLink = (origNodeId, first) => {
        const group = getNodeGroup(origNodeId);
        if (group && collapsedGroups.has(group)) {
          return [group];
        }
        if (expandedTensors.has(origNodeId)) {
          const origNode = nodes.find(n => n.id === origNodeId);
          if (!origNode) return [origNodeId];
          const { w } = parseTensorShape(origNode.output_shape);
          const colIdx = first ? 0 : w - 1;

          const subNodes = activeNodes.filter(an => an.parentTensorId === origNodeId && an.colIdx === colIdx);
          const validSubNodes = subNodes.filter(an => !an.isOmissionButton && !an.isCollapseButton);
          if (validSubNodes.length > 0) {
            return validSubNodes.map(an => an.id);
          }
        }
        return [origNodeId];
      };

      const uniqueEdges = new Map();
      edges.forEach(e => {
        const srcs = getActiveNodeIdsForLink(e.source, false);
        const tgts = getActiveNodeIdsForLink(e.target, true);

        const maxLen = Math.max(srcs.length, tgts.length);
        for (let i = 0; i < maxLen; i++) {
          const s = srcs[Math.min(i, srcs.length - 1)];
          const t = tgts[Math.min(i, tgts.length - 1)];
          if (s !== t) {
            const key = `${s}->${t}`;
            if (!uniqueEdges.has(key)) {
              uniqueEdges.set(key, { source: s, target: t, op_type: e.op_type });
            }
          }
        }
      });
      const activeEdges = Array.from(uniqueEdges.values());

      // 4. 전체 콘텐츠 바운딩 박스를 구해 캔버스 크기/중앙 정렬 보정
      // (dagre 원본 좌표 → 화면 좌표 변환량. 엣지의 dagre 경로점에도 동일하게 적용해야 한다.)
      let shiftX = 0, shiftY = 0;
      if (activeNodes.length > 0) {
        const xs = activeNodes.map(n => n.x);
        const ys = activeNodes.map(n => n.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);

        const graphWidth = (maxX - minX) + 100;
        const graphHeight = (maxY - minY) + 100;
        const dynamicHeight = Math.max(HEIGHT, graphHeight);
        svg.attr('height', dynamicHeight);

        shiftX = (graphWidth < WIDTH) ? (WIDTH / 2 - (minX + maxX) / 2) : (50 - minX);
        shiftY = dynamicHeight / 2 - (minY + maxY) / 2;

        activeNodes.forEach(n => { n.x += shiftX; n.y += shiftY; });
      }

      const activeNodeMap = Object.fromEntries(activeNodes.map(n => [n.id, n]));

      // 5. 확장된(그룹이 해제된) 레이어 박스 그리기
      const expandedGroups = Array.from(allGroupKeys).filter(g => !collapsedGroups.has(g) && (groupNodeCounts.get(g) || 0) > 1);

      const expandedGroupBounds = expandedGroups.map(key => {
        const groupNodes = activeNodes.filter(n => {
          if (getNodeGroup(n.id) === key) return true;
          if (n.parentTensorId && getNodeGroup(n.parentTensorId) === key) return true;
          return false;
        });
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
          // 모듈 축소 시 내부의 모든 하위 텐서 확장 및 세로 전체 펼침 상태 초기화
          const groupNodes = nodes.filter(n => getNodeGroup(n.id) === d.key);
          groupNodes.forEach(gn => {
            expandedTensors.delete(gn.id);
            fullyExpandedTensors.delete(gn.id);
          });
          collapsedGroups.add(d.key);
          renderGraph();
        });

      groupElements.append('rect')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('width', d => d.width)
        .attr('height', d => d.height)
        .attr('rx', 8)
        .attr('fill', 'rgba(30, 41, 59, 0.08)')
        .attr('stroke', 'rgba(129, 140, 248, 0.22)')
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

      // 5-2. 확장된 텐서 박스 그리기
      const expandedTensorsList = Array.from(expandedTensors);

      // 텐서명 축약 헬퍼
      function getShortTensorName(fullName) {
        if (!fullName) return '';
        const parts = fullName.split('.');
        if (parts.length > 2) {
          return parts.slice(-2).join('.');
        }
        return parts[parts.length - 1];
      }

      const expandedTensorBounds = expandedTensorsList.map(tensorId => {
        const subNodes = activeNodes.filter(n => n.parentTensorId === tensorId);
        if (subNodes.length === 0) return null;

        const xs = subNodes.map(n => n.x);
        const ys = subNodes.map(n => n.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const origNode = nodes.find(n => n.id === tensorId);
        const shortName = origNode ? getShortTensorName(origNode.name) : tensorId;
        const shapeStr = origNode && origNode.output_shape ? `[${origNode.output_shape.join(', ')}]` : '[]';

        return {
          key: tensorId,
          label: `${shortName} ${shapeStr}`,
          x: minX - padding + 5,
          y: minY - padding - 4,
          width: (maxX - minX) + 2 * padding - 10,
          height: (maxY - minY) + 2 * padding + 4
        };
      }).filter(b => b !== null);

      const tensorG = g.append('g').attr('class', 'tensor-groups');
      const tensorElements = tensorG.selectAll('.tensor-container')
        .data(expandedTensorBounds)
        .join('g')
        .attr('class', 'tensor-container')
        .style('cursor', 'pointer')
        .on('click', (e, d) => {
          e.stopPropagation();
          // 클릭 시 텐서 격자 접기
          expandedTensors.delete(d.key);
          fullyExpandedTensors.delete(d.key);
          renderGraph();
        });

      tensorElements.append('rect')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('width', d => d.width)
        .attr('height', d => d.height)
        .attr('rx', 6)
        .attr('fill', 'rgba(99, 102, 241, 0.03)')
        .attr('stroke', 'rgba(192, 132, 252, 0.35)')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2 2')
        .append('title')
        .text(d => `클릭 시 텐서 축소: ${d.label}`);

      tensorElements.append('text')
        .attr('x', d => d.x + 6)
        .attr('y', d => d.y + 10)
        .attr('fill', '#c084fc')
        .attr('font-size', 8)
        .attr('font-weight', 500)
        .attr('font-family', 'sans-serif')
        .text(d => `${d.label} [-]`);

      // 6. 연결선(Edge) 렌더링
      // 두 끝점이 모두 "스켈레톤" 노드(그룹/일반 노드, 텐서 격자로 분해되지
      // 않은 노드)인 엣지는 dagre가 계산한 다중 경로점(더미 노드 경유)을 그대로
      // 사용한다. dagre는 레이어를 건너뛰는 엣지를 더미 노드로 분할해 경로를
      // 잡아주므로, 중간에 있는 무관한 노드를 가로지르지 않고 자연스럽게
      // 우회한다. 텐서 격자로 분해된 서브노드와 연결되는 짧은 재배선 엣지는
      // 항상 인접한 두 좌표 사이의 직선으로 충분하다.
      const skeletonEdgePoints = new Map();
      dagreGraph.edges().forEach(e => {
        skeletonEdgePoints.set(e.v + '->' + e.w, dagreGraph.edge(e).points);
      });

      const lineGen = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveMonotoneX);

      function trimEndpoints(pts, sRadius, tRadius) {
        if (pts.length < 2) return pts;
        const out = pts.map(p => ({ x: p.x, y: p.y }));
        const a = out[0], b = out[1];
        const dx1 = b.x - a.x, dy1 = b.y - a.y, len1 = Math.hypot(dx1, dy1) || 1;
        out[0] = { x: a.x + dx1 / len1 * sRadius, y: a.y + dy1 / len1 * sRadius };
        const n = out.length;
        const c = out[n - 2], d = out[n - 1];
        const dx2 = d.x - c.x, dy2 = d.y - c.y, len2 = Math.hypot(dx2, dy2) || 1;
        out[n - 1] = { x: d.x - dx2 / len2 * tRadius, y: d.y - dy2 / len2 * tRadius };
        return out;
      }

      function edgePath(s, t, sRadius, tRadius) {
        const isSkeletonNode = (n) => !n.isSubNode && !n.isOmissionButton && !n.isCollapseButton;
        let points;
        const lookup = skeletonEdgePoints.get(s.id + '->' + t.id);
        if (isSkeletonNode(s) && isSkeletonNode(t) && lookup) {
          // dagre 경로점은 4단계의 shiftX/shiftY 보정 이전 좌표이므로,
          // 노드 좌표에 적용한 것과 동일한 전역 이동량을 그대로 더해 맞춘다.
          points = lookup.map(p => ({ x: p.x + shiftX, y: p.y + shiftY }));
        } else {
          points = [{ x: s.x, y: s.y }, { x: t.x, y: t.y }];
        }
        points = trimEndpoints(points, sRadius, tRadius);
        return lineGen(points);
      }

      g.selectAll('.edge')
        .data(activeEdges)
        .join('path')
        .attr('class', 'edge')
        .attr('fill', 'none')
        .attr('d', d => {
          const s = activeNodeMap[d.source];
          const t = activeNodeMap[d.target];
          if (!s || !t) return '';
          const sRadius = s.isGroupNode ? GROUP_R : NODE_R;
          const tRadius = t.isGroupNode ? GROUP_R : NODE_R;
          return edgePath(s, t, sRadius, tRadius);
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
            collapsedGroups.delete(d.groupKey);
            renderGraph();
          } else if (d.isOmissionButton) {
            fullyExpandedTensors.add(d.parentTensorId);
            renderGraph();
          } else if (d.isCollapseButton) {
            fullyExpandedTensors.delete(d.parentTensorId);
            renderGraph();
          } else if (d.isSubNode) {
            g.selectAll('.node circle').attr('stroke', '#334155').attr('stroke-width', 1.5);
            d3.select(e.currentTarget).selectAll('circle').attr('stroke', '#c084fc').attr('stroke-width', 2.5);
            showDataPanel(d);
          } else {
            const hasGrid = d.parsedShape && (d.parsedShape.w > 1 || d.parsedShape.h > 1);
            if (hasGrid) {
              expandedTensors.add(d.id);
              renderGraph();
            }
            g.selectAll('.node circle').attr('stroke', '#334155').attr('stroke-width', 1.5).attr('r', n => n.isGroupNode ? GROUP_R : NODE_R);
            d3.select(e.currentTarget).selectAll('circle').attr('stroke', '#c084fc').attr('stroke-width', 2.5);
            showDataPanel(d);
          }
        })
        .on('mouseover', function(e, d) {
          if (d.isOmissionButton || d.isCollapseButton) {
            d3.select(this).select('rect').attr('fill', '#312e81');
            return;
          }
          const circles = d3.select(this).selectAll('circle');
          const maxR = d.isGroupNode ? 15 : 10;
          circles.attr('r', maxR);
        })
        .on('mouseout', function(e, d) {
          if (d.isOmissionButton || d.isCollapseButton) {
            d3.select(this).select('rect').attr('fill', '#1e1b4b');
            return;
          }
          const circles = d3.select(this).selectAll('circle');
          const origR = d.isGroupNode ? GROUP_R : NODE_R;
          circles.attr('r', origR);
        });

      // 노드 내부 원 드로잉
      nodeGroups.each(function(d) {
        const el = d3.select(this);

        if (d.isOmissionButton || d.isCollapseButton) {
          el.append('rect')
            .attr('x', -35)
            .attr('y', -11)
            .attr('width', 70)
            .attr('height', 22)
            .attr('rx', 11)
            .attr('fill', '#1e1b4b')
            .attr('stroke', '#818cf8')
            .attr('stroke-width', 1.2)
            .style('transition', 'fill 0.15s ease');

          el.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .attr('fill', '#a5b4fc')
            .attr('font-size', '8px')
            .attr('font-weight', '600')
            .attr('font-family', 'sans-serif')
            .attr('pointer-events', 'none')
            .text(d.isOmissionButton ? `➕ ${d.totalRows - 10}` : `➖ Collapse`);
        } else {
          // 노드는 항상 단일 원으로 렌더링한다. shape 정보는 hasGrid "+" 표시와
          // 툴팁으로 충분히 전달된다.
          const hasGrid = d.parsedShape && (d.parsedShape.w > 1 || d.parsedShape.h > 1);

          el.append('circle')
            .attr('r', d.isGroupNode ? GROUP_R : NODE_R)
            .attr('fill', d.isSubNode ? '#1e293b' : getNodeColor(d.op_type))
            .attr('stroke', d.isGroupNode ? '#818cf8' : '#334155')
            .attr('stroke-width', d.isGroupNode ? 2.5 : 1.5)
            .attr('stroke-dasharray', d.isGroupNode ? '3 2' : 'none')
            .style('transition', 'r 0.15s ease, stroke-width 0.15s ease');

          if (hasGrid && !d.isSubNode) {
            el.append('text')
              .attr('text-anchor', 'middle')
              .attr('dy', '0.35em')
              .attr('fill', '#ffffff')
              .attr('font-size', '9px')
              .attr('font-weight', 'bold')
              .attr('pointer-events', 'none')
              .text('+');
          }
        }
      });

      // 툴팁 설정
      nodeGroups.append('title')
        .text(d => {
          if (d.isGroupNode) {
            return `레이어 그룹: ${d.name}\n클릭 시 내부 노드 확장`;
          }
          if (d.isOmissionButton) {
            return `숨겨진 ${d.totalRows - 10}개 행 확장`;
          }
          if (d.isCollapseButton) {
            return "10개 행 요약 상태로 축소";
          }
          if (d.isSubNode) {
            const shapeStr = d.output_shape ? `[${d.output_shape.join('×')}]` : '[]';
            return `${d.name}\n종류: ${d.op_type}\n원래 형태: ${shapeStr}`;
          }
          const shapeStr = d.output_shape ? `[${d.output_shape.join('×')}]` : '[]';
          const hasGrid = d.parsedShape && (d.parsedShape.w > 1 || d.parsedShape.h > 1);
          const gridTip = hasGrid ? "\n클릭 시 가로/세로 텐서 격자 확장" : "";
          return `${d.name}\n종류: ${d.op_type}\n대상: ${d.target}\n크기: ${shapeStr}${gridTip}`;
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
