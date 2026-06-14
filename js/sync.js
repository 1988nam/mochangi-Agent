/**
 * 모챙이 - Google Drive 동기화 오케스트레이션
 *   - 로그인 시 pull(병합) → 이후 변경마다 자동 push(디바운스) + 이미지 업로드(큐)
 *   - 이미지는 필요할 때 지연 다운로드(fetchImage)
 *   - 병합: 프로젝트 id별 updatedAt 최신 우선 + lastPull 기반 삭제 전파(로컬 신규는 보존)
 */
const Sync = (() => {
  const META_NAME = 'mochangi_projects.json';
  const LS_LASTPULL = 'mochangi_last_pull';
  let _folderId = null;
  let _files = new Map();      // name -> {id, modifiedTime}
  let _metaId = null;
  let _metaTimer = null;
  let _imgQueue = [];
  let _imgRunning = false;
  let _imgInProgress = new Set();   // 업로드 진행 중인 imageId(중복 업로드 방지)
  let _deleted = new Set();         // 최근 삭제된 imageId(인플라이트 업로드가 부활시키지 않게)
  let _pulling = false;
  let _status = 'off';

  function active() { return typeof Auth !== 'undefined' && Auth.isLoggedIn() && !!_folderId; }
  function _imgName(id) { return id + '.png'; }

  function _setStatus(s, text) {
    _status = s;
    const el = document.getElementById('sync-status');
    const btn = document.getElementById('sync-btn');
    const map = { off: '⚪ 로컬 전용', connecting: '🟡 연결 중...', synced: '🟢 동기화됨', syncing: '🔵 동기화 중...', error: '🔴 동기화 오류' };
    if (el) el.textContent = text || map[s] || s;
    if (btn) btn.textContent = (s === 'off') ? '☁️ 연결' : '🔄 동기화';
  }
  function status() { return _status; }

  // ── 병합 ──
  function _merge(localList, remoteList, lastPull) {
    const byId = {};
    (localList || []).forEach(p => { byId[p.id] = { local: p }; });
    (remoteList || []).forEach(p => { byId[p.id] = Object.assign(byId[p.id] || {}, { remote: p }); });
    const out = [];
    for (const id in byId) {
      const { local, remote } = byId[id];
      if (local && remote) out.push((remote.updatedAt || 0) >= (local.updatedAt || 0) ? remote : local);
      else if (remote) out.push(remote);                                  // 다른 기기에서 추가됨
      else if (local && (local.updatedAt || 0) > (lastPull || 0)) out.push(local); // 아직 안 올린 로컬 신규
      // local만 있고 lastPull 이전 = 다른 기기에서 삭제됨 → 제거
    }
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return out;
  }

  async function _ensure() {
    if (!_folderId) _folderId = await DriveAPI.ensureFolder();
    return _folderId;
  }
  async function _refreshFileList() {
    // 새 Map을 다 채운 뒤 원자적으로 교체 — fetchImage가 비어있는 중간상태를 보지 않게
    const next = new Map();
    const files = await DriveAPI.listFolder(_folderId);
    files.forEach(f => next.set(f.name, { id: f.id, modifiedTime: f.modifiedTime }));
    const meta = next.get(META_NAME); _metaId = meta ? meta.id : null;
    _files = next;
  }

  // ── pull (병합) ──
  async function pull() {
    if (_pulling) return;
    _pulling = true; _setStatus('syncing');
    try {
      await _ensure();
      await _refreshFileList();
      let remote = [];
      if (_metaId) {
        try { const txt = await DriveAPI.downloadText(_metaId); const obj = JSON.parse(txt); remote = obj.projects || []; }
        catch (e) { console.warn('[Sync] 메타 파싱 실패:', e); }
      }
      const lastPull = parseInt(localStorage.getItem(LS_LASTPULL) || '0', 10);
      const merged = _merge(Store.getProjects(), remote, lastPull);
      Store.replaceAllProjects(merged);
      // 병합 결과를 원격에 먼저 반영한 뒤에야 lastPull 갱신 — 중간 실패 시 삭제정보 유실 방지
      try { await _pushMeta(); } catch (e) { console.warn('[Sync] 병합 후 push 실패:', e); }
      localStorage.setItem(LS_LASTPULL, String(Date.now()));
      _setStatus('synced');
      if (typeof App !== 'undefined' && App.afterSync) App.afterSync();
      _uploadMissingImages(); // 아직 안 올라간 로컬 이미지 업로드(백그라운드)
    } catch (e) {
      console.error('[Sync] pull 실패:', e); _setStatus('error', '🔴 ' + (e.message || e));
    } finally { _pulling = false; }
  }

  // ── push 메타(디바운스) ──
  function _schedulePush(delay) {
    if (!active()) return;
    if (_metaTimer) clearTimeout(_metaTimer);
    _metaTimer = setTimeout(() => { _pushMeta().catch(e => console.warn('[Sync] push 실패:', e)); }, delay || 1500);
  }
  async function _pushMeta() {
    if (!active()) return;
    await _ensure();
    const payload = { projects: Store.getProjects(), savedAt: Date.now(), v: 1 };
    const id = await DriveAPI.uploadJSON(META_NAME, payload, _folderId, _metaId);
    _metaId = id; _files.set(META_NAME, { id });
    if (_status !== 'syncing') _setStatus('synced');
  }

  // ── 이미지 업로드 큐 ──
  function _enqueueImage(id, img) {
    if (!active()) return;
    if (_files.has(_imgName(id)) || _imgInProgress.has(id)) return; // 이미 있음/업로드 중
    if (_imgQueue.some(q => q.id === id)) return;                   // 이미 큐 대기 중(중복 방지)
    _imgQueue.push({ id, img });
    _runImgQueue();
  }
  async function _runImgQueue() {
    if (_imgRunning) return;
    _imgRunning = true;
    try {
      while (_imgQueue.length) {
        const { id, img } = _imgQueue.shift();
        if (_deleted.has(id)) continue;                       // 방금 삭제된 이미지는 올리지 않음
        if (_files.has(_imgName(id)) || _imgInProgress.has(id)) continue;
        _imgInProgress.add(id);
        try {
          let data = img;
          if (!data || !data.data) { try { data = await Store.getImage(id); } catch (_) {} }
          if (!data || !data.data) continue;
          if (_deleted.has(id)) continue;                     // 업로드 직전 재확인
          const fid = await DriveAPI.uploadImage(_imgName(id), data.data, data.mime || 'image/png', _folderId);
          _files.set(_imgName(id), { id: fid });
        } catch (e) { console.warn('[Sync] 이미지 업로드 실패:', id, e.message || e); }
        finally { _imgInProgress.delete(id); }
      }
    } finally { _imgRunning = false; }
  }

  // 로컬에만 있고 드라이브엔 없는 이미지 일괄 업로드(최초 연결 시)
  async function _uploadMissingImages() {
    if (!active()) return;
    const ids = new Set();
    Store.getProjects().forEach(p => (p.items || []).forEach(it => {
      if (it.imageId) ids.add(it.imageId);
      (it.history || []).forEach(h => ids.add(h));
    }));
    for (const id of ids) { if (!_files.has(_imgName(id))) _imgQueue.push({ id, img: null }); }
    _runImgQueue();
  }

  // ── 지연 다운로드(로컬 미스 시 호출) ──
  async function fetchImage(imageId) {
    if (!active()) return null;
    const f = _files.get(_imgName(imageId));
    if (!f || !f.id) return null;
    try { return await DriveAPI.downloadImageBase64(f.id); }
    catch (e) { console.warn('[Sync] 이미지 다운로드 실패:', imageId, e.message || e); return null; }
  }

  // ── Store 훅 ──
  function onMeta() { _schedulePush(); }
  function onImage(id, img) { _enqueueImage(id, img); }
  async function onImageDelete(id) {
    _imgQueue = _imgQueue.filter(q => q.id !== id);  // 업로드 예약 취소
    _deleted.add(id);
    setTimeout(() => _deleted.delete(id), 8000);     // 인플라이트 업로드 차단 후 정리
    const f = _files.get(_imgName(id));
    if (f) { try { await DriveAPI.deleteFile(f.id); } catch (_) {} _files.delete(_imgName(id)); }
  }

  // ── 연결/해제 ──
  function connect() { _setStatus('connecting'); Auth.login(); }
  function disconnect() {
    Auth.logout(); _folderId = null; _files = new Map(); _metaId = null;
    localStorage.removeItem('mochangi_folder_id');
    _setStatus('off');
    if (showToast) showToast('구글 드라이브 연결을 해제했어요. (이 기기 데이터는 그대로 남아있어요)');
  }
  async function syncNow() {
    if (!Auth.isLoggedIn()) { connect(); return; }
    await pull();
  }

  function init() {
    Auth.onLogin(async () => {
      _setStatus('connecting');
      try { await pull(); } catch (e) { _setStatus('error'); }
    });
    Auth.onLogout(() => _setStatus('off'));
    if (!Auth.isLoggedIn()) _setStatus('off');
  }

  return { init, connect, disconnect, syncNow, pull, active, status, fetchImage, onMeta, onImage, onImageDelete };
})();
