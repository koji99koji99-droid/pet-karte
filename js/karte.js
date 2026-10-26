import { weightChart, compareRecords } from './chart.js';

export function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
export const show = value => value === undefined || value === null || value === '' ? '未登録' : esc(value);
export function age(birth, estimated = false) {
  if (!birth) return '不明';
  const d = new Date(`${birth}T00:00:00`), today = new Date();
  if (Number.isNaN(d.getTime())) return '不明';
  let years = today.getFullYear() - d.getFullYear();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) years--;
  return `${estimated ? '推定 ' : ''}${Math.max(0, years)}歳`;
}
const list = values => values.length ? values.join('') : '<p class="empty">記録はありません。</p>';

export function karteHtml(pet, records, { visitLimit = 5 } = {}) {
  const sorted = [...records].sort((a, b) => compareRecords(b, a));
  const vaccines = new Map();
  for (const r of sorted.filter(r => r.type === 'vaccine')) if (!vaccines.has(r.vaccineName || '名称未登録')) vaccines.set(r.vaccineName || '名称未登録', r);
  const checkup = sorted.find(r => r.type === 'checkup' && r.tests?.length);
  const visits = sorted.filter(r => r.type === 'visit').slice(0, visitLimit);
  const hospitals = [...new Set([pet.hospitalName, ...sorted.map(r => r.hospital)].filter(Boolean))];
  const cautions = ['アレルギー', '持病・既往歴', '常用薬'].map((label, i) => {
    const value = [pet.allergies, pet.history, pet.medications][i];
    return value ? `<p><strong>${label}：</strong>${esc(value)}</p>` : '';
  }).join('');
  const latestWeight = sorted.find(r => ['checkup', 'weight'].includes(r.type) && Number(r.weight) > 0);
  return `<article class="karte-sheet" id="karte-sheet">
    <h2>🩺 ${esc(pet.name)}の健康カルテ</h2>
    <p class="karte-updated">表示日：${new Date().toLocaleDateString('ja-JP')}</p>
    <section class="karte-block"><h3>基本情報</h3>
      <p><strong>${esc(pet.name)}</strong> ／ ${show(pet.kind)} ${pet.breed ? `・${esc(pet.breed)}` : ''}</p>
      <p>性別：${show(pet.sex)}　避妊・去勢：${show(pet.neutered)}</p>
      <p>年齢：${age(pet.birthDate, pet.birthEstimated)}　生年月日：${show(pet.birthDate)}${pet.birthEstimated ? '（推定）' : ''}</p>
      <p>マイクロチップ：${show(pet.microchip)}</p>
    </section>
    <section class="karte-block caution"><h3>⚠ 注意事項</h3>${cautions || '<p>特になし（飼い主申告）</p>'}</section>
    <section class="karte-block"><h3>ワクチン履歴</h3>${list([...vaccines].map(([name, r]) => `<p>${esc(name)}：最終 ${esc(r.date)} ／ 次回 ${show(r.nextDate)}</p>`))}</section>
    <section class="karte-block"><h3>直近の通院（最大${visitLimit}件）</h3>${list(visits.map(r => `<div class="karte-row"><strong>${esc(r.date)}</strong>　${show(r.hospital)}<br>診断：${show(r.diagnosis)}<br>処置：${show(r.treatment)}<br>処方：${show(r.prescription)}</div>`))}</section>
    <section class="karte-block"><h3>最新の検査値</h3>${checkup ? `<p>${esc(checkup.date)}　${show(checkup.hospital)}</p><div class="table-scroll"><table><thead><tr><th>項目</th><th>値</th><th>基準範囲</th></tr></thead><tbody>${checkup.tests.map(t => {
      const n = Number(t.value), low = Number(t.low), high = Number(t.high);
      const lowOut = t.low !== '' && t.low != null && Number.isFinite(n) && Number.isFinite(low) && n < low;
      const highOut = t.high !== '' && t.high != null && Number.isFinite(n) && Number.isFinite(high) && n > high;
      return `<tr><td>${show(t.name)}</td><td class="${lowOut || highOut ? 'out-of-range' : ''}">${show(t.value)} ${show(t.unit) === '未登録' ? '' : show(t.unit)} ${lowOut ? '↓' : highOut ? '↑' : ''}</td><td>${t.low !== '' && t.low != null ? esc(t.low) : '―'} ～ ${t.high !== '' && t.high != null ? esc(t.high) : '―'}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="empty">検査値の記録はありません。</p>'}</section>
    <section class="karte-block"><h3>体重推移</h3><p>最新：${latestWeight ? `${esc(latestWeight.weight)} kg（${esc(latestWeight.date)}）` : '未登録'}</p>${weightChart(records)}</section>
    <section class="karte-block"><h3>病院・連絡先</h3><p>かかりつけ：${show(pet.hospitalName)}（電話：${show(pet.hospitalPhone)}）</p><p>受診した病院：${hospitals.length ? hospitals.map(esc).join('、') : '未登録'}</p><p>飼い主の緊急連絡先：${show(pet.emergencyContact)}</p></section>
    <p class="disclaimer">飼い主による記録です。診断は獣医師の判断を優先してください。</p>
  </article>`;
}

export function karteText(pet, records) {
  const sorted = [...records].sort((a, b) => compareRecords(b, a));
  const vaccines = new Map();
  for (const r of sorted.filter(r => r.type === 'vaccine')) if (!vaccines.has(r.vaccineName || '名称未登録')) vaccines.set(r.vaccineName || '名称未登録', r);
  const checkup = sorted.find(r => r.type === 'checkup' && r.tests?.length);
  const latestWeight = sorted.find(r => ['checkup', 'weight'].includes(r.type) && Number(r.weight) > 0);
  return [
    `【${pet.name}の健康カルテ】`,
    `基本情報：${pet.kind} ${pet.breed || ''}／${pet.sex || '性別不明'}／避妊・去勢 ${pet.neutered || '不明'}／${age(pet.birthDate, pet.birthEstimated)}（生年月日 ${pet.birthDate || '不明'}${pet.birthEstimated ? '・推定' : ''}）／マイクロチップ ${pet.microchip || '未登録'}`,
    `【注意事項】\nアレルギー：${pet.allergies || '特になし（飼い主申告）'}\n持病・既往歴：${pet.history || '特になし（飼い主申告）'}\n常用薬：${pet.medications || '特になし（飼い主申告）'}`,
    `【ワクチン履歴】\n${[...vaccines].map(([name, r]) => `${name}：${r.date}、次回 ${r.nextDate || '未登録'}`).join('\n') || '記録なし'}`,
    `【直近の通院】\n${sorted.filter(r => r.type === 'visit').slice(0, 5).map(r => `${r.date} ${r.hospital || ''}／診断 ${r.diagnosis || '未登録'}／処置 ${r.treatment || '未登録'}／処方 ${r.prescription || '未登録'}`).join('\n') || '記録なし'}`,
    `【最新の検査値】\n${checkup ? `${checkup.date}\n${checkup.tests.map(t => `${t.name} ${t.value} ${t.unit || ''}（基準 ${t.low || '―'}～${t.high || '―'}）`).join('\n')}` : '記録なし'}`,
    `【体重】${latestWeight ? `${latestWeight.weight} kg（${latestWeight.date}）` : '未登録'}`,
    `【病院・連絡先】\nかかりつけ：${pet.hospitalName || '未登録'}（電話：${pet.hospitalPhone || '未登録'}）\n受診した病院：${[...new Set([pet.hospitalName, ...sorted.map(r => r.hospital)].filter(Boolean))].join('、') || '未登録'}\n緊急連絡先：${pet.emergencyContact || '未登録'}`,
    '飼い主による記録です。診断は獣医師の判断を優先してください。'
  ].join('\n\n');
}
