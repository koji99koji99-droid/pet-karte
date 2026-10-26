import { compareRecords } from './chart.js';
import { esc, karteHtml, show } from './karte.js';

export const SHARE_LIMIT = 1800;
export const TAG_LIMIT = 600;
const TAG_GUIDE = 'このペットは迷子かもしれません。近くの動物病院・交番・動物愛護センターに連れて行ってください。';
const CHIP_GUIDE = 'マイクロチップが入っている場合、そこで飼い主を調べてもらえます。';
const MAX_JSON_BYTES = 200 * 1024;
const PET_FIELDS = ['name', 'kind', 'breed', 'sex', 'neutered', 'birthDate', 'features', 'microchip', 'allergies', 'history', 'medications', 'hospitalName', 'hospitalPhone', 'emergencyContact'];
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, String(source?.[key] ?? '')]));
const recent = records => [...records].sort((a, b) => compareRecords(b, a));

export function makeSummary(pet, records = [], kind = 'karte', createdAt = new Date().toISOString()) {
  if (!['karte', 'emergency'].includes(kind)) throw new Error('共有の種類が不正です。');
  const summary = { v: 1, kind, createdAt, pet: { ...pick(pet, PET_FIELDS), birthEstimated: Boolean(pet.birthEstimated) }, omitted: false };
  if (kind === 'emergency') return summary;
  const sorted = recent(records);
  const vaccines = new Map();
  for (const r of sorted.filter(r => r.type === 'vaccine')) {
    const name = String(r.vaccineName || '名称未登録');
    if (!vaccines.has(name)) vaccines.set(name, pick(r, ['date', 'vaccineName', 'nextDate']));
  }
  summary.vaccines = [...vaccines.values()];
  summary.visits = sorted.filter(r => r.type === 'visit').slice(0, 3).map(r => pick(r, ['date', 'hospital', 'diagnosis', 'treatment', 'prescription']));
  const checkup = sorted.find(r => r.type === 'checkup' && Array.isArray(r.tests) && r.tests.length);
  summary.checkup = checkup ? { ...pick(checkup, ['date', 'hospital']), tests: checkup.tests.map(t => pick(t, ['name', 'value', 'unit', 'low', 'high'])) } : null;
  const weight = sorted.find(r => ['checkup', 'weight'].includes(r.type) && Number(r.weight) > 0);
  summary.latestWeight = weight ? { date: String(weight.date), weight: String(weight.weight) } : null;
  return summary;
}

export function makeTagSummary(pet, { showName = true, showContact = false, contact = '' } = {}) {
  const hasChip = Boolean(String(pet.microchip || '').trim());
  const summary = { v: 1, kind: 'tag', pet: {
    name: showName ? String(pet.name || '') : '',
    kind: String(pet.kind || ''), features: String(pet.features || ''),
    hasChip, allergies: String(pet.allergies || '')
  }, guide: TAG_GUIDE + (hasChip ? CHIP_GUIDE : '') };
  if (showContact && String(contact).trim()) summary.contact = String(contact).trim();
  return summary;
}

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 200000) throw new Error('共有リンクのデータが壊れています。');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export async function encodeSummary(summary) {
  const bytes = new TextEncoder().encode(JSON.stringify(summary));
  if (bytes.length > MAX_JSON_BYTES) throw new Error('共有データが大きすぎます。');
  const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return base64url(new Uint8Array(compressed));
}

