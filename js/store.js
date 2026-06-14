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
  //  opts.fromSync=true: 드라이브에서 받아 캐싱하는 경우 — 다시 업로드하지 않도록 훅 생략
  async function saveImage(id, img, opts) {
    const db = await _open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).put({ mime: img.mime || 'image/png', data: img.data }, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('이미지 저장 실패'));
    });
    if (!(opts && opts.fromSync) && window.Sync && Sync.onImage) { try { Sync.onImage(id, img); } catch (_) {} }
    return id;
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
  async function deleteImage(id, opts) {
    if (!id) return;
    const db = await _open();
    await new Promise((resolve) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    if (!(opts && opts.fromSync) && window.Sync && Sync.onImageDelete) { try { Sync.onImageDelete(id); } catch (_) {} }
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
    if (window.Sync && Sync.onMeta) { try { Sync.onMeta(); } catch (_) {} }
    return project;
  }

  // 병합 결과 등 전체 목록을 한 번에 교체(동기화 훅 발생 안 함)
  function replaceAllProjects(list) { _writeProjects(Array.isArray(list) ? list : []); }

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
    if (window.Sync && Sync.onMeta) { try { Sync.onMeta(); } catch (_) {} }
  }

  // 한 컷이 가진 이미지 수(완성 개수) 카운트
  function countDone(project) {
    return (project.items || []).filter(it => it && it.imageId).length;
  }

  return { newId, saveImage, getImage, deleteImage, dataUrl, getProjects, getProject, saveProject, replaceAllProjects, deleteProject, countDone };
})();
