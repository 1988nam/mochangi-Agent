/**
 * 모챙이 - 저장소
 *   - 이미지(base64)는 IndexedDB('mochangi'/'images')에 보관 (용량 큼)
 *   - 프로젝트 메타(컨셉/세트 구성/이미지 id 참조)는 localStorage('mochangi_projects')
 */
const Store = (() => {
  const DB_NAME = 'mochangi';
  const DB_VER = 1;
  const IMG_STORE = 'images';
  const PROJ_KEY = 'mochangi_projects';
  let _db = null;

  function _open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE);
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error || new Error('IndexedDB 열기 실패'));
    });
  }

  function newId(prefix) {
    const rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.floor(Math.random() * 1e9).toString(36);
    return `${prefix || 'id'}_${Date.now().toString(36)}_${rnd}`;
  }

  // ── 이미지 (IndexedDB) ──
  async function saveImage(id, img) {
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).put({ mime: img.mime || 'image/png', data: img.data }, id);
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error || new Error('이미지 저장 실패'));
    });
  }
  async function getImage(id) {
    if (!id) return null;
    const db = await _open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readonly');
      const r = tx.objectStore(IMG_STORE).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error || new Error('이미지 로드 실패'));
    });
  }
  async function deleteImage(id) {
    if (!id) return;
    const db = await _open();
    return new Promise((resolve) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  function dataUrl(img) { return img && img.data ? `data:${img.mime || 'image/png'};base64,${img.data}` : ''; }

  // ── 프로젝트 (localStorage) ──
  function getProjects() {
    try { return JSON.parse(localStorage.getItem(PROJ_KEY) || '[]'); } catch (_) { return []; }
  }
  function _writeProjects(list) { localStorage.setItem(PROJ_KEY, JSON.stringify(list)); }
  function getProject(id) { return getProjects().find(p => p.id === id) || null; }

  function saveProject(project) {
    const list = getProjects();
    project.updatedAt = Date.now();
    const i = list.findIndex(p => p.id === project.id);
    if (i === -1) { project.createdAt = project.createdAt || Date.now(); list.unshift(project); }
    else list[i] = project;
    _writeProjects(list);
    return project;
  }

  async function deleteProject(id) {
    const proj = getProject(id);
    if (proj) {
      const ids = new Set();
      (proj.items || []).forEach(it => {
        if (it.imageId) ids.add(it.imageId);
        (it.history || []).forEach(h => ids.add(h));
      });
      for (const imgId of ids) { try { await deleteImage(imgId); } catch (_) {} }
    }
    _writeProjects(getProjects().filter(p => p.id !== id));
  }

  // 한 컷이 가진 이미지 수(완성 개수) 카운트
  function countDone(project) {
    return (project.items || []).filter(it => it && it.imageId).length;
  }

  return { newId, saveImage, getImage, deleteImage, dataUrl, getProjects, getProject, saveProject, deleteProject, countDone };
})();
