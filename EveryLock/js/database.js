const CONFIG = Object.freeze({
  DB_NAME: "EveryLockDB",
  DB_VERSION: 1,
  STORE_NAME: "locked_accounts"
});

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
        db.createObjectStore(CONFIG.STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addLockedAccount(userId, attemptsCount) {
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.STORE_NAME, "readwrite");
      const store = tx.objectStore(CONFIG.STORE_NAME);
      store.add({
        userId: userId,
        timestamp: new Date().toISOString(),
        attempts: attemptsCount,
        status: "LOCKED"
      });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    throw new Error(`DB 저장 실패 (${userId}): ${err.message}`);
  } finally {
    if (db) db.close();
  }
}

export async function getAllLockedAccounts() {
  let db;
  try {
    db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.STORE_NAME, "readonly");
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    throw new Error(`DB 조회 실패: ${err.message}`);
  } finally {
    if (db) db.close();
  }
}

export async function clearDB() {
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.STORE_NAME, "readwrite");
      const store = tx.objectStore(CONFIG.STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    throw new Error(`DB 삭제 실패: ${err.message}`);
  } finally {
    if (db) db.close();
  }
}