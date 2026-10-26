import { uid, all, get, put, remove, recordsFor, deleteRecord, deletePet, replaceAll, storePhoto, photoUrl } from './db.js';
import { readPhoto, extractCandidates } from './ocr.js';
import { esc, age, karteHtml, karteText } from './karte.js';
import { weightChart, compareRecords } from './chart.js';
import { exportBackup, importBackup } from './backup.js';
import { makeSummary, createShareUrl, formatCreated, emergencyCardHtml, emergencyCardText } from './share.js';

const app = document.querySelector('#app');
const toastBox = document.querySelector('#toast');
const updateBanner = document.querySelector('#update-banner');
const updateButton = document.querySelector('#update-button');
const APP_VERSION = '1.1.0';
const typeNames = { checkup: '健康診断', vaccine: 'ワクチン', visit: '通院', medication: '投薬', weight: '体重' };
const testNames = ['BUN', 'CRE', 'ALT', 'ALP', 'GLU', 'TP', 'ALB', 'WBC', 'RBC', 'HCT', 'PLT'];
function recall(key) { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key, value) { try { localStorage.setItem(key, value); } catch {} }
function forget(key) { try { localStorage.removeItem(key); } catch {} }
let selectedPetId = recall('selectedPetId') || '';
let photoDraft = null;
let recordFiles = [];
let petFile = null;
let renderToken = 0;
let imageUrls = [];
let hasUnsavedInput = false;
let updateRequested = false;
let serviceWorkerRegistration = null;
let qrScriptPromise;
let currentShareUrl = '';

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrScriptPromise) qrScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error('QRを読み込めませんでした。'));
    script.onerror = () => reject(new Error('QRを読み込めませんでした。'));
    document.head.append(script);
  }).catch(error => { qrScriptPromise = null; throw error; });
  return qrScriptPromise;
}

