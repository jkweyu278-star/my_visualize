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

    // 1-2. 텐서 격자 확장 및 세로 생략(Truncation) 상태 관리용 Set 추가
    const expandedTensors = new Set();
    const fullyExpandedTensors = new Set();
    let autoAlignEnabled = true;

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

    const padding = 15;

    function renderGraph() {
      // 캔버스 초기화
      g.selectAll('*').remove();

      // 1. 각 오리지널 depth 레벨이 기여하는 가로 폭 오프셋 계산 (최대 텐서 컬럼 확장 수 반영)
      const maxDepthVal = d3.max(nodes, n => n.depth) || 0;
      const levelOffsets = new Map();
      for (let d = 0; d <= maxDepthVal; d++) {
        const nodesAtDepth = nodes.filter(n => n.depth === d);
        let maxOffsetForLevel = 0;
        nodesAtDepth.forEach(n => {
          const group = getNodeGroup(n.id);
          const inCollapsedGroup = group && collapsedGroups.has(group);
          if (!inCollapsedGroup && expandedTensors.has(n.id)) {
            const { w } = parseTensorShape(n.output_shape);
            if (w - 1 > maxOffsetForLevel) {
              maxOffsetForLevel = w - 1;
            }
          }
        });
        levelOffsets.set(d, maxOffsetForLevel);
      }

      // 특정 오리지널 depth의 노드가 위치할 최종 depth 인덱스 계산
      const getShiftedDepth = (origDepth) => {
        let shifted = origDepth;
        for (let d = 0; d < origDepth; d++) {
          shifted += (levelOffsets.get(d) || 0);
        }
        return shifted;
      };

      // 2. 활성 노드 목록 구축 (격자 확장 및 생략 필터 적용)
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
              depth: getShiftedDepth(node.depth),
              output_shape: null,
              target: group
            });
          }
          // 가상 노드의 depth를 이 그룹에 속한 최소 depth로 맞춤
          const virtualNode = activeNodes.find(n => n.id === group);
          const shiftedDepth = getShiftedDepth(node.depth);
          if (virtualNode && shiftedDepth < virtualNode.depth) {
            virtualNode.depth = shiftedDepth;
          }
        } else {
          // 텐서 확장 모드인 경우
          if (expandedTensors.has(node.id)) {
            const { w, d, h } = parseTensorShape(node.output_shape);
            const shiftedBaseDepth = getShiftedDepth(node.depth);

            for (let c = 0; c < w; c++) {
              const currentDepth = shiftedBaseDepth + c;

              // 세로 행 목록 생성
              const rowsToGen = [];
              if (h <= 10 || fullyExpandedTensors.has(node.id)) {
                for (let r = 0; r < h; r++) {
                  rowsToGen.push({ r, type: 'normal' });
                }
                if (h > 10 && fullyExpandedTensors.has(node.id)) {
                  rowsToGen.push({ r: h, type: 'collapse_btn' });
                }
              } else {
                for (let r = 0; r < 5; r++) {
                  rowsToGen.push({ r, type: 'normal' });
                }
                rowsToGen.push({ r: 5, type: 'omitted_btn' });
                for (let r = h - 5; r < h; r++) {
                  rowsToGen.push({ r, type: 'normal' });
                }
              }

              rowsToGen.forEach(item => {
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
                  depth: currentDepth,
                  parsedShape: { w, d, h },
                  output_shape: node.output_shape,
                  target: node.target,
                  stats: node.stats,
                  heatmap: node.heatmap,
                  sample: node.sample,
                  output_dtype: node.output_dtype
                });
              });
            }
          } else {
            // 일반 축소 노드
            activeNodes.push({
              ...node,
              depth: getShiftedDepth(node.depth),
              isGroupNode: false,
              isSubNode: false,
              parsedShape: parseTensorShape(node.output_shape)
            });
          }
        }
      });

      // 3. 활성 연결선 목록 구축 및 라우팅 매핑
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

      // 4. 활성 노드 기반 depth 레이아웃 계산 (Flexible Spacing & Branch-Aware Parallel Gaps)
      const BASE_GAP = 30; // 기본 가로 간격 30px
      const ROW_SPACING = 10;   // 세로 간격 10px로 축소

      const getBranchGroup = (node) => {
        const id = node.parentTensorId || node.id;
        if (id.includes('omics')) return 'omics';
        if (id.includes('text')) return 'text';
        return 'other';
      };

      const uniqueDepths = Array.from(new Set(activeNodes.map(d => d.depth))).sort((a, b) => a - b);
      const depthGroups = d3.group(activeNodes, d => d.depth);

      // 4-1. X 좌표 계산: 동적 가로 간격 (서브노드/생략버튼 존재 여부에 따라 55px 간격 부여)
      const colXCoords = new Map();
      let currentX = 50;
      uniqueDepths.forEach((d, i) => {
        colXCoords.set(d, currentX);
        if (i < uniqueDepths.length - 1) {
          const colNodes = depthGroups.get(d) || [];
          const nextColNodes = depthGroups.get(uniqueDepths[i + 1]) || [];
          const hasExpandedOrButton = colNodes.some(n => n.isSubNode || n.isOmissionButton || n.isCollapseButton);
          const nextHasExpandedOrButton = nextColNodes.some(n => n.isSubNode || n.isOmissionButton || n.isCollapseButton);

          let gap = BASE_GAP;
          if (hasExpandedOrButton || nextHasExpandedOrButton) {
            gap = 55;
          }
          currentX += gap;
        }
      });
      const totalGraphWidth = currentX - 50;
      const shiftX = (totalGraphWidth < (WIDTH - 100)) ? (WIDTH - totalGraphWidth) / 2 - 50 : 0;

      // 4-2. Y 좌표 계산: 오믹스/텍스트 병렬 라인을 꺾임 없는 수평 직선으로 배치
      if (autoAlignEnabled) {
        // 각 브랜치의 최대 수직 높이 구하기
        let maxOmicsHeight = 0;
        let maxTextHeight = 0;
        uniqueDepths.forEach(d => {
          const group = depthGroups.get(d) || [];
          const omicsCount = group.filter(n => getBranchGroup(n) === 'omics').length;
          const textCount = group.filter(n => getBranchGroup(n) === 'text').length;
          const omicsH = omicsCount > 0 ? (omicsCount - 1) * ROW_SPACING : 0;
          const textH = textCount > 0 ? (textCount - 1) * ROW_SPACING : 0;
          if (omicsH > maxOmicsHeight) maxOmicsHeight = omicsH;
          if (textH > maxTextHeight) maxTextHeight = textH;
        });

        // 병렬 트랙 간 수직 최소 간격 100px 보장을 위한 트랙 중심 이격거리 계산
        const trackGap = 100 + (maxOmicsHeight + maxTextHeight) / 2;
        const dynamicHeight = Math.max(HEIGHT, 100 + maxOmicsHeight + maxTextHeight + 100);
        svg.attr('height', dynamicHeight);

        const yMid = dynamicHeight / 2;
        const yOmics = yMid - trackGap / 2;
        const yText = yMid + trackGap / 2;
        const yMerged = yMid;

        // 각 열(Column)별로 브랜치 단위로 Y 좌표 분배 배치
        uniqueDepths.forEach(d => {
          const group = depthGroups.get(d) || [];
          const omicsNodes = group.filter(n => getBranchGroup(n) === 'omics');
          const textNodes = group.filter(n => getBranchGroup(n) === 'text');
          const otherNodes = group.filter(n => getBranchGroup(n) === 'other');

          const sortBranchNodes = (nodesList) => {
            nodesList.sort((a, b) => {
              if (a.isSubNode && b.isSubNode) {
                return a.rowIdx - b.rowIdx;
              }
              return a.id.localeCompare(b.id);
            });
          };
          sortBranchNodes(omicsNodes);
          sortBranchNodes(textNodes);
          sortBranchNodes(otherNodes);

          const assignBranchY = (nodesList, yCenter) => {
            const K = nodesList.length;
            if (K === 0) return;
            const h = (K - 1) * ROW_SPACING;
            const startY = yCenter - h / 2;
            nodesList.forEach((node, idx) => {
              node.y = startY + idx * ROW_SPACING;
            });
          };
          assignBranchY(omicsNodes, yOmics);
          assignBranchY(textNodes, yText);
          assignBranchY(otherNodes, yMerged);
        });
      } else {
        // 기존 디폴트 배치 (컬럼 단위로 세로 중앙 정렬)
        const colHeights = new Map();
        uniqueDepths.forEach(d => {
          const group = depthGroups.get(d) || [];
          group.sort((a, b) => {
            if (a.isSubNode && b.isSubNode) {
              return a.rowIdx - b.rowIdx;
            }
            return a.id.localeCompare(b.id);
          });

          let currentY = 0;
          const coords = [];
          group.forEach((node, idx) => {
            if (idx > 0) {
              const prevNode = group[idx - 1];
              const prevBranch = getBranchGroup(prevNode);
              const currBranch = getBranchGroup(node);
              const gap = (prevBranch !== currBranch && prevBranch !== 'other' && currBranch !== 'other') ? 100 : ROW_SPACING;
              currentY += gap;
            }
            coords.push(currentY);
          });
          colHeights.set(d, { height: currentY, coords: coords });
        });

        const maxColHeight = d3.max(Array.from(colHeights.values()), h => h.height) || 0;
        const dynamicHeight = Math.max(HEIGHT, maxColHeight + 100);
        svg.attr('height', dynamicHeight);

        activeNodes.forEach(node => {
          const group = depthGroups.get(node.depth) || [];
          const idx = group.indexOf(node);
          const colInfo = colHeights.get(node.depth);
          const offset = (dynamicHeight - colInfo.height) / 2;
          node.y = offset + colInfo.coords[idx];
        });
      }

      // 최종 X 좌표 매핑
      activeNodes.forEach(node => {
        node.x = colXCoords.get(node.depth) + shiftX;
      });

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
            g.selectAll('.node circle').attr('stroke', '#334155').attr('stroke-width', 1.5).attr('r', n => n.isGroupNode ? 12 : NODE_R);
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
          const origR = d.isGroupNode ? 12 : NODE_R;
          circles.attr('r', origR);
        });

      // 노드 내부 원 및 스택 드로잉
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
          const dDim = d.parsedShape ? d.parsedShape.d : 1;
          const hasGrid = d.parsedShape && (d.parsedShape.w > 1 || d.parsedShape.h > 1);

          if (dDim > 1) {
            // 3D 겹침 카드 스택 렌더링
            const sheetsCount = Math.min(dDim, 4);
            for (let i = sheetsCount - 1; i >= 0; i--) {
              el.append('circle')
                .attr('cx', i * 3)
                .attr('cy', -i * 3)
                .attr('r', d.isGroupNode ? 12 : NODE_R)
                .attr('fill', d.isSubNode ? 'rgba(99, 102, 241, 0.85)' : getNodeColor(d.op_type))
                .attr('stroke', d.isGroupNode ? '#818cf8' : '#334155')
                .attr('stroke-width', d.isGroupNode ? 2.5 : 1.5)
                .attr('stroke-dasharray', d.isGroupNode ? '3 2' : 'none')
                .style('transition', 'r 0.15s ease, stroke-width 0.15s ease');
            }

            if (hasGrid && !d.isSubNode) {
              el.append('text')
                .attr('cx', (sheetsCount - 1) * 3)
                .attr('cy', -(sheetsCount - 1) * 3)
                .attr('text-anchor', 'middle')
                .attr('dy', '0.35em')
                .attr('fill', '#ffffff')
                .attr('font-size', '9px')
                .attr('font-weight', 'bold')
                .attr('pointer-events', 'none')
                .text('+');
            }
          } else {
            // 일반 단일 차원 노드
            el.append('circle')
              .attr('r', d.isGroupNode ? 12 : NODE_R)
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

      // 8. 상단 컨트롤 그룹 그리기 (Auto Align 토글 버튼)
      svg.selectAll('.controls-group').remove();
      const controlsG = svg.append('g')
        .attr('class', 'controls-group')
        .attr('transform', `translate(${WIDTH - 110}, 15)`)
        .style('cursor', 'pointer')
        .on('click', (e) => {
          e.stopPropagation();
          autoAlignEnabled = !autoAlignEnabled;
          renderGraph();
        });

      controlsG.append('rect')
        .attr('width', 95)
        .attr('height', 24)
        .attr('rx', 12)
        .attr('fill', autoAlignEnabled ? 'rgba(79, 70, 229, 0.15)' : 'rgba(30, 41, 59, 0.6)')
        .attr('stroke', autoAlignEnabled ? '#818cf8' : '#334155')
        .attr('stroke-width', 1.2)
        .style('transition', 'all 0.15s ease');

      controlsG.append('circle')
        .attr('cx', 12)
        .attr('cy', 12)
        .attr('r', 4)
        .attr('fill', autoAlignEnabled ? '#10b981' : '#64748b');

      controlsG.append('text')
        .attr('x', 24)
        .attr('y', 12)
        .attr('dy', '0.35em')
        .attr('fill', autoAlignEnabled ? '#a5b4fc' : '#94a3b8')
        .attr('font-size', '9px')
        .attr('font-weight', '600')
        .attr('font-family', 'sans-serif')
        .text('Auto Align');
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
