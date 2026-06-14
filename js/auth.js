/**
 * 모챙이 - Google OAuth (GIS 토큰 클라이언트, 브라우저 직접 / 서버리스)
 *   - 드라이브 동기화 전용. 스코프 drive.file(앱이 만든 파일만). 토큰은 localStorage 캐시 + 자동 갱신.
 *   - gapi 의존 없이 GIS만 사용 — 모든 Drive 호출은 OAuth Bearer로 REST 직접.
 */
const Auth = (() => {
  let accessToken = null;
  let tokenClient = null;
  let onLoginCallback = null;
  let onLogoutCallback = null;
  let gisInited = false;
  let _refreshTimer = null;
  let _refreshTimeout = null;   // refreshToken 응답 타임아웃(무한 대기 방지)
  let _silentAttempted = false;
  let _loggedIn = false;
  let _loginFired = false;      // 이번 로그인 세션에서 onLogin을 이미 발화했는지(중복 방지)
  let _waiters = [];

  function _cfg() { return window.MOCHANGI_CONFIG || {}; }
  function _settle(err, token) {
    if (_refreshTimeout) { clearTimeout(_refreshTimeout); _refreshTimeout = null; }
    const ws = _waiters; _waiters = [];
    ws.forEach(w => { try { err ? w.reject(err) : w.resolve(token); } catch (_) {} });
  }
  function _fireLogin() {
    if (_loginFired) return;
    _loginFired = true;
    if (onLoginCallback) { try { onLoginCallback(); } catch (e) { console.error('[Auth] onLogin 콜백 오류:', e); } }
  }

  // 즉시 토큰 갱신(프로미스). 동시 호출은 한 번으로 합쳐지고, 응답이 없으면 10초 뒤 reject.
  function refreshToken() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) return reject(new Error('구글 로그인 준비 안 됨 — CLIENT_ID를 먼저 설정하세요.'));
      _waiters.push({ resolve, reject });
      if (_waiters.length > 1) return;
      _refreshTimeout = setTimeout(() => { _refreshTimeout = null; _settle(new Error('토큰 갱신 시간 초과(10초)')); }, 10000);
      try { tokenClient.requestAccessToken({ prompt: '' }); }
      catch (e) { _settle(e); }
    });
  }
  function ensureFreshToken(minRemainMs) {
    const exp = parseInt(localStorage.getItem('mochangi_token_expiry') || '0', 10);
    if (accessToken && exp && exp - Date.now() > (minRemainMs || 60 * 1000)) return Promise.resolve(accessToken);
    return refreshToken();
  }
  function _scheduleRefresh(expiryMs) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    const delay = expiryMs - Date.now() - 5 * 60 * 1000;
    if (delay < 30 * 1000) return; // 이미 임박/만료 — 온디맨드(ensureFreshToken/visibility)로 처리(루프 방지)
    _refreshTimer = setTimeout(() => {
      if (tokenClient && _loggedIn) { try { tokenClient.requestAccessToken({ prompt: '' }); } catch (_) {} }
    }, delay);
  }

  // CLIENT_ID/스크립트 준비 시 GIS 토큰 클라이언트 초기화. 성공 여부(boolean) 반환.
  function initGis() {
    const cfg = _cfg();
    if (!cfg.CLIENT_ID || cfg.CLIENT_ID.indexOf('YOUR_') === 0) { console.warn('[Auth] CLIENT_ID 미설정 — GIS 초기화 유예.'); return false; }
    if (typeof google === 'undefined' || !(google.accounts && google.accounts.oauth2)) { console.warn('[Auth] GIS 스크립트 미로드.'); return false; }
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.CLIENT_ID,
        scope: cfg.SCOPES || 'https://www.googleapis.com/auth/drive.file',
        callback: (resp) => {
          if (resp.error !== undefined) { console.warn('[Auth] 토큰 오류:', resp.error); _settle(new Error('토큰 발급 실패: ' + resp.error)); return; }
          accessToken = resp.access_token;
          const expiry = Date.now() + (resp.expires_in || 3600) * 1000;
          localStorage.setItem('mochangi_access_token', accessToken);
          localStorage.setItem('mochangi_token_expiry', String(expiry));
          _scheduleRefresh(expiry);
          _settle(null, accessToken);
          if (!_loggedIn) { _loggedIn = true; console.log('✅ 구글 로그인 완료'); _fireLogin(); }
          else console.log('🔄 토큰 자동 갱신');
        },
        error_callback: (err) => {
          console.warn('[Auth] GIS 오류:', err && err.type);
          _silentAttempted = false; // 일시 실패면 다음 기회에 재시도 가능
          _settle(new Error('토큰 발급 실패: ' + ((err && err.type) || 'unknown')));
        },
      });
    } catch (e) { console.error('[Auth] initTokenClient 실패:', e); tokenClient = null; return false; }
    gisInited = true;
    _tryLocal();
    return true;
  }

  function _tryLocal() {
    if (!gisInited || _loggedIn) return;
    try {
      const stored = localStorage.getItem('mochangi_access_token');
      const expiry = parseInt(localStorage.getItem('mochangi_token_expiry') || '0', 10);
      if (stored && expiry > Date.now()) {
        accessToken = stored; _scheduleRefresh(expiry); _loggedIn = true;
        console.log('✅ 캐시 토큰 자동 로그인'); _fireLogin();
        return;
      }
      localStorage.removeItem('mochangi_access_token'); localStorage.removeItem('mochangi_token_expiry');
      if (tokenClient && !_silentAttempted) { _silentAttempted = true; try { tokenClient.requestAccessToken({ prompt: '' }); } catch (_) { _silentAttempted = false; } }
    } catch (e) { console.error('[Auth] 로컬 로그인 시도 에러:', e); }
  }

  function login() {
    if (!tokenClient) {
      if (!initGis()) { if (typeof showToast === 'function') showToast('Google CLIENT_ID가 유효하지 않거나 미설정입니다. ⚙️ 설정을 확인하세요.', 'error'); return; }
    }
    if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
  }
  function logout() {
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    if (accessToken) { try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (_) {} }
    accessToken = null; _loggedIn = false; _loginFired = false; _silentAttempted = false;
    localStorage.removeItem('mochangi_access_token'); localStorage.removeItem('mochangi_token_expiry');
    if (onLogoutCallback) { try { onLogoutCallback(); } catch (_) {} }
  }

  function onLogin(cb) { onLoginCallback = cb; if (_loggedIn) _fireLogin(); else _tryLocal(); }
  function onLogout(cb) { onLogoutCallback = cb; }
  function isLoggedIn() { return !!accessToken; }
  function getToken() { return accessToken; }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !_loggedIn) return;
    const exp = parseInt(localStorage.getItem('mochangi_token_expiry') || '0', 10);
    if (!exp || exp - Date.now() < 5 * 60 * 1000) refreshToken().catch(() => {});
  });

  return { initGis, login, logout, onLogin, onLogout, isLoggedIn, getToken, refreshToken, ensureFreshToken };
})();

function gisLoaded() { try { Auth.initGis(); } catch (e) { console.warn(e); } }