const today = () => new Date().toLocaleDateString('sv-SE');
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('sv-SE') === value;
}
function toast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastBox.classList.remove('visible'), 4000);
}
function go(route) { location.hash = route; }
function field(label, name, value = '', opts = {}) {
  const id = `f-${name}`;
  const attrs = `${opts.required ? ' required' : ''}${opts.min != null ? ` min="${opts.min}"` : ''}${opts.step ? ` step="${opts.step}"` : ''}`;
  let control;
  if (opts.options) control = `<select id="${id}" name="${name}"${attrs}>${opts.options.map(([v, text]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  else if (opts.textarea) control = `<textarea id="${id}" name="${name}" rows="3">${esc(value)}</textarea>`;
  else control = `<input id="${id}" name="${name}" type="${opts.type || 'text'}" value="${esc(value)}"${attrs}${opts.list ? ` list="${opts.list}"` : ''}>`;
  return `<div class="field"><label for="${id}">${esc(label)}${opts.required ? ' <span aria-hidden="true">＊</span>' : ''}</label>${control}</div>`;
}
function testRow(t = {}) {
  return `<div class="test-row"><div class="test-grid">
    <div class="wide"><label>項目名<input name="testName" list="test-options" value="${esc(t.name || '')}"></label></div>
    <label>値<input name="testValue" inputmode="decimal" value="${esc(t.value || '')}"></label>
    <label>単位<input name="testUnit" value="${esc(t.unit || '')}"></label>
    <label>基準下限<input name="testLow" inputmode="decimal" value="${esc(t.low ?? '')}"></label>
    <label>基準上限<input name="testHigh" inputmode="decimal" value="${esc(t.high ?? '')}"></label>
  </div><button type="button" class="quiet" data-action="remove-test">この行を削除</button></div>`;
}
function basePage(title, body, hint = '') { return `<div class="page-head"><div><p class="eyebrow">${hint}</p><h1>${title}</h1></div></div>${body}`; }
async function chosenPet() {
  const pets = await all('pets');
  if (!pets.length) return null;
  if (!pets.some(p => p.id === selectedPetId)) { selectedPetId = pets[0].id; remember('selectedPetId', selectedPetId); }
  return pets.find(p => p.id === selectedPetId);
}
async function fillImages(scope = app) {
  const token = renderToken;
  const images = [...scope.querySelectorAll('[data-photo-id]')];
  await Promise.all(images.map(async img => {
    const url = await photoUrl(img.dataset.photoId);
    if (url && token === renderToken && img.isConnected) { img.src = url; if (img.closest('[data-photo-link]')) img.closest('[data-photo-link]').href = url; imageUrls.push(url); }
    else if (url) URL.revokeObjectURL(url);
  }));
}
function clearImages() { for (const url of imageUrls) URL.revokeObjectURL(url); imageUrls = []; }
function recordSummary(r) {
  if (r.type === 'vaccine') return r.vaccineName || 'ワクチン';
  if (r.type === 'visit') return r.diagnosis || r.symptoms || '通院の記録';
  if (r.type === 'medication') return r.drugName || '投薬';
  if (r.type === 'weight') return r.weight ? `${r.weight} kg` : '体重';
  return r.findings || (r.weight ? `${r.weight} kg` : '健康診断');
}
function recordCard(r) { return `<a class="card record-card" href="#detail/${encodeURIComponent(r.id)}"><div class="record-meta">${esc(r.date)}　<span class="tag">${esc(typeNames[r.type] || r.type)}</span></div><h3>${esc(recordSummary(r))}</h3><p>${esc(r.hospital || '')}${r.photoIds?.length ? `　📷 ${r.photoIds.length}枚` : ''}</p></a>`; }

async function renderHome() {
  const pets = await all('pets');
  if (!pets.length) return basePage('ペット健康カルテ', `<section class="card hero"><h2>大切な家族の健康を、ひとつに。</h2><p>まずはペットを登録しましょう。名前と種類だけで始められます。</p><a class="button primary large full" href="#pet/new">＋ ペットを登録する</a></section><p class="hint">記録はこの端末に保存されます。</p>`, 'ようこそ');
  const pet = await chosenPet();
  const records = await recordsFor(pet.id);
  const notices = records.flatMap(r => {
    const date = r.type === 'vaccine' ? r.nextDate : r.type === 'visit' ? r.nextAppointment : '';
    if (!validDate(date)) return [];
    const days = Math.round((new Date(`${date}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000);
    if (days > 30) return [];
    return [{ date, days, title: r.type === 'vaccine' ? `${r.vaccineName || 'ワクチン'}の次回予定` : '次回の通院予約' }];
  }).sort((a, b) => a.days - b.days);
  const petCards = pets.map(p => `<button type="button" class="pet-card${p.id === pet.id ? ' selected' : ''}" data-action="select-pet" data-id="${esc(p.id)}" aria-pressed="${p.id === pet.id}">${p.photoId ? `<img data-photo-id="${esc(p.photoId)}" alt="${esc(p.name)}の写真">` : '<span class="pet-placeholder" aria-hidden="true">🐾</span>'}<span><strong>${esc(p.name)}</strong>${esc(age(p.birthDate, p.birthEstimated))}<br><small>${esc(p.kind)}</small></span></button>`).join('');
  return basePage('ホーム', `<div class="stack">
    <section><h2>家族を選ぶ</h2><div class="pet-list">${petCards}</div><div class="button-row"><a class="button" href="#pet/new">＋ ペットを追加</a><a class="button" href="#pet/edit/${encodeURIComponent(pet.id)}">${esc(pet.name)}の情報を編集</a></div></section>
    <section class="card hero"><h2>${esc(pet.name)}のカルテ</h2><p>病院で見せる情報を1画面にまとめます。</p><a class="button primary large full" href="#karte">🩺 獣医さんに見せる</a><a class="button full" href="#emergency">🆘 緊急カード</a></section>
    <section class="card"><h2>お知らせ</h2>${notices.length ? notices.map(n => `<p class="notice ${n.days < 0 ? 'overdue' : 'soon'}">${esc(n.title)}：${esc(n.date)}（${n.days < 0 ? '期限を過ぎています' : n.days === 0 ? '今日' : `あと${n.days}日`}）</p>`).join('') : '<p class="empty">30日以内の予定はありません。</p>'}</section>
    <section class="card"><h2>すぐに記録</h2><div class="actions"><a class="button" href="#record/new/visit">＋ 通院</a><a class="button" href="#record/new/vaccine">＋ ワクチン</a><a class="button" href="#record/new/checkup">＋ 健康診断</a><a class="button" href="#record/new/weight">＋ 体重</a></div><div class="button-row"><a class="button full" href="#photo">📷 写真から入力</a><a class="button full" href="#record/new/medication">＋ 投薬</a></div></section>
    <section><div class="page-head"><h2>最近の記録</h2><a href="#timeline">すべて見る</a></div><div class="stack">${records.sort((a,b) => compareRecords(b,a)).slice(0,3).map(recordCard).join('') || '<p class="empty">まだ記録はありません。</p>'}</div></section>
  </div>`, `${esc(pet.name)}の健康記録`);
}

async function renderPetForm(id) {
  const pet = id ? await get('pets', id) : null;
  if (id && !pet) return basePage('見つかりません', '<a class="button" href="#home">ホームへ</a>');
  petFile = null;
  return basePage(pet ? 'ペットの情報を編集' : 'ペットを登録', `<form id="pet-form" class="card" data-id="${esc(id || '')}">
    ${field('名前', 'name', pet?.name, { required: true })}
    ${field('種類', 'kind', pet?.kind || '', { required: true, options: [['','選んでください'], ...['犬','猫','うさぎ','鳥','その他'].map(v => [v,v])] })}
    ${field('品種', 'breed', pet?.breed)}
    <div class="field-row">${field('性別', 'sex', pet?.sex || '', { options: [['','未登録'],['オス','オス'],['メス','メス']] })}${field('避妊・去勢', 'neutered', pet?.neutered || '', { options: [['','未登録'],['済','済'],['未','未'],['不明','不明']] })}</div>
    ${field('生年月日', 'birthDate', pet?.birthDate, { type: 'date' })}
    <label class="checkline"><input type="checkbox" name="birthEstimated" ${pet?.birthEstimated ? 'checked' : ''}> 生年月日は推定</label>
    ${field('家族になった日', 'joinedDate', pet?.joinedDate, { type: 'date' })}
    ${field('毛色・特徴', 'features', pet?.features, { textarea: true })}
    ${field('マイクロチップ番号', 'microchip', pet?.microchip)}
    <div class="field"><label for="pet-photo">写真</label><input id="pet-photo" type="file" accept="image/*"><small>長辺1600pxに縮小して保存します。</small></div>
    ${pet?.photoId ? `<div class="photo-grid"><figure><img data-photo-id="${esc(pet.photoId)}" alt="現在のペット写真"></figure></div>` : ''}
    <fieldset class="form-section"><legend>獣医さんに伝えること</legend>
      ${field('アレルギー', 'allergies', pet?.allergies, { textarea: true })}
      ${field('持病・既往歴', 'history', pet?.history, { textarea: true })}
      ${field('常用薬', 'medications', pet?.medications, { textarea: true })}
    </fieldset>
    <fieldset class="form-section"><legend>連絡先など</legend>
      ${field('かかりつけ病院名', 'hospitalName', pet?.hospitalName)}
      ${field('かかりつけ病院の電話', 'hospitalPhone', pet?.hospitalPhone, { type: 'tel' })}
      ${field('飼い主の緊急連絡先', 'emergencyContact', pet?.emergencyContact, { type: 'tel' })}
      ${field('メモ', 'notes', pet?.notes, { textarea: true })}
    </fieldset>
    <div class="button-row"><button class="primary" type="submit">保存する</button><a class="button" href="#home">戻る</a></div>
  </form>${pet ? `<div class="button-row"><button type="button" class="danger" data-action="delete-pet" data-id="${esc(pet.id)}">このペットを削除</button></div>` : ''}`, '基本情報');
}

