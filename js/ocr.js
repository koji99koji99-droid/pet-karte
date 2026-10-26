const TEST_NAMES = {
  BUN:'BUN', CRE:'CRE', ALT:'ALT', ALP:'ALP', GLU:'GLU', TP:'TP', ALB:'ALB',
  WBC:'WBC', RBC:'RBC', HCT:'HCT', PLT:'PLT', AST:'AST', GGT:'GGT',
  TBIL:'T-Bil', 'T-BIL':'T-Bil', TCHO:'T-Cho', 'T-CHO':'T-Cho',
  CA:'Ca', P:'P', NA:'Na', K:'K', CL:'Cl', HGB:'HGB', HB:'HGB', SDMA:'SDMA'
};
const TEST_NAME = /(?<![A-Za-z0-9])(?:T-BIL|T-CHO|TBIL|TCHO|BUN|CRE|ALT|ALP|GLU|ALB|WBC|RBC|HCT|PLT|AST|GGT|HGB|SDMA|TP|HB|CA|NA|CL|P|K)(?![A-Za-z0-9])/gi;
const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
const UNIT = /^(×\s*10\s*\^?3\s*\/\s*μL|10\s*\^?4\s*\/\s*μL|K\s*\/\s*μL|\/\s*μL|mmol\s*\/\s*L|mEq\s*\/\s*L|mg\s*\/\s*dL|g\s*\/\s*dL|U\s*\/\s*L|%)/i;
let scriptPromise;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCRを読み込めませんでした。'));
    script.onerror = () => reject(new Error('OCRを読み込めませんでした。'));
    document.head.append(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}

export async function readPhoto(blob, onProgress = () => {}) {
  const tesseract = await loadTesseract();
  const worker = await tesseract.createWorker('jpn+eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.0.0',
    gzip: false,
    logger: event => {
    if (event.status === 'recognizing text') onProgress(Math.round((event.progress || 0) * 100));
    }
  });
  try {
    const result = await worker.recognize(blob);
    return result.data.text || '';
  } finally { await worker.terminate(); }
}

export function extractCandidates(text) {
  const lines = String(text ?? '').normalize('NFKC').split(/\r?\n/);
  const normalized = lines.join('\n');
  const weight = normalized.match(new RegExp(`体重\\s*[:：]?\\s*(${NUMBER})\\s*kg\\b`, 'i'))?.[1] || '';
  const temperature = extractTemperature(lines);
  return {
    date: extractDate(lines), weight: numberValue(weight), temperature,
    tests: extractTests(lines), vaccine: extractVaccine(lines)
  };
}

function extractTemperature(lines) {
  const unit = '(?:[°oº"]?C|度)';
  const labeled = new RegExp(`(?:体温|(?<![A-Za-z])BT(?![A-Za-z])|(?<![A-Za-z])T(?![A-Za-z-]))\\s*[:：]?\\s*(${NUMBER})(?![\\d,.])\\s*(${unit}|[°oº"]?F)?`, 'gi');
  const withUnit = new RegExp(`(${NUMBER})(?![\\d,.])\\s*(${unit})`, 'gi');
  const valid = match => {
    if (!match || /F$/i.test(match[2] || '')) return '';
    const value = numberValue(match[1]);
    return Number(value) >= 30 && Number(value) <= 43 ? value : '';
  };
  for (const line of lines) {
    for (const match of line.matchAll(labeled)) {
      const value = valid(match);
      if (value) return value;
    }
  }
  for (const line of lines) {
    for (const match of line.matchAll(withUnit)) {
      const value = valid(match);
      if (value) return value;
    }
  }
  return '';
}

function numberValue(value) {
  if (!value) return '';
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(value)) return value.replaceAll(',', '');
  return value.replace(',', '.');
}

function calendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDate(lines) {
  const found = [];
  const pattern = /(令和|平成)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?|((?:19|20)\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/g;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      const year = match[1] ? (match[1] === '令和' ? 2018 : 1988) + (match[2] === '元' ? 1 : Number(match[2])) : Number(match[5]);
      const date = calendarDate(year, Number(match[3] || match[6]), Number(match[4] || match[7]));
      if (date) found.push({ date, labeled: /(?:検査日|受診日|接種日|採血日|診察日|診療日)/.test(line.slice(0, match.index)) });
    }
  }
  return found.find(item => item.labeled)?.date || found[0]?.date || '';
}

function unitValue(value) {
  const compact = value.replaceAll(/\s+/g, '');
  if (/^×10\^?3\/μL$/i.test(compact)) return '×10^3/μL';
  if (/^10\^?4\/μL$/i.test(compact)) return '10^4/μL';
  return { 'k/μl':'K/μL', '/μl':'/μL', 'mmol/l':'mmol/L', 'meq/l':'mEq/L',
    'mg/dl':'mg/dL', 'g/dl':'g/dL', 'u/l':'U/L', '%':'%' }[compact.toLowerCase()] || '';
}

function extractTests(lines) {
  const tests = [];
  const valuePattern = new RegExp(`^\\s*[:：]?\\s*(${NUMBER})(?![\\d,.])`);
  const rangePattern = new RegExp(`^\\s*(?:\\(\\s*|\\[\\s*)?(${NUMBER})\\s*[-〜～~]\\s*(${NUMBER})(?![\\d,.])\\s*(?:\\)|\\])?`);
  for (const line of lines) {
    for (const nameMatch of line.matchAll(TEST_NAME)) {
      const afterName = line.slice(nameMatch.index + nameMatch[0].length);
      const valueMatch = afterName.match(valuePattern);
      if (!valueMatch) continue;
      let rest = afterName.slice(valueMatch[0].length);
      if (/^\s*[-〜～~]\s*\d/.test(rest)) continue;
      const unitMatch = rest.trimStart().match(UNIT);
      const unit = unitMatch ? unitValue(unitMatch[0]) : '';
      if (unitMatch) rest = rest.trimStart().slice(unitMatch[0].length);
      const rangeMatch = rest.match(rangePattern);
      tests.push({
        name: TEST_NAMES[nameMatch[0].toUpperCase()], value: numberValue(valueMatch[1]), unit,
        low: rangeMatch ? numberValue(rangeMatch[1]) : '',
        high: rangeMatch ? numberValue(rangeMatch[2]) : ''
      });
    }
  }
  return tests;
}

function extractVaccine(lines) {
  for (const line of lines) {
    if (line.includes('狂犬病')) return '狂犬病';
    const mixed = line.match(/混合[^\d\n]{0,12}(\d{1,2})\s*種|(?<!\d)(\d{1,2})\s*種\s*混合/);
    if (mixed) return `混合${mixed[1] || mixed[2]}種`;
  }
  return lines.find(line => line.includes('ワクチン'))?.trim() || '';
}
