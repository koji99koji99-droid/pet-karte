import { all, replaceAll } from './db.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportBackup() {
  const [pets, records, photos] = await Promise.all([all('pets'), all('records'), all('photos')]);
  const encodedPhotos = await Promise.all(photos.map(async photo => ({ id: photo.id, name: photo.name, data: await blobToDataUrl(photo.blob) })));
  const data = { format: 'pet-karte', version: 1, exportedAt: new Date().toISOString(), pets, records, photos: encodedPhotos };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ペット健康カルテ-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== 'pet-karte' || data.version !== 1 || !Array.isArray(data.pets) || !Array.isArray(data.records) || !Array.isArray(data.photos)) {
    throw new Error('このアプリのバックアップファイルではありません。');
  }
  if (data.pets.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.kind !== 'string') ||
      data.records.some(r => !r || typeof r.id !== 'string' || typeof r.petId !== 'string' || typeof r.type !== 'string') ||
      data.photos.some(p => !p || typeof p.id !== 'string' || typeof p.data !== 'string' || !p.data.startsWith('data:image/'))) {
    throw new Error('バックアップの内容が正しくありません。');
  }
  const photos = await Promise.all(data.photos.map(async photo => {
    const response = await fetch(photo.data);
    return { id: photo.id, name: photo.name || '写真', blob: await response.blob() };
  }));
  await replaceAll(data.pets, data.records, photos);
  return data.pets.length;
}
