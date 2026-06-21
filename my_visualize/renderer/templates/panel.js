// ============================================================
// 노드 클릭 시 우측 데이터 패널 표시
// ============================================================

function showDataPanel(node) {
  const panel = document.getElementById(dataPanelId);

  const stats = node.stats || {};
  const statsHtml = Object.entries(stats)
    .filter(([k]) => k !== 'numel')
    .map(([k, v]) => {
      const valStr = typeof v === 'number' ? v.toFixed(4) : String(v);
      return `
      <div style="display:flex; justify-content:space-between; margin: 6px 0; border-bottom: 1px dashed #334155; padding-bottom: 4px;">
        <span style="color:#94a3b8; text-transform:capitalize; font-size:11px;">${k}</span>
        <span style="color:#f1f5f9; font-family:'JetBrains Mono', monospace; font-weight:500;">${valStr}</span>
      </div>`;
    })
    .join('');

  const heatmapHtml = node.heatmap ? renderHeatmap(node.heatmap) : '';
  const histogramHtml = (node.sample && node.sample.length > 0) ? renderHistogram(node.sample) : '';

  panel.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 14px; animation: fadeIn 0.3s ease-in-out;">
      <div style="border-bottom: 2px solid #818cf8; padding-bottom: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <h4 style="color:#c084fc; margin:0; font-size:1.1rem; font-weight:700;">${node.name}</h4>
          <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:#312e81; color:#a5b4fc; font-weight:600; text-transform:uppercase;">
            ${node.op_type}
          </span>
        </div>
        <p style="color:#64748b; font-family:'JetBrains Mono', monospace; font-size:10px; margin:4px 0 0 0; word-break: break-all;">
          ${node.target}
        </p>
      </div>

      <div style="background:#0f172a; border: 1px solid #1e293b; border-radius:8px; padding:12px;">
        <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px; font-weight:600;">출력 Shape & Dtype</div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:#f1f5f9; font-family:'JetBrains Mono', monospace; font-size:13px; font-weight:600;">
            ${node.output_shape ? '[' + node.output_shape.join(', ') + ']' : '[]'}
          </span>
          <span style="font-size:10px; color:#64748b; font-family:'JetBrains Mono', monospace;">
            ${node.output_dtype || 'unknown'}
          </span>
        </div>
      </div>

      <div style="background:#0f172a; border: 1px solid #1e293b; border-radius:8px; padding:12px;">
        <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; font-weight:600;">텐서 요약 통계</div>
        ${statsHtml || '<div style="color:#64748b; font-size:11px;">통계 데이터 없음</div>'}
      </div>

      ${heatmapHtml ? `
      <div style="background:#0f172a; border: 1px solid #1e293b; border-radius:8px; padding:12px;">
        <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; font-weight:600; display:flex; justify-content:space-between;">
          <span>히트맵 (마지막 2D 축소)</span>
          <span style="color:#6366f1;">[-1.0, 1.0] 정규화</span>
        </div>
        <div style="display:flex; justify-content:center; overflow-x:auto; padding:4px 0;">
          ${heatmapHtml}
        </div>
      </div>` : ''}

      ${histogramHtml ? `
      <div style="background:#0f172a; border: 1px solid #1e293b; border-radius:8px; padding:12px;">
        <div style="color:#94a3b8; font-size:10px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; font-weight:600;">값 분포 히스토그램</div>
        <div style="display:flex; justify-content:center; overflow-x:auto;">
          ${histogramHtml}
        </div>
      </div>` : ''}
    </div>
  `;
}

function renderHeatmap(data) {
  const rows = data.length;
  if (rows === 0) return '';
  const cols = data[0].length;
  if (cols === 0) return '';
  
  // 최대 가로 폭 220px 기준으로 셀 크기 자동 계산
  const containerW = 220;
  const cellSize = Math.max(3, Math.min(15, Math.floor(containerW / cols)));
  const w = cols * cellSize;
  const h = rows * cellSize;

  // D3 RdBu 스케일 적용 (양수는 Red/Blue 등으로, 정규화 -1 ~ 1)
  // interpolateRdBu(0)은 파란색, 0.5는 흰색/회색, 1은 빨간색
  // d3.scaleSequential 로 domain [1, -1] 설정 시:
  // 1(max) -> Red, 0 -> White/Light, -1(min) -> Blue
  const colorScale = d3.scaleSequential(d3.interpolateRdBu).domain([1, -1]);

  let cells = '';
  data.forEach((row, ri) => {
    row.forEach((val, ci) => {
      cells += `<rect x="${ci * cellSize}" y="${ri * cellSize}"
                  width="${cellSize}" height="${cellSize}"
                  fill="${colorScale(val)}" stroke="#0f172a" stroke-width="0.5" opacity="0.95">
                  <title>Value: ${val.toFixed(4)}</title>
                </rect>`;
    });
  });

  return `<svg width="${w}" height="${h}" style="border:1px solid #1e293b; border-radius:4px;">${cells}</svg>`;
}

function renderHistogram(sample) {
  const binCount = 15;
  const bins = d3.bin().thresholds(binCount)(sample);
  const maxCount = d3.max(bins, d => d.length) || 1;

  const svgW = 220, svgH = 85;
  const xScale = d3.scaleLinear()
    .domain([bins[0].x0, bins[bins.length - 1].x1])
    .range([10, svgW - 10]);
  const yScale = d3.scaleLinear().domain([0, maxCount]).range([svgH - 15, 5]);

  const bars = bins.map(bin => {
    const x = xScale(bin.x0);
    const y = yScale(bin.length);
    const barW = Math.max(1.5, xScale(bin.x1) - xScale(bin.x0) - 1.5);
    const barH = Math.max(0, svgH - 15 - y);
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#6366f1" rx="1.5" opacity="0.85">
        <title>Range: [${bin.x0.toFixed(2)}, ${bin.x1.toFixed(2)}], Count: ${bin.length}</title>
      </rect>
    `;
  }).join('');

  // X축 라벨 (최소, 최대 값 표시)
  const minVal = sample[0];
  const maxVal = sample[sample.length - 1];
  const labels = `
    <text x="10" y="${svgH - 2}" fill="#64748b" font-size="8px" font-family="'JetBrains Mono', monospace" text-anchor="start">${d3.min(sample).toFixed(2)}</text>
    <text x="${svgW - 10}" y="${svgH - 2}" fill="#64748b" font-size="8px" font-family="'JetBrains Mono', monospace" text-anchor="end">${d3.max(sample).toFixed(2)}</text>
  `;

  return `<svg width="${svgW}" height="${svgH}" style="background:#0f172a; border: 1px solid #1e293b; border-radius:4px;">
    ${bars}
    ${labels}
  </svg>`;
}
