// ============================================================
// DAG 시각화 핵심 로직
// ============================================================

const panelElement = document.getElementById('dag-panel');
const WIDTH = panelElement ? (panelElement.clientWidth || 800) : 800;
const HEIGHT = 550;
const NODE_W = 130, NODE_H = 45;

// SVG 캔버스 생성
const svg = d3.select('#dag-panel')
  .append('svg')
  .attr('width', '100%')
  .attr('height', HEIGHT)
  .style('background', '#0b0f19')
  .style('border-radius', '8px')
  .call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => g.attr('transform', e.transform)));

const g = svg.append('g');

// 화살표 마커 정의
svg.append('defs').append('marker')
  .attr('id', 'arrow')
  .attr('viewBox', '0 -5 10 10')
  .attr('refX', 8).attr('refY', 0)
  .attr('markerWidth', 6).attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path')
  .attr('d', 'M0,-5L10,0L0,5')
  .attr('fill', '#818cf8');

// 노드별 x 포지션 계산 (depth 기반 레이아웃)
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
  .attr('marker-end', 'url(#arrow)')
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

// 색상 매핑
function getNodeColor(opType) {
  const colors = {
    'input':          '#1e3a8a', // deep blue
    'call_module':    '#4c1d95', // deep purple
    'call_function':  '#064e3b', // deep green
    'call_method':    '#78350f', // deep amber
    'output':         '#881337', // deep rose
  };
  return colors[opType] || '#1f2937';
}