export async function decodeSummary(encoded) {
  try {
    const stream = new Blob([fromBase64url(encoded)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new Error('展開後のデータが大きすぎます。'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return validateSummary(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) {
    if (['展開後のデータが大きすぎます。', '共有データの形式が正しくありません。'].includes(error.message)) throw error;
    throw new Error('共有リンクのデータを読み取れませんでした。');
  }
}

function stringFields(object, keys) {
  return object && typeof object === 'object' && !Array.isArray(object) && keys.every(key => typeof object[key] === 'string');
}
function date(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
export function validateSummary(data) {
  if (data?.kind === 'tag') {
    const keys = Object.keys(data);
    const petKeys = data.pet && typeof data.pet === 'object' ? Object.keys(data.pet) : [];
    if (data.v !== 1 || keys.some(key => !['v', 'kind', 'pet', 'guide', 'contact'].includes(key)) ||
        !stringFields(data.pet, ['name', 'kind', 'features', 'allergies']) || typeof data.pet.hasChip !== 'boolean' ||
        petKeys.some(key => !['name', 'kind', 'features', 'allergies', 'hasChip'].includes(key)) ||
        data.guide !== TAG_GUIDE + (data.pet.hasChip ? CHIP_GUIDE : '') ||
        (data.contact !== undefined && typeof data.contact !== 'string')) throw new Error('共有データの形式が正しくありません。');
    return data;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1 || !['karte', 'emergency'].includes(data.kind) ||
      typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt)) ||
      !stringFields(data.pet, PET_FIELDS) || typeof data.pet.birthEstimated !== 'boolean' || typeof data.omitted !== 'boolean') throw new Error('共有データの形式が正しくありません。');
  if (data.pet.birthDate && !date(data.pet.birthDate)) throw new Error('共有データの形式が正しくありません。');
  if (data.kind === 'karte') {
    const rows = (items, fields) => Array.isArray(items) && items.length <= 100 && items.every(item => stringFields(item, fields) && date(item.date));
    if (!rows(data.vaccines, ['date', 'vaccineName', 'nextDate']) || !rows(data.visits, ['date', 'hospital', 'diagnosis', 'treatment', 'prescription']) ||
        (data.checkup !== null && (!stringFields(data.checkup, ['date', 'hospital']) || !date(data.checkup.date) || !Array.isArray(data.checkup.tests) || data.checkup.tests.length > 200 || !data.checkup.tests.every(t => stringFields(t, ['name', 'value', 'unit', 'low', 'high'])))) ||
        (data.latestWeight !== null && (!stringFields(data.latestWeight, ['date', 'weight']) || !date(data.latestWeight.date) || !Number.isFinite(Number(data.latestWeight.weight)) || Number(data.latestWeight.weight) <= 0))) throw new Error('共有データの形式が正しくありません。');
  }
  return data;
}

export async function createShareUrl(summary, baseUrl, maxLength = SHARE_LIMIT) {
  const data = structuredClone(summary);
  const url = new URL(baseUrl);
  url.hash = '';
  if (data.kind === 'tag') {
    for (const key of ['features', 'allergies']) {
      const link = `${url.href}#d=${await encodeSummary(data)}`;
      if (link.length <= maxLength) return { url: link, summary: data };
      data.pet[key] = '';
    }
    const link = `${url.href}#d=${await encodeSummary(data)}`;
    if (link.length <= maxLength) return { url: link, summary: data };
    throw new Error('迷子タグのQRに収まりません。連絡先などを短くしてください。');
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const link = `${url.href}#d=${await encodeSummary(data)}`;
    if (link.length <= maxLength) return { url: link, summary: data };
    data.omitted = true;
    if (data.visits?.length) { data.visits.pop(); continue; }
    if (data.checkup?.tests?.length) { data.checkup.tests.pop(); continue; }
    if (data.vaccines?.length) { data.vaccines.pop(); continue; }
    const values = [data.pet, data.checkup].filter(Boolean).flatMap(object => Object.entries(object).filter(([key, value]) => typeof value === 'string' && key !== 'birthDate' && value.length > 12).map(([key, value]) => ({ object, key, value })));
    values.sort((a, b) => b.value.length - a.value.length);
    if (!values.length) break;
    const { object, key, value } = values[0];
    object[key] = value.slice(0, Math.max(12, Math.floor(value.length * .75))) + '…';
  }
  throw new Error('共有リンクに収まらないため、情報を短くしてからお試しください。');
}

export function formatCreated(value) {
  const d = new Date(value);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function emergencyCardHtml(pet, photoId = '') {
  return `<article class="emergency-card"><div class="emergency-top">${photoId ? `<img data-photo-id="${esc(photoId)}" alt="${esc(pet.name)}の写真">` : ''}<div><h2>🆘 ${esc(pet.name)}</h2><p>${show(pet.kind)} ${pet.breed ? `・${esc(pet.breed)}` : ''}</p><p>毛色・特徴：${show(pet.features)}</p></div></div>
    <section><h3>迷子のとき</h3><p>マイクロチップ番号：<strong>${show(pet.microchip)}</strong></p><p>飼い主の緊急連絡先：<strong>${show(pet.emergencyContact)}</strong></p></section>
    <section><h3>病院に行くとき</h3><p>かかりつけ：${show(pet.hospitalName)}</p><p>病院の電話：<strong>${show(pet.hospitalPhone)}</strong></p><div class="emergency-caution"><p>アレルギー：<strong>${show(pet.allergies)}</strong></p><p>持病・既往歴：<strong>${show(pet.history)}</strong></p><p>常用薬：<strong>${show(pet.medications)}</strong></p></div></section></article>`;
}

export function emergencyCardText(pet) {
  return [`【${pet.name}の緊急カード】`, `種類：${pet.kind || '未登録'} ${pet.breed || ''}`, `毛色・特徴：${pet.features || '未登録'}`, `マイクロチップ：${pet.microchip || '未登録'}`, `飼い主の緊急連絡先：${pet.emergencyContact || '未登録'}`, `かかりつけ病院：${pet.hospitalName || '未登録'}（${pet.hospitalPhone || '未登録'}）`, `アレルギー：${pet.allergies || '未登録'}`, `持病・既往歴：${pet.history || '未登録'}`, `常用薬：${pet.medications || '未登録'}`].join('\n');
}

export function renderSharedHtml(summary) {
  validateSummary(summary);
  if (summary.kind === 'tag') {
    const pet = summary.pet;
    return `<article class="found-pet"><h1>迷子のペットを見つけた方へ</h1>${pet.name ? `<h2>${esc(pet.name)}</h2>` : ''}<p><strong>種類：</strong>${show(pet.kind)}</p>${pet.features ? `<p><strong>毛色・特徴：</strong>${esc(pet.features)}</p>` : ''}${pet.hasChip ? '<p><strong>マイクロチップあり</strong></p>' : ''}${pet.allergies ? `<p><strong>アレルギー：</strong>${esc(pet.allergies)}</p>` : ''}<p class="found-guide">${esc(summary.guide)}</p>${summary.contact ? `<p><strong>公開された連絡先：</strong>${esc(summary.contact)}</p>` : ''}</article>`;
  }
  const header = `<h1>飼い主から共有された健康カルテ（閲覧専用）</h1><p class="karte-updated">作成：${esc(formatCreated(summary.createdAt))}</p>`;
  const notice = summary.omitted ? '<p class="notice soon">一部省略：全体は飼い主のスマホでご確認ください</p>' : '';
  if (summary.kind === 'emergency') return `${header}${notice}${emergencyCardHtml(summary.pet)}<p class="disclaimer">飼い主による記録です。診断は獣医師の判断を優先してください。</p>`;
  const records = [
    ...summary.vaccines.map((r, i) => ({ ...r, type: 'vaccine', id: `v${i}` })),
    ...summary.visits.map((r, i) => ({ ...r, type: 'visit', id: `t${i}` })),
    ...(summary.checkup?.tests.length ? [{ ...summary.checkup, type: 'checkup', id: 'c' }] : []),
    ...(summary.latestWeight ? [{ ...summary.latestWeight, type: 'weight', id: 'w' }] : [])
  ];
  return `${header}${notice}${karteHtml(summary.pet, records, { visitLimit: 3 })}`;
}