function typeFields(type, r) {
  if (type === 'checkup') return `${field('体重（kg）','weight',r.weight,{type:'number',min:0,step:'any'})}${field('体温（℃）','temperature',r.temperature,{type:'number',min:0,step:'any'})}${field('所見','findings',r.findings,{textarea:true})}<h3>検査値</h3><p class="hint">数値・基準範囲は検査票を確認して入力してください。</p><div id="test-rows">${(r.tests || []).map(testRow).join('')}</div><datalist id="test-options">${testNames.map(v => `<option value="${v}">`).join('')}</datalist><button type="button" data-action="add-test">＋ 行を追加</button>`;
  if (type === 'vaccine') return `${field('ワクチン名','vaccineName',r.vaccineName,{required:true,list:'vaccine-options'})}<datalist id="vaccine-options"><option value="狂犬病"><option value="混合5種"><option value="混合6種"><option value="混合7種"><option value="混合8種"><option value="混合10種"></datalist>${field('次回予定日','nextDate',r.nextDate,{type:'date'})}${field('ロット番号','lotNumber',r.lotNumber)}`;
  if (type === 'visit') return `${field('症状','symptoms',r.symptoms,{textarea:true})}${field('診断名','diagnosis',r.diagnosis)}${field('処置内容','treatment',r.treatment,{textarea:true})}${field('処方薬','prescription',r.prescription,{textarea:true})}${field('費用（円）','cost',r.cost,{type:'number',min:0,step:1})}${field('次回予約日','nextAppointment',r.nextAppointment,{type:'date'})}`;
  if (type === 'medication') return `${field('薬名','drugName',r.drugName,{required:true})}${field('量','dose',r.dose)}${field('期間','period',r.period)}`;
  return field('体重（kg）','weight',r.weight,{type:'number',min:0,step:'any',required:true});
}

async function renderRecordForm(type, id = '') {
  const pet = await chosenPet();
  if (!pet) return basePage('まずペットを登録してください', '<a class="button primary" href="#pet/new">ペットを登録する</a>');
  const existing = id ? await get('records', id) : null;
  if (id && (!existing || existing.petId !== pet.id)) return basePage('記録が見つかりません', '<a class="button" href="#timeline">記録一覧へ</a>');
  if (!typeNames[type]) return basePage('種別が見つかりません', '<a class="button" href="#home">ホームへ</a>');
  recordFiles = photoDraft?.file && !id ? [photoDraft.file] : [];
  const candidates = photoDraft?.candidates || {};
  const r = existing || { date: candidates.date || today(), weight: candidates.weight || '', temperature: candidates.temperature || '', tests: candidates.tests || [], vaccineName: candidates.vaccine || '', ocrText: photoDraft?.text || '' };
  return basePage(`${typeNames[type]}を${id ? '編集' : '記録'}`, `<form id="record-form" class="card" data-id="${esc(id)}" data-type="${esc(type)}">
    <p class="hint">${esc(pet.name)}の記録です。写真からの候補は必ず確認してください。</p>
    ${field('日付','date',r.date,{type:'date',required:true})}${field('病院名','hospital',r.hospital)}
    <fieldset class="form-section"><legend>${esc(typeNames[type])}の内容</legend>${typeFields(type,r)}</fieldset>
    ${field('メモ','memo',r.memo,{textarea:true})}
    <fieldset class="form-section"><legend>写真</legend><div class="field"><label for="record-photo">写真を添付</label><input id="record-photo" type="file" accept="image/*" capture="environment" multiple><small>撮影または選択した写真を記録に添付します。</small></div>
      <div class="photo-grid" id="existing-photos">${(r.photoIds || []).map(photoId => `<figure data-existing-id="${esc(photoId)}"><img data-photo-id="${esc(photoId)}" alt="添付写真"><button type="button" data-action="remove-existing-photo">外す</button></figure>`).join('')}</div><div id="new-photos" class="photo-grid"></div>
    </fieldset>
    ${field('読み取った文字（修正できます）','ocrText',r.ocrText,{textarea:true})}
    <div class="button-row"><button class="primary" type="submit">確認して保存</button><a class="button" href="#timeline">戻る</a></div>
  </form>`, `${esc(pet.name)}の記録`);
}

