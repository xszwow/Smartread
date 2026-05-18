/* ===== IndexedDB 存储工具 ===== */
const DB_NAME = 'SmartReadDB';
const DB_VERSION = 1;

// HTML 转义，防止 XSS 注入
function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

let _dbInstance = null;

function openDB() {
    if (_dbInstance) return Promise.resolve(_dbInstance);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('books')) {
                db.createObjectStore('books', { keyPath: 'id' });
            }
        };
        req.onsuccess = () => { _dbInstance = req.result; resolve(_dbInstance); };
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(storeName, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(data);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbGetAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGet(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbDelete(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
