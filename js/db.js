const NAME = 'pet-karte-v1';
let connection;

export function uid() { return crypto.randomUUID(); }

export function openDb() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('pets', { keyPath: 'id' });
      const records = db.createObjectStore('records', { keyPath: 'id' });
      records.createIndex('petId', 'petId');
      db.createObjectStore('photos', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function all(store) {
  const db = await openDb();
  return requestResult(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, id) {
  const db = await openDb();
  return requestResult(db.transaction(store).objectStore(store).get(id));
}
export async function put(store, item) {
  const db = await openDb();
  return requestResult(db.transaction(store, 'readwrite').objectStore(store).put(item));
}
export async function remove(store, id) {
  const db = await openDb();
  return requestResult(db.transaction(store, 'readwrite').objectStore(store).delete(id));
}
export async function recordsFor(petId) {
  const db = await openDb();
  return requestResult(db.transaction('records').objectStore('records').index('petId').getAll(petId));
}

export async function deleteRecord(record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['records', 'photos'], 'readwrite');
    tx.objectStore('records').delete(record.id);
    for (const id of record.photoIds || []) tx.objectStore('photos').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deletePet(petId) {
  const pet = await get('pets', petId);
  const records = await recordsFor(petId);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['pets', 'records', 'photos'], 'readwrite');
    tx.objectStore('pets').delete(petId);
    if (pet?.photoId) tx.objectStore('photos').delete(pet.photoId);
    for (const record of records) {
      tx.objectStore('records').delete(record.id);
      for (const id of record.photoIds || []) tx.objectStore('photos').delete(id);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function replaceAll(pets, records, photos) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['pets', 'records', 'photos'], 'readwrite');
    for (const name of ['pets', 'records', 'photos']) tx.objectStore(name).clear();
    for (const item of pets) tx.objectStore('pets').put(item);
    for (const item of records) tx.objectStore('records').put(item);
    for (const item of photos) tx.objectStore('photos').put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function resizePhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('画像ファイルを選んでください。');
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) return blob;
    } finally { bitmap.close(); }
  } catch (_) { /* この端末で変換できない形式は元の画像を保存する。 */ }
  return file;
}

export async function storePhoto(file) {
  const blob = await resizePhoto(file);
  const id = uid();
  await put('photos', { id, blob, name: file.name || '写真' });
  return id;
}

export async function photoUrl(id) {
  if (!id) return '';
  const photo = await get('photos', id);
  return photo?.blob ? URL.createObjectURL(photo.blob) : '';
}