async function renderTimeline() {
  const pet = await chosenPet();
  if (!pet) return basePage('記録', '<p>まずペットを登録してください。</p><a class="button primary" href="#pet/new">ペットを登録</a>');
  const records = (await recordsFor(pet.id)).sort((a,b) => compareRecords(b,a));
  return basePage('記録の一覧', `<div class="stack"><div class="card"><label class="field-label" for="record-filter">表示する記録</label><select id="record-filter"><option value="all">すべて</option>${Object.entries(typeNames).map(([v,n]) => `<option value="${v}">${n}</option>`).join('')}</select></div><div id="timeline-items" class="stack">${records.map(r => `<div data-record-type="${esc(r.type)}">${recordCard(r)}</div>`).join('') || '<p class="empty">まだ記録はありません。</p>'}</div><div class="button-row"><a class="button primary" href="#record/new/visit">＋ 記録を追加</a><a class="button" href="#home">ホームへ</a></div></div>`, `${esc(pet.name)}の記録`);
}

async function renderDetail(id) {
  const pet = await chosenPet();
  const r = await get('records', id);
  if (!pet || !r || r.petId !== pet.id) return basePage('記録が見つかりません', '<a class="button" href="#timeline">記録一覧へ</a>');
  const rows = [
    ['日付',r.date],['病院',r.hospital],['体重',r.weight ? `${r.weight} kg` : ''],['体温',r.temperature ? `${r.temperature} ℃` : ''],
    ['所見',r.findings],['ワクチン',r.vaccineName],['次回予定',r.nextDate],['ロット番号',r.lotNumber],
    ['症状',r.symptoms],['診断',r.diagnosis],['処置',r.treatment],['処方',r.prescription],['費用',r.cost !== '' && r.cost != null ? `${r.cost} 円` : ''],['次回予約',r.nextAppointment],
    ['薬名',r.drugName],['量',r.dose],['期間',r.period],['メモ',r.memo],['読み取った文字',r.ocrText]
  ].filter(([,value]) => value !== '' && value != null);
  return basePage(`${typeNames[r.type] || r.type}の詳細`, `<article class="card"><div class="stack">${rows.map(([label,value]) => `<div><strong>${esc(label)}</strong><p>${esc(value).replaceAll('\n','<br>')}</p></div>`).join('')}</div>
    ${r.tests?.length ? `<h2>検査値</h2><div class="table-scroll"><table><thead><tr><th>項目</th><th>値</th><th>基準範囲</th></tr></thead><tbody>${r.tests.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.value)} ${esc(t.unit)}</td><td>${esc(t.low || '―')} ～ ${esc(t.high || '―')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${r.photoIds?.length ? `<h2>添付写真</h2><div class="photo-grid">${r.photoIds.map(photoId => `<figure><a class="photo-link" data-photo-link="${esc(photoId)}" target="_blank" rel="noopener"><img data-photo-id="${esc(photoId)}" alt="添付写真を拡大"></a></figure>`).join('')}</div>` : ''}
  </article><div class="button-row"><a class="button primary" href="#record/edit/${encodeURIComponent(r.id)}">編集する</a><button class="danger" type="button" data-action="delete-record" data-id="${esc(r.id)}">削除する</button><a class="button" href="#timeline">一覧へ戻る</a></div>`, `${esc(pet.name)}の記録`);
}

async function renderChart() {
  const pet = await chosenPet();
  if (!pet) return basePage('体重グラフ', '<a class="button" href="#pet/new">ペットを登録</a>');
  const records = await recordsFor(pet.id);
  return basePage('体重グラフ', `<section class="card"><h2>${esc(pet.name)}の体重</h2>${weightChart(records)}<p class="hint">健康診断と体重記録を日付順に表示しています。</p></section><div class="button-row"><a class="button primary" href="#record/new/weight">＋ 体重を記録</a></div>`, '日々の変化');
}

async function renderKarte() {
  const pet = await chosenPet();
  if (!pet) return basePage('カルテ', '<a class="button" href="#pet/new">ペットを登録</a>');
  const records = await recordsFor(pet.id);
  return basePage('獣医さんに見せる', `<div class="button-row no-print"><button type="button" class="primary" data-action="print">印刷 / PDF保存</button><button type="button" data-action="copy-karte">テキストでコピー</button><a class="button" href="#qr/karte">📱 QRで渡す</a></div>${karteHtml(pet,records)}<div class="button-row no-print"><a class="button" href="#home">ホームへ</a></div>`, `${esc(pet.name)}のカルテ`);
}

async function renderEmergency() {
  const pet = await chosenPet();
  if (!pet) return basePage('緊急カード', '<a class="button primary" href="#pet/new">ペットを登録する</a>');
  return basePage('🆘 緊急カード', `<div class="button-row no-print"><a class="button primary" href="#qr/emergency">📱 QRで渡す</a><button type="button" data-action="print">印刷する</button></div>${emergencyCardHtml(pet, pet.photoId)}<div class="button-row no-print"><a class="button" href="#home">ホームへ</a></div>`, `${esc(pet.name)}の緊急情報`);
}

async function renderQr(kind, token) {
  if (!['karte', 'emergency'].includes(kind)) return basePage('ページが見つかりません', '<a href="#home">ホームへ</a>');
  const pet = await chosenPet();
  if (!pet) return basePage('QRで渡す', '<a class="button primary" href="#pet/new">ペットを登録する</a>');
  const summary = makeSummary(pet, kind === 'karte' ? await recordsFor(pet.id) : [], kind);
  const result = await createShareUrl(summary, new URL('view.html', location.href));
  if (token === renderToken) currentShareUrl = result.url;
  return basePage('📱 QRで渡す', `<div class="qr-page"><p>このQRには${esc(pet.name)}の健康情報が入っています。見せる相手を選んでください。</p><p>作成：${esc(formatCreated(result.summary.createdAt))}</p><div id="qr-image" class="qr-image" role="img" aria-label="共有用QRコード"><p class="loading">QRを準備しています…</p></div><p id="qr-status" class="hint" role="status"></p><div class="button-row"><button type="button" data-action="copy-link">リンクをコピー</button><button type="button" data-action="copy-karte">テキストでコピー</button></div><a class="button full" href="#${kind === 'karte' ? 'karte' : 'emergency'}">戻る</a></div>`, `${esc(pet.name)}の${kind === 'karte' ? 'カルテ' : '緊急カード'}`);
}

async function drawQr(url, token) {
  const box = document.querySelector('#qr-image');
  const status = document.querySelector('#qr-status');
  try {
    const qrcode = await loadQr();
    if (token !== renderToken || !box?.isConnected) return;
    const qr = qrcode(0, 'L');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag(4, 16);
    status.textContent = '獣医さんのスマホで読み取ってください。';
  } catch {
    if (token !== renderToken || !box?.isConnected) return;
    box.textContent = 'QRコードを表示できません。';
    status.textContent = '通信できる場所でお試しください。テキストでコピーも使えます。';
  }
}

async function renderPhoto() {
  const pet = await chosenPet();
  if (!pet) return basePage('写真から入力', '<a class="button primary" href="#pet/new">まずペットを登録</a>');
  photoDraft = null;
  return basePage('写真から入力', `<div class="stack"><section class="card"><p>検査票やワクチン証明書を撮影・選択してください。読み取りに失敗しても、写真を添付して手入力できます。</p>
    <div class="field"><label for="ocr-photo">写真を撮る・選ぶ</label><input id="ocr-photo" type="file" accept="image/*" capture="environment"></div>
    <img id="ocr-preview" class="ocr-preview hide" alt="選んだ写真のプレビュー"><p id="ocr-status" class="status" role="status">写真を選んでください。</p></section>
    <section class="card"><div class="field"><label for="ocr-text">読み取った文字（修正できます）</label><textarea id="ocr-text" rows="7" placeholder="読み取り結果がここに表示されます。手入力もできます。"></textarea></div>
    <button type="button" data-action="apply-ocr">文字から候補を取り直す</button></section>
    <section class="card"><h2>記録の種類を選ぶ</h2><p class="hint">候補を入力フォームに入れます。確認してから保存してください。</p><div class="actions">${Object.entries(typeNames).map(([v,n]) => `<button type="button" data-action="photo-to-record" data-type="${v}">${n}</button>`).join('')}</div></section></div>`, `${esc(pet.name)}の記録`);
}

function renderSettings() {
  return basePage('設定・バックアップ', `<div class="stack"><section class="card"><h2>緊急時に使う</h2><a class="button full" href="#emergency">🆘 緊急カード</a></section><section class="card"><h2>バックアップ</h2><p>写真を含むすべてのデータを1つのJSONファイルに保存します。機種変更前に書き出してください。</p><button type="button" class="button full" data-action="export">バックアップを書き出す</button><div class="field backup-import"><label for="backup-file">バックアップを読み込む</label><input id="backup-file" type="file" accept="application/json,.json"></div><p class="hint">読み込み時は現在の全データを置き換えます。</p></section>
    <section class="card"><h2>動作確認</h2><p>MIX犬「くーちゃん」のサンプル記録を追加・更新します。</p><button type="button" class="button full" data-action="sample">サンプルデータを入れる</button></section>
    <section class="card"><h2>データの削除</h2><p>この端末のペット・記録・写真をすべて削除します。</p><button type="button" class="danger full" data-action="clear-all">全データを消す</button></section>
    <p class="hint">データはこの端末のブラウザ内にだけ保存されます。バックアップファイルには個人情報と写真が含まれます。</p><small class="app-version">バージョン ${APP_VERSION}</small></div>`, 'この端末のデータ');
}

async function render() {
  const token = ++renderToken;
  currentShareUrl = '';
  clearImages();
  const path = decodeURIComponent(location.hash.slice(1) || 'home').split('/');
  let html;
  try {
    if (path[0] === 'home') html = await renderHome();
    else if (path[0] === 'pet') html = await renderPetForm(path[1] === 'edit' ? path[2] : '');
    else if (path[0] === 'record' && path[1] === 'new') html = await renderRecordForm(path[2] || 'visit');
    else if (path[0] === 'record' && path[1] === 'edit') { const r = await get('records', path[2]); html = r ? await renderRecordForm(r.type, r.id) : basePage('見つかりません','<a href="#timeline">一覧へ</a>'); }
    else if (path[0] === 'timeline') html = await renderTimeline();
    else if (path[0] === 'detail') html = await renderDetail(path[1]);
    else if (path[0] === 'chart') html = await renderChart();
    else if (path[0] === 'karte') html = await renderKarte();
    else if (path[0] === 'emergency') html = await renderEmergency();
    else if (path[0] === 'qr') html = await renderQr(path[1], token);
    else if (path[0] === 'photo') html = await renderPhoto();
    else if (path[0] === 'settings') html = renderSettings();
    else html = basePage('ページが見つかりません','<a class="button" href="#home">ホームへ</a>');
    if (token !== renderToken) return;
    app.innerHTML = html;
    hasUnsavedInput = false;
    await fillImages();
    if (path[0] === 'qr' && currentShareUrl) drawQr(currentShareUrl, token);
    if (path[0] === 'record' && path[1] === 'new') updateNewPhotos();
    window.scrollTo(0,0);
  } catch (error) {
    console.error(error);
    app.innerHTML = basePage('画面を表示できませんでした', `<p class="error">${esc(error.message || '保存領域を確認してください。')}</p><a class="button" href="#home">ホームへ</a>`);
  }
}

function updateNewPhotos() {
  const box = document.querySelector('#new-photos');
  if (!box) return;
  box.innerHTML = '';
  recordFiles.forEach((file,i) => {
    const figure = document.createElement('figure');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    imageUrls.push(img.src);
    img.alt = '新しい添付写真';
    const caption = document.createElement('figcaption');
    caption.textContent = file.name || `写真${i+1}`;
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.action = 'remove-new-photo'; button.dataset.index = i; button.textContent = '外す';
    figure.append(img, caption, button); box.append(figure);
  });
}

function formValue(form, name) { return form.elements[name]?.value?.trim() || ''; }
function requireDate(form, name, label) {
  const value = formValue(form,name);
  if (value && !validDate(value)) throw new Error(`${label}を正しい日付で入力してください。`);
  return value;
}
function requireWeight(form, required = false) {
  const value = formValue(form,'weight');
  if (!value && !required) return '';
  if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error('体重は0より大きい数値で入力してください。');
  return Number(value);
}
function numberOrEmpty(value, label, min = 0) {
  if (value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`${label}は${min}以上の数値で入力してください。`);
  return n;
}

async function savePet(form) {
  const id = form.dataset.id || uid();
  const old = form.dataset.id ? await get('pets', id) : null;
  const pet = { ...(old || {}), id, name: formValue(form,'name'), kind: formValue(form,'kind'), breed: formValue(form,'breed'), sex: formValue(form,'sex'), neutered: formValue(form,'neutered'),
    birthDate: requireDate(form,'birthDate','生年月日'), birthEstimated: form.elements.birthEstimated.checked, joinedDate: requireDate(form,'joinedDate','家族になった日'),
    features: formValue(form,'features'), microchip: formValue(form,'microchip'), allergies: formValue(form,'allergies'), history: formValue(form,'history'), medications: formValue(form,'medications'),
    hospitalName: formValue(form,'hospitalName'), hospitalPhone: formValue(form,'hospitalPhone'), emergencyContact: formValue(form,'emergencyContact'), notes: formValue(form,'notes') };
  if (!pet.name || !pet.kind) throw new Error('名前と種類を入力してください。');
  if (petFile) pet.photoId = await storePhoto(petFile);
  await put('pets',pet);
  if (old?.photoId && petFile) await remove('photos',old.photoId);
  selectedPetId = id; remember('selectedPetId',id);
  petFile = null;
  toast('ペットの情報を保存しました。'); go('home');
}

function readTests(form) {
  return [...form.querySelectorAll('.test-row')].map(row => {
    const value = name => row.querySelector(`[name="${name}"]`).value.trim();
    const t = { name:value('testName'), value:value('testValue'), unit:value('testUnit'), low:value('testLow'), high:value('testHigh') };
    if (!Object.values(t).some(Boolean)) return null;
    if (!t.name || !t.value) throw new Error('検査値は項目名と値を入力してください。');
    for (const key of ['value','low','high']) if (t[key] && !Number.isFinite(Number(t[key]))) throw new Error('検査値と基準範囲は数値で入力してください。');
    return t;
  }).filter(Boolean);
}

async function saveRecord(form) {
  const type = form.dataset.type;
  const pet = await chosenPet();
  if (!pet) throw new Error('ペットを選んでください。');
  const old = form.dataset.id ? await get('records',form.dataset.id) : null;
  if (old && old.petId !== pet.id) throw new Error('この記録は編集できません。');
  const r = { ...(old || {}), id: old?.id || uid(), createdAt: old?.createdAt || new Date().toISOString(), petId: pet.id, type,
    date: requireDate(form,'date','日付'), hospital:formValue(form,'hospital'), memo:formValue(form,'memo'), ocrText:formValue(form,'ocrText') };
  if (!r.date) throw new Error('日付を入力してください。');
  if (type === 'checkup' || type === 'weight') r.weight = requireWeight(form, type === 'weight');
  if (type === 'checkup') { r.temperature = numberOrEmpty(formValue(form,'temperature'),'体温'); r.findings = formValue(form,'findings'); r.tests = readTests(form); }
  if (type === 'vaccine') { r.vaccineName = formValue(form,'vaccineName'); r.nextDate = requireDate(form,'nextDate','次回予定日'); r.lotNumber = formValue(form,'lotNumber'); if (!r.vaccineName) throw new Error('ワクチン名を入力してください。'); }
  if (type === 'visit') { r.symptoms = formValue(form,'symptoms'); r.diagnosis = formValue(form,'diagnosis'); r.treatment = formValue(form,'treatment'); r.prescription = formValue(form,'prescription'); r.cost = numberOrEmpty(formValue(form,'cost'),'費用'); r.nextAppointment = requireDate(form,'nextAppointment','次回予約日'); }
  if (type === 'medication') { r.drugName = formValue(form,'drugName'); r.dose = formValue(form,'dose'); r.period = formValue(form,'period'); if (!r.drugName) throw new Error('薬名を入力してください。'); }
  const retained = [...form.querySelectorAll('[data-existing-id]')].map(el => el.dataset.existingId);
  const newIds = [];
  for (const file of recordFiles) newIds.push(await storePhoto(file));
  r.photoIds = [...retained,...newIds];
  await put('records',r);
  for (const oldId of old?.photoIds || []) if (!retained.includes(oldId)) await remove('photos',oldId);
  photoDraft = null; recordFiles = [];
  toast('記録を保存しました。'); go('timeline');
}

async function handleOcrFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください。');
  photoDraft = { file, text:'', candidates:{} };
  const preview = document.querySelector('#ocr-preview');
  if (preview) { preview.src = URL.createObjectURL(file); imageUrls.push(preview.src); preview.classList.remove('hide'); }
  const status = document.querySelector('#ocr-status');
  status.textContent = '文字を読み取っています。写真は手入力でも添付できます。';
  try {
    const text = await readPhoto(file, progress => { if (status?.isConnected) status.textContent = `文字を読み取っています… ${progress}%`; });
    if (photoDraft?.file !== file) return;
    photoDraft.text = text;
    photoDraft.candidates = extractCandidates(text);
    const box = document.querySelector('#ocr-text');
    if (box?.isConnected) box.value = text;
    if (status?.isConnected) status.textContent = text ? '読み取りが終わりました。文字と入力候補を確認してください。' : '文字を見つけられませんでした。写真添付と手入力は使えます。';
  } catch (error) {
    if (status?.isConnected) status.textContent = '文字読み取りを利用できません。写真添付と手入力は使えます。';
  }
}

async function addSample() {
  const existing = (await all('pets')).find(p => p.isSample || (p.name === 'くーちゃん' && p.notes === 'サンプルデータです。'));
  const id = existing?.id || uid();
  const pet = { ...(existing || {}), id, isSample:true, name:'くーちゃん', kind:'犬', breed:'MIX', sex:'オス', neutered:'済', birthDate:existing?.birthDate || dayOffset(-365*6), birthEstimated:true, joinedDate:existing?.joinedDate || dayOffset(-365*5), features:'茶色い毛、胸元が白い', microchip:'', allergies:'鶏肉（皮膚のかゆみ）', history:'外耳炎（2026年8月、治療済み）', medications:'なし', hospitalName:'さくら動物病院', hospitalPhone:'000-0000-0000（サンプル）', emergencyContact:'サンプル（飼い主携帯）', notes:'サンプルデータです。' };
  if (existing) {
    await put('pets', pet);
    selectedPetId = id; remember('selectedPetId', id);
    toast('くーちゃんのサンプルを更新しました。'); go('home');
    return;
  }
  const base = { petId:id, hospital:'さくら動物病院', memo:'', photoIds:[] };
  const items = [
    { type:'checkup', date:dayOffset(-300), weight:8.2, temperature:38.3, tests:[{name:'ALT',value:'46',unit:'U/L',low:'10',high:'100'},{name:'BUN',value:'19',unit:'mg/dL',low:'7',high:'27'}], findings:'大きな異常なし' },
    { type:'checkup', date:dayOffset(-30), weight:8.6, temperature:38.5, tests:[{name:'ALT',value:'155',unit:'U/L',low:'10',high:'100'},{name:'CRE',value:'1.1',unit:'mg/dL',low:'0.5',high:'1.8'}], findings:'ALT高値。獣医師に相談済み' },
    { type:'vaccine', date:dayOffset(-170), vaccineName:'狂犬病', nextDate:dayOffset(20), lotNumber:'SAMPLE-01' },
    { type:'vaccine', date:dayOffset(-240), vaccineName:'混合5種', nextDate:dayOffset(120), lotNumber:'SAMPLE-02' },
    { type:'visit', date:dayOffset(-80), symptoms:'耳をかく', diagnosis:'外耳炎', treatment:'耳の洗浄', prescription:'点耳薬', cost:4500, nextAppointment:'' },
    { type:'visit', date:dayOffset(-15), symptoms:'食欲が少ない', diagnosis:'経過観察', treatment:'診察', prescription:'なし', cost:3000, nextAppointment:dayOffset(10) },
    { type:'weight', date:dayOffset(-220), weight:8.3 },{ type:'weight', date:dayOffset(-120), weight:8.5 },{ type:'weight', date:dayOffset(-5), weight:8.4 }
  ];
  await put('pets',pet);
  for (const item of items) await put('records',{ ...base, ...item, id:uid(), createdAt:new Date().toISOString() });
  selectedPetId = id; remember('selectedPetId',id);
  toast('くーちゃんのサンプルを追加しました。'); go('home');
}

function markUnsavedInput(event) {
  if (event.target.matches('input, select, textarea')) hasUnsavedInput = true;
}
app.addEventListener('input', markUnsavedInput);
app.addEventListener('change', markUnsavedInput);

app.addEventListener('submit', async event => {
  if (!['pet-form','record-form'].includes(event.target.id)) return;
  event.preventDefault();
  const button = event.target.querySelector('[type=submit]');
  button.disabled = true;
  try { if (event.target.id === 'pet-form') await savePet(event.target); else await saveRecord(event.target); }
  catch (error) { toast(error.message || '保存できませんでした。'); button.disabled = false; }
});

app.addEventListener('change', async event => {
  const target = event.target;
  try {
    if (target.id === 'pet-photo') petFile = target.files[0] || null;
    if (target.id === 'record-photo') { recordFiles.push(...[...target.files]); target.value = ''; updateNewPhotos(); }
    if (target.id === 'ocr-photo') await handleOcrFile(target.files[0]);
    if (target.id === 'record-filter') document.querySelectorAll('[data-record-type]').forEach(el => el.classList.toggle('hide', target.value !== 'all' && el.dataset.recordType !== target.value));
    if (target.id === 'backup-file' && target.files[0]) {
      if (!confirm('現在の全データをバックアップの内容に置き換えます。よろしいですか？')) { target.value = ''; return; }
      const count = await importBackup(target.files[0]);
      selectedPetId = ''; forget('selectedPetId');
      toast(`${count}匹のペットを復元しました。`); go('home'); if (location.hash === '#home') render();
    }
  } catch (error) { toast(error.message || '処理できませんでした。'); }
});

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'select-pet') { selectedPetId = button.dataset.id; remember('selectedPetId',selectedPetId); await render(); }
    if (action === 'add-test') document.querySelector('#test-rows').insertAdjacentHTML('beforeend',testRow());
    if (action === 'remove-test') button.closest('.test-row').remove();
    if (action === 'remove-existing-photo') button.closest('figure').remove();
    if (action === 'remove-new-photo') { recordFiles.splice(Number(button.dataset.index),1); updateNewPhotos(); }
    if (action === 'delete-record') {
      if (!confirm('この記録と添付写真を削除します。元に戻せません。よろしいですか？')) return;
      const r = await get('records',button.dataset.id); if (r) await deleteRecord(r);
      toast('記録を削除しました。'); go('timeline');
    }
    if (action === 'delete-pet') {
      if (!confirm('このペットとすべての記録・写真を削除します。よろしいですか？')) return;
      await deletePet(button.dataset.id); selectedPetId = ''; forget('selectedPetId'); toast('ペットを削除しました。'); go('home');
    }
    if (action === 'apply-ocr') {
      const text = document.querySelector('#ocr-text').value;
      photoDraft ||= { file:null, text:'', candidates:{} };
      photoDraft.text = text; photoDraft.candidates = extractCandidates(text);
      toast('文字から候補を取り直しました。');
    }
    if (action === 'photo-to-record') {
      const text = document.querySelector('#ocr-text').value;
      photoDraft ||= { file:null, text:'', candidates:{} };
      photoDraft.text = text; photoDraft.candidates = extractCandidates(text);
      go(`record/new/${button.dataset.type}`);
    }
    if (action === 'print') window.print();
    if (action === 'copy-karte') {
      const pet = await chosenPet();
      const emergency = location.hash === '#qr/emergency';
      await navigator.clipboard.writeText(emergency ? emergencyCardText(pet) : karteText(pet,await recordsFor(pet.id)));
      toast(`${emergency ? '緊急カード' : 'カルテ'}をテキストでコピーしました。`);
    }
    if (action === 'copy-link' && currentShareUrl) { await navigator.clipboard.writeText(currentShareUrl); toast('共有リンクをコピーしました。'); }
    if (action === 'export') { await exportBackup(); toast('バックアップを書き出しました。'); }
    if (action === 'sample') { button.disabled = true; try { await addSample(); } finally { button.disabled = false; } }
    if (action === 'clear-all') {
      if (!confirm('この端末の全データを削除します。よろしいですか？')) return;
      if (!confirm('最終確認です。すべてのペット、記録、写真を元に戻せなくなります。削除しますか？')) return;
      await replaceAll([],[],[]); selectedPetId = ''; forget('selectedPetId'); toast('全データを削除しました。'); go('home'); if (location.hash === '#home') render();
    }
  } catch (error) { toast(error.message || '操作できませんでした。'); }
});

window.addEventListener('hashchange',render);
window.addEventListener('beforeprint', () => { if (!['#karte', '#emergency'].includes(location.hash)) toast('カルテか緊急カードの画面で印刷してください。'); });
function showWaitingUpdate(registration) {
  if (registration.waiting && navigator.serviceWorker.controller) updateBanner.classList.remove('hide');
}
function watchInstalling(registration) {
  const installing = registration.installing;
  if (!installing) return;
  installing.addEventListener('statechange', () => {
    if (installing.state === 'installed') showWaitingUpdate(registration);
  });
  if (installing.state === 'installed') showWaitingUpdate(registration);
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
    serviceWorkerRegistration = registration;
    registration.addEventListener('updatefound', () => watchInstalling(registration));
    watchInstalling(registration);
    showWaitingUpdate(registration);
  }).catch(() => {});
}
updateButton.addEventListener('click', () => {
  const waiting = serviceWorkerRegistration?.waiting;
  if (!waiting) return;
  if (hasUnsavedInput && !confirm('入力中の内容は保存されません。更新しますか？')) return;
  updateRequested = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
});
render();
