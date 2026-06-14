/**
 * 모챙이 - 설정 모달 (localStorage 'mochangi_config')
 */
const ConfigModal = (() => {
  const KEY = 'mochangi_config';
  const FIELDS = {
    GEMINI_API_KEY: 'cfg-gemini-key',
    OPENAI_API_KEY: 'cfg-openai-key',
    CLIENT_ID: 'cfg-client-id',
    FOLDER_ID: 'cfg-folder-id',
    IMAGE_MODEL: 'cfg-image-model',
    TEXT_MODEL: 'cfg-text-model',
    ASPECT_RATIO: 'cfg-aspect',
  };

  function _ensureOption(selId, val) {
    if (!val) return;
    const sel = document.getElementById(selId);
    if (!sel) return;
    if (![].slice.call(sel.options).some(o => o.value === val)) {
      const o = document.createElement('option');
      o.value = val; o.textContent = val; sel.appendChild(o);
    }
  }

  function open() {
    const cfg = window.MOCHANGI_CONFIG || {};
    for (const k in FIELDS) {
      if (k === 'IMAGE_MODEL' || k === 'TEXT_MODEL') _ensureOption(FIELDS[k], cfg[k]);
      const el = document.getElementById(FIELDS[k]);
      if (el) el.value = cfg[k] || '';
    }
    const io = document.getElementById('cfg-io-area'); if (io) io.value = '';
    document.getElementById('config-modal').classList.remove('hidden');
  }
  function close() { document.getElementById('config-modal').classList.add('hidden'); }

  function save() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
    for (const k in FIELDS) {
      const el = document.getElementById(FIELDS[k]);
      if (el) stored[k] = (typeof el.value === 'string') ? el.value.trim() : el.value;
    }
    localStorage.setItem(KEY, JSON.stringify(stored));
    // 즉시 런타임에 반영(새로고침 없이도 동작)
    for (const k in stored) window.MOCHANGI_CONFIG[k] = stored[k];
    showToast('✅ 설정이 저장되었습니다.', 'success');
    close();
    if (typeof App !== 'undefined' && App.onConfigSaved) App.onConfigSaved();
  }

  function exportConfig() {
    const config = {};
    for (const k in FIELDS) { const el = document.getElementById(FIELDS[k]); if (el) config[k] = (el.value || '').trim ? el.value.trim() : el.value; }
    try {
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
      const area = document.getElementById('cfg-io-area');
      if (area) { area.value = encoded; area.focus(); area.select(); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(encoded)
          .then(() => showToast('📤 설정이 클립보드에 복사되었습니다.'))
          .catch(() => showToast('아래 텍스트를 직접 복사하세요.'));
      } else showToast('아래 텍스트를 직접 복사하세요.');
    } catch (e) { showToast('❌ 설정 내보내기 실패: ' + (e.message || e), 'error'); }
  }

  function importConfig() {
    const area = document.getElementById('cfg-io-area');
    const raw = ((area && area.value) || '').trim();
    if (!raw) { showToast('가져올 설정 코드를 먼저 붙여넣으세요.', 'error'); return; }
    try {
      const jsonStr = raw.charAt(0) === '{' ? raw : decodeURIComponent(escape(atob(raw)));
      const parsed = JSON.parse(jsonStr);
      for (const k in FIELDS) {
        if (parsed[k] === undefined) continue;
        if (k === 'IMAGE_MODEL' || k === 'TEXT_MODEL') _ensureOption(FIELDS[k], parsed[k]);
        const el = document.getElementById(FIELDS[k]);
        if (el) el.value = parsed[k];
      }
      showToast('📥 설정을 폼에 반영했습니다. [저장]을 눌러 적용하세요.');
    } catch (e) { showToast('❌ 설정 분석 실패 — 코드를 확인하세요.', 'error'); }
  }

  function hasValidConfig() {
    const cfg = window.MOCHANGI_CONFIG || {};
    return !!(cfg.GEMINI_API_KEY && cfg.GEMINI_API_KEY.indexOf('YOUR_') !== 0);
  }

  return { open, close, save, exportConfig, importConfig, hasValidConfig };
})();
