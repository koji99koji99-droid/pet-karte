export function compareRecords(a, b) {
  return a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id);
}
export function weightChart(records) {
  const points = records.filter(r => ['weight', 'checkup'].includes(r.type) && Number.isFinite(Number(r.weight)) && Number(r.weight) > 0)
    .sort(compareRecords).map(r => ({ date: r.date, value: Number(r.weight) }));
  if (!points.length) return '<p class="empty">体重の記録はまだありません。</p>';
  if (points.length === 1) return `<p>最新：${points[0].value} kg（${String(points[0].date).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}）</p>`;
  const w = 620, h = 230, left = 52, right = 18, top = 18, bottom = 42;
  const values = points.map(p => p.value);
  const min = Math.max(0, Math.min(...values) - Math.max(0.2, (Math.max(...values) - Math.min(...values)) * .2));
  const max = Math.max(...values) + Math.max(0.2, (Math.max(...values) - Math.min(...values)) * .2);
  const xs = points.map((_, i) => left + (points.length === 1 ? (w - left - right) / 2 : i * (w - left - right) / (points.length - 1)));
  const ys = points.map(p => top + (max - p.value) / (max - min) * (h - top - bottom));
  const path = points.map((_, i) => `${i ? 'L' : 'M'} ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${xs[i]}" cy="${ys[i]}" r="5"><title>${p.date} ${p.value} kg</title></circle>`).join('');
  const label = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  return `<svg class="weight-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="体重推移。最新 ${points.at(-1).value} キログラム">
    <line x1="${left}" y1="${h-bottom}" x2="${w-right}" y2="${h-bottom}"/>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${h-bottom}"/>
    <text x="4" y="${top+7}">${max.toFixed(1)}kg</text><text x="4" y="${h-bottom}">${min.toFixed(1)}kg</text>
    <path d="${path}" class="chart-line"/>${dots}
    <text x="${left}" y="${h-10}">${label(points[0].date)}</text>
    <text x="${w-right}" y="${h-10}" text-anchor="end">${label(points.at(-1).date)}</text>
  </svg>`;
}
