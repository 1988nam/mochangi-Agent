/**
 * 모챙이 - Google Drive REST (OAuth Bearer 직접 호출). drive.file 권한 = 앱이 만든 파일만.
 *   전용 폴더 '모챙이 데이터'에 프로젝트 메타(JSON) + 이미지(원본 PNG 파일)를 저장.
 *   이미지는 변환 없이 원본 바이트 그대로 — 투명도/품질 보존.
 */
const DriveAPI = (() => {
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_NAME = '모챙이 데이터';
  const LS_FOLDER = 'mochangi_folder_id';

  // 매 시도 최신 토큰으로 Authorization 덮어쓰기 + 401 1회 갱신 재시도
  async function _fetch(url, opts, _retried) {
    opts = opts || {};
    const token = Auth.getToken();
    if (!token) throw new Error('구글 로그인이 필요합니다.');
    const headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${token}` });
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401 && !_retried && Auth.refreshToken) {
      try { await Auth.refreshToken(); } catch (_) { throw new Error('구글 인증이 만료됐어요 — ☁️ 동기화로 다시 연결해 주세요.'); }
      return _fetch(url, opts, true);
    }
    return res;
  }
  async function _json(url, opts) {
    const res = await _fetch(url, opts);
    if (!res.ok) { let t = ''; try { t = await res.text(); } catch (_) {} throw new Error(`Drive 오류 (${res.status}) ${t.replace(/\s+/g, ' ').slice(0, 200)}`); }
    return res.json();
  }

  function _b64ToBlob(b64, mime) {
    const chars = atob(b64); const bytes = new Uint8Array(chars.length);
    for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }
  function _abToBase64(buf) {
    let binary = ''; const bytes = new Uint8Array(buf); const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  // 드라이브 URL/ID 어느 쪽이 와도 ID만 추출
  function _extractId(s) {
    s = String(s == null ? '' : s).trim();
    const m = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    return m ? m[1] : s;
  }

  // 전용 폴더 확보. 설정에 FOLDER_ID가 박혀 있으면 그 폴더를 그대로 사용(전체 드라이브 범위 필요).
  async function ensureFolder() {
    const cfg = window.MOCHANGI_CONFIG || {};
    const fixed = cfg.FOLDER_ID && String(cfg.FOLDER_ID).trim();
    if (fixed) {
      const id = _extractId(fixed);
      let m;
      try { m = await _json(`${API}/files/${id}?fields=id,trashed`); }
      catch (e) { throw new Error('지정한 드라이브 폴더에 접근할 수 없어요 — 폴더 ID와 권한(전체 드라이브 범위)을 확인하세요.'); }
      if (m.trashed) throw new Error('지정한 폴더가 휴지통에 있어요.');
      return id;
    }
    const cached = localStorage.getItem(LS_FOLDER);
    if (cached) {
      // 휴지통 + 이름 일치까지 확인(다른 폴더로 캐시가 어긋난 경우 방지)
      try { const m = await _json(`${API}/files/${cached}?fields=id,name,trashed`); if (!m.trashed && m.name === FOLDER_NAME) return cached; } catch (_) {}
      localStorage.removeItem(LS_FOLDER);
    }
    // 이름으로 검색(내가 소유한, 앱이 만든 폴더만)
    try {
      const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners`;
      const r = await _json(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`);
      if (r.files && r.files.length) { localStorage.setItem(LS_FOLDER, r.files[0].id); return r.files[0].id; }
    } catch (_) {}
    const res = await _fetch(`${API}/files`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!res.ok) throw new Error(`폴더 생성 실패 (${res.status})`);
    const j = await res.json(); localStorage.setItem(LS_FOLDER, j.id); return j.id;
  }

  // 폴더 내 전체 파일 목록 → [{id,name,modifiedTime}]
  async function listFolder(folderId) {
    const out = []; let pageToken = '';
    for (let i = 0; i < 30; i++) {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id,name,modifiedTime,size)', pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await _json(`${API}/files?${params.toString()}`);
      (r.files || []).forEach(f => out.push(f));
      pageToken = r.nextPageToken || ''; if (!pageToken) break;
    }
    return out;
  }

  // 새 파일 메타 생성 → fileId
  async function _createFile(name, mime, parentId) {
    const res = await _fetch(`${API}/files`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId], mimeType: mime }),
    });
    if (!res.ok) throw new Error(`파일 생성 실패 (${res.status})`);
    return (await res.json()).id;
  }
  // 미디어 바이트 업로드(PATCH)
  async function _uploadMedia(fileId, blob, mime) {
    const res = await _fetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': mime }, body: blob,
    });
    if (!res.ok) throw new Error(`업로드 실패 (${res.status})`);
    return fileId;
  }

  // JSON 업로드(있으면 갱신). → fileId
  async function uploadJSON(name, obj, parentId, existingId) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    let id = existingId;
    if (!id) id = await _createFile(name, 'application/json', parentId);
    return _uploadMedia(id, blob, 'application/json');
  }
  async function downloadText(fileId) {
    const res = await _fetch(`${API}/files/${fileId}?alt=media`, {});
    if (!res.ok) throw new Error(`다운로드 실패 (${res.status})`);
    return res.text();
  }

  // 이미지 업로드(원본 base64 그대로). → fileId
  async function uploadImage(name, base64, mime, parentId, existingId) {
    const m = mime || 'image/png';
    let id = existingId;
    if (!id) id = await _createFile(name, m, parentId);
    try { return await _uploadMedia(id, _b64ToBlob(base64, m), m); }
    catch (e) { if (!existingId) { try { await _fetch(`${API}/files/${id}`, { method: 'DELETE' }); } catch (_) {} } throw e; }
  }
  // 이미지 다운로드 → { mime, data(base64) } (변환 없음 — 투명도 보존)
  async function downloadImageBase64(fileId) {
    const res = await _fetch(`${API}/files/${fileId}?alt=media`, {});
    if (!res.ok) throw new Error(`이미지 다운로드 실패 (${res.status})`);
    const blob = await res.blob();
    const buf = await blob.arrayBuffer();
    return { mime: blob.type || 'image/png', data: _abToBase64(buf) };
  }

  async function deleteFile(fileId) {
    try { const res = await _fetch(`${API}/files/${fileId}`, { method: 'DELETE' }); return res.ok || res.status === 404; }
    catch (_) { return false; }
  }

  return { ensureFolder, listFolder, uploadJSON, downloadText, uploadImage, downloadImageBase64, deleteFile, FOLDER_NAME };
})();
