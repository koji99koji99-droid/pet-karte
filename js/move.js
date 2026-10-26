export const MOVE_ITEMS = [
  ['chip', 'マイクロチップの登録内容（住所・電話番号）を変更する（30日以内）'],
  ['municipal', '引っ越し先の市区町村での手続きを確かめる'],
  ['hospital', '新しいかかりつけの動物病院を探す'],
  ['karte', '最初の受診で「🩺 獣医さんに見せる」カルテを見せる（QR・印刷）'],
  ['tag', '迷子タグを新しく印刷し直す（連絡先を載せている場合）'],
  ['backup', '機種変更もする場合は、先にバックアップを書き出す']
];

export function chipNotices(pet, now = new Date()) {
  const notices = [];
  if (String(pet.microchip || '').trim() && pet.chipRegistration !== '済み') {
    notices.push('マイクロチップの登録を確かめましょう');
  }
  const checked = pet.chipCheckedAt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(checked || '')) {
    const day = new Date(`${checked}T00:00:00`);
    const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    if (!Number.isNaN(day.getTime()) && day <= cutoff) notices.push('登録内容（住所・電話番号）が今のままか確かめましょう');
  }
  return notices;
}

export function moveItemsFor(pet) {
  return MOVE_ITEMS.filter(([id]) => id !== 'municipal' || pet.kind === '犬');
}
