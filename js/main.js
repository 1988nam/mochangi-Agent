/**
 * 모챙이 - 메인 컨트롤러
 *   뷰 라우팅 · 컨셉 기획 · 레퍼런스 아이디에이션 · 작업실(생성/다듬기) · 보관함
 */

// 전역 토스트 (config_modal.js 등에서도 사용)
function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.className = t.className.replace('show', '').trim(); }, 3200);
}

const App = (() => {
  const $ = (id) => document.getElementById(id);

  const SPECS = {
    kakao_still: { label: '카카오 · 멈춰있는 이모티콘', count: 32, size: '360×360px', note: 'PNG(투명 배경) 32종 기준' },
    kakao_anim:  { label: '카카오 · 움직이는 이모티콘', count: 24, size: '360×360px', note: '시안 24종(승인 후 일부를 움직임으로 제작)' },
    kakao_big:   { label: '카카오 · 큰 이모티콘', count: 16, size: '540×540px', note: '큰 이모티콘 16종 기준' },
  };
  const VALID_SPECS = ['kakao_still', 'kakao_anim', 'kakao_big'];
  const MAX_REFS = 6;
  const IMAGE_MODELS = [
    ['gemini-3-pro-image', 'Nano Banana Pro (최고 품질·한글)'],
    ['gemini-2.5-flash-image', 'Nano Banana (빠르고 저렴)'],
    ['gemini-3.1-flash-image', 'Nano Banana 2'],
  ];

  const state = { activeId: null, refs: [], editTarget: null, genCancel: false };
  const _imgCache = new Map();
  let _lastConcepts = [];
  let _lastIdeas = [];

  // ── 유틸 ───────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function safeHex(h) { return /^#[0-9a-fA-F]{3,8}$/.test(String(h || '').trim()) ? h.trim() : ''; }
  function sanitizeFilename(s) { return String(s || 'emoticon').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40); }
  // 화이트리스트로만 조회(__proto__ 등 비정상 키 차단)
  function specOf(key) { return (VALID_SPECS.indexOf(key) !== -1 && SPECS[key]) ? SPECS[key] : SPECS.kakao_still; }

  // 동시성 안전 저장: 최신 프로젝트를 다시 읽어 해당 칸만 바꿔 저장(긴 생성 중 사용자 편집을 덮어쓰지 않게)
  function commitItem(projId, itemId, mutator) {
    const proj = Store.getProject(projId); if (!proj) return null;
    const it = proj.items.find(x => x.id === itemId); if (!it) return null;
    mutator(it, proj); Store.saveProject(proj); return proj;
  }

  function setProc(id, html) { const el = $(id); if (el) el.innerHTML = html ? `<div class="proc">${html}</div>` : ''; }
  function stepRunning(txt) { return `<div class="step"><span class="spinner"></span> ${escapeHtml(txt)}</div>`; }
  function stepErr(txt) { return `<div class="step err-line">❌ ${escapeHtml(txt)}</div>`; }

  function activeProject() { return state.activeId ? Store.getProject(state.activeId) : null; }
  async function imgUrl(imageId) {
    if (!imageId) return '';
    if (_imgCache.has(imageId)) return _imgCache.get(imageId);
    const im = await Store.getImage(imageId);
    const url = Store.dataUrl(im);
    if (url) _imgCache.set(imageId, url);
    return url;
  }

  // 파일/Blob → 다운스케일한 {mime,data(base64),url}  (레퍼런스 분석용 — 비용·토큰 절약)
  function fileToRef(file, max) {
    max = max || 768;
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('이미지 파일이 아니에요.'));
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img;
          const scale = Math.min(1, max / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          const url = cv.toDataURL('image/jpeg', 0.9);
          resolve({ mime: 'image/jpeg', data: url.split(',')[1], url });
        };
        img.onerror = () => reject(new Error('이미지를 읽지 못했어요.'));
        img.src = fr.result;
      };
      fr.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
      fr.readAsDataURL(file);
    });
  }

  // ── 뷰 라우팅 ──────────────────────────────────────────
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const v = $('view-' + name); if (v) v.classList.remove('hidden');
    document.querySelectorAll('.side-item[data-view]').forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    closeSidebar();
    if (name === 'studio') renderStudio();
    if (name === 'gallery') renderGallery();
  }

  // ── 컨셉 기획 ──────────────────────────────────────────
  function readSelectCustom(selId, customId) {
    const sel = $(selId); const v = sel ? sel.value : '';
    if (v === '__custom') { const c = $(customId); return (c && c.value.trim()) || ''; }
    return v;
  }
  function updateSpecHint() {
    const sp = specOf($('c-spec').value);
    $('c-spec-hint').innerHTML = `📐 ${escapeHtml(sp.label)} — <b>${sp.count}종</b> · ${escapeHtml(sp.size)} · ${escapeHtml(sp.note)}. `
      + `제출은 <a href="https://emoticonstudio.kakao.com/" target="_blank" rel="noopener">카카오 이모티콘 스튜디오</a>에서 (규격은 참고 기본값 — 제출 전 최신 규격 확인).`;
  }

  async function generateConcepts() {
    if (!ConfigModal.hasValidConfig()) { showToast('먼저 ⚙️ 설정에서 Gemini API 키를 입력하세요.', 'error'); ConfigModal.open(); return; }
    const subject = readSelectCustom('c-subject', 'c-subject-custom');
    const tone = readSelectCustom('c-tone', 'c-tone-custom');
    if (!subject || !tone) { showToast('주제와 톤을 입력해 주세요.', 'error'); return; }
    const specKey = $('c-spec').value; const sp = specOf(specKey);
    const input = {
      subject, tone,
      target: $('c-target').value.trim(),
      keywords: $('c-keywords').value.trim(),
      count: Math.max(1, Math.min(5, parseInt($('c-count').value, 10) || 3)),
      specLabel: sp.label, setCount: sp.count,
    };
    const btn = $('c-generate'); btn.disabled = true;
    setProc('c-progress', stepRunning('AI가 컨셉안을 구상하고 있어요...'));
    try {
      const list = await GeminiText.planConcepts(input);
      _lastConcepts = list;
      setProc('c-progress', '');
      renderConceptCards(list, 'c-results', 'concept', specKey);
      showToast(`💡 컨셉안 ${list.length}개를 제안했어요!`, 'success');
    } catch (e) {
      setProc('c-progress', stepErr(e.message || e));
    } finally { btn.disabled = false; }
  }

  function conceptCardHtml(c, src, idx, specKey) {
    const vis = c.visual || {};
    const pal = (vis.palette || c.palette || []).map(safeHex).filter(Boolean)
      .map(h => `<span class="swatch" style="background:${h}" title="${escapeHtml(h)}"></span>`).join('');
    const titles = (c.titleCandidates || []).map(t => `<span class="title-chip">${escapeHtml(t)}</span>`).join('');
    return `
    <div class="concept-card">
      <div class="concept-head">
        <span class="concept-name">${escapeHtml(c.name || '이름 미정')}</span>
        <span class="concept-tag">${escapeHtml(c.tagline || '')}</span>
      </div>
      ${c.personality ? `<div class="concept-tagline">${escapeHtml(c.personality)}</div>` : ''}
      <div class="concept-grid">
        <div><div class="k">비주얼 스타일</div><div class="v">${escapeHtml(vis.style || '')}</div></div>
        <div><div class="k">핵심 특징</div><div class="v">${escapeHtml(vis.keyFeatures || '')}</div></div>
        <div><div class="k">차별점</div><div class="v">${escapeHtml(c.differentiator || '')}</div></div>
        <div><div class="k">팔레트</div><div class="palette">${pal || '<span class="v" style="color:var(--text-muted)">—</span>'}</div></div>
      </div>
      ${titles ? `<div><div class="k" style="font-size:11px;color:var(--text-muted);font-weight:700;">제목 후보</div><div class="title-chips">${titles}</div></div>` : ''}
      <div class="concept-actions">
        <button class="btn" data-action="use-concept" data-src="${src}" data-idx="${idx}" data-spec="${escapeHtml(specKey || 'kakao_still')}">✨ 이 컨셉으로 작업실 가기</button>
      </div>
    </div>`;
  }
  function renderConceptCards(list, containerId, src, specKey) {
    $(containerId).innerHTML = list.map((c, i) => conceptCardHtml(c, src, i, specKey)).join('');
  }

  // ── 레퍼런스 아이디에이션 ──────────────────────────────
  function renderRefs() {
    const wrap = $('ref-thumbs');
    const head = state.refs.length ? `<div class="hint" style="width:100%; margin:0 0 6px;">${state.refs.length}/${MAX_REFS}장</div>` : '';
    wrap.innerHTML = head + state.refs.map(r =>
      `<div class="ref-thumb"><img src="${r.url}" alt="" /><button class="x" data-action="remove-ref" data-id="${r.id}" title="제거">✕</button></div>`
    ).join('');
  }
  async function addRefFiles(files) {
    const arr = Array.from(files || []).filter(f => /^image\//.test(f.type));
    if (!arr.length) return;
    for (const f of arr) {
      if (state.refs.length >= MAX_REFS) { showToast(`레퍼런스는 최대 ${MAX_REFS}장까지 올릴 수 있어요.`, 'error'); break; }
      try { const ref = await fileToRef(f); ref.id = Store.newId('ref'); state.refs.push(ref); }
      catch (e) { showToast(e.message || '이미지를 추가하지 못했어요.', 'error'); }
    }
    renderRefs();
  }

  async function generateIdeas() {
    if (!ConfigModal.hasValidConfig()) { showToast('먼저 ⚙️ 설정에서 Gemini API 키를 입력하세요.', 'error'); ConfigModal.open(); return; }
    if (!state.refs.length) { showToast('레퍼런스 이미지를 한 장 이상 올려주세요.', 'error'); return; }
    const subject = readSelectCustom('i-subject', 'i-subject-custom');
    if (!subject) { showToast('변형할 주제를 입력해 주세요.', 'error'); return; }
    const sp = specOf('kakao_still');
    const input = { subject, note: $('i-note').value.trim(), count: 3, specLabel: sp.label, setCount: sp.count };
    const btn = $('i-generate'); btn.disabled = true;
    setProc('i-progress', stepRunning('레퍼런스 스타일을 분석하고 새 컨셉으로 변형하고 있어요...'));
    try {
      // [표절 방지 — 단방향 흐름] 업로드 레퍼런스(state.refs)는 오직 ideate()의 '텍스트 스타일 분석'에만 전달된다.
      //  결과 컨셉(freshDirections)은 사용자의 새 주제로 만든 독창물이며, 이미지 생성(GeminiImage.generate)에는
      //  state.refs를 절대 넘기지 않는다(작업실의 기준 캐릭터 이미지만 일관성용으로 사용).
      const r = await GeminiText.ideate(state.refs.map(x => ({ mime: x.mime, data: x.data })), input);
      _lastIdeas = r.freshDirections || [];
      setProc('i-progress', '');
      renderIdeas(r);
      showToast('💡 표절 없는 변형 컨셉을 제안했어요!', 'success');
    } catch (e) {
      setProc('i-progress', stepErr(e.message || e));
    } finally { btn.disabled = false; }
  }

  function renderIdeas(r) {
    const a = r.styleAnalysis || {};
    const tags = [];
    const add = (label, v) => { if (v) tags.push(`<span class="tag"><b>${escapeHtml(label)}</b> ${escapeHtml(Array.isArray(v) ? v.map(safeHex).filter(Boolean).join(' ') || v.join(', ') : v)}</span>`); };
    add('선', a.lineWeight); add('비율', a.proportion); add('유머', a.humorType); add('구도', a.composition); add('무드', a.mood); add('텍스트', a.textUsage);
    const palette = (a.palette || []).map(safeHex).filter(Boolean).map(h => `<span class="swatch" style="background:${h}"></span>`).join('');
    const dont = (r.doNotCopy || []).map(d => `<li>${escapeHtml(d)}</li>`).join('');
    const cards = (r.freshDirections || []).map((c, i) => conceptCardHtml(c, 'idea', i, 'kakao_still')).join('');
    $('i-results').innerHTML = `
      <div class="analysis-card">
        <div class="card-title">🔍 스타일 분석 <span class="hint" style="font-weight:400;">— 추상적 특징만 (그림은 새로 그립니다)</span></div>
        <div class="tag-list">${tags.join('') || '<span class="hint">분석 결과 없음</span>'}</div>
        ${palette ? `<div class="palette" style="margin-top:8px;">${palette}</div>` : ''}
        ${dont ? `<div class="warn-box"><div class="k">⚠️ 표절 금지 — 아래 요소는 절대 베끼지 마세요</div><ul>${dont}</ul></div>` : ''}
      </div>
      <div class="card-title" style="margin:6px 2px 10px;">💡 변형 컨셉 제안</div>
      ${cards}`;
  }

  // ── 작업실 ─────────────────────────────────────────────
  function createProjectFromConcept(concept, specKey) {
    const cfg = window.MOCHANGI_CONFIG || {};
    const proj = {
      id: Store.newId('proj'),
      name: concept.name || '새 이모티콘',
      concept: {
        name: concept.name || '',
        tagline: concept.tagline || '',
        style: concept.imagePromptStyle || (concept.visual && concept.visual.style) || '',
        spec: specKey || 'kakao_still',
        bg: 'transparent',
        model: cfg.IMAGE_MODEL || 'gemini-3-pro-image',
      },
      items: [],
    };
    Store.saveProject(proj);
    state.activeId = proj.id;
    renderProjectList();
    showView('studio');
    showToast('작업실로 가져왔어요. 🤖 세트 자동 구성으로 시작해 보세요!', 'success');
  }

  function createBlankProject() {
    const cfg = window.MOCHANGI_CONFIG || {};
    const proj = {
      id: Store.newId('proj'), name: '새 이모티콘',
      concept: { name: '', tagline: '', style: '', spec: 'kakao_still', bg: 'transparent', model: cfg.IMAGE_MODEL || 'gemini-3-pro-image' },
      items: [],
    };
    Store.saveProject(proj); state.activeId = proj.id; renderProjectList(); renderStudio();
  }

  function fillModelSelect(sel, current) {
    if (!sel) return;
    sel.innerHTML = IMAGE_MODELS.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
    if (current && !IMAGE_MODELS.some(m => m[0] === current)) {
      const o = document.createElement('option'); o.value = current; o.textContent = current; sel.appendChild(o);
    }
    if (current) sel.value = current;
  }

  function renderStudio() {
    const proj = activeProject();
    if (!proj) { $('studio-empty').classList.remove('hidden'); $('studio-body').classList.add('hidden'); return; }
    $('studio-empty').classList.add('hidden'); $('studio-body').classList.remove('hidden');
    $('s-name').value = proj.concept.name || '';
    $('s-tagline').value = proj.concept.tagline || '';
    $('s-style').value = proj.concept.style || '';
    $('s-spec').value = proj.concept.spec || 'kakao_still';
    $('s-bg').value = proj.concept.bg || 'transparent';
    fillModelSelect($('s-model'), proj.concept.model);
    renderSetGrid();
  }

  function renderSetGrid() {
    const proj = activeProject(); if (!proj) return;
    const sp = specOf(proj.concept.spec);
    $('s-setcount').textContent = `(현재 ${proj.items.length}칸 / 권장 ${sp.count}종, 완성 ${Store.countDone(proj)}개)`;
    const grid = $('s-set-grid');
    if (!proj.items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="big">📋</div>아직 칸이 없어요. <b>🤖 세트 자동 구성</b>으로 ${sp.count}칸을 한 번에 만들거나 <b>＋ 칸 추가</b>로 직접 채우세요.</div>`;
      return;
    }
    grid.innerHTML = proj.items.map((it, i) => cellHtml(it, i)).join('');
    proj.items.forEach((it) => paintStage(it));
    updateStudioBadge();
  }

  function cellHtml(item, idx) {
    return `
    <div class="emo-cell${item.baseChar ? ' base-char' : ''}" data-cell="${item.id}" aria-label="칸 ${idx + 1}${item.baseChar ? ' (기준 캐릭터)' : ''}">
      <div class="emo-stage" data-stage="${item.id}">
        <span class="cell-no">#${idx + 1}</span>
        ${item.baseChar ? '<span class="base-flag">기준</span>' : ''}
        <span class="media placeholder">🖼️</span>
      </div>
      <div class="emo-meta">
        <input class="emo-label" data-field="label" data-id="${item.id}" value="${escapeHtml(item.label)}" placeholder="라벨" />
        <input data-field="situation" data-id="${item.id}" value="${escapeHtml(item.situation)}" placeholder="표정·상황 (그림 지시)" title="${escapeHtml(item.situation)}" />
        <input data-field="text" data-id="${item.id}" value="${escapeHtml(item.text)}" placeholder="넣을 문구 (선택)" />
      </div>
      <div class="emo-actions">
        <button class="btn" data-action="gen-cell" data-id="${item.id}">🎨 그리기</button>
        <button class="btn mini" data-action="edit-cell" data-id="${item.id}" title="다듬기">🪄</button>
        <button class="btn mini" data-action="base-cell" data-id="${item.id}" title="기준 캐릭터로 지정">⭐</button>
        <button class="btn mini" data-action="del-cell" data-id="${item.id}" title="칸 삭제">🗑️</button>
      </div>
    </div>`;
  }

  // stage 엘리먼트는 비동기 콜백 안에서 새로 조회 — 그 사이 그리드가 재렌더돼도 최신 노드에 그린다
  function paintStage(item) {
    const sel = `[data-stage="${item.id}"]`;
    return imgUrl(item.imageId).then(url => {
      const stage = document.querySelector(sel);
      if (!stage || !url) return;
      const cur = stage.querySelector('.media');
      if (cur && cur.tagName === 'IMG') cur.src = url;
      else { if (cur) cur.remove(); const img = document.createElement('img'); img.className = 'media'; img.src = url; img.alt = item.label || ''; stage.appendChild(img); }
    });
  }
  function setStageBusy(itemId, busy) {
    const stage = document.querySelector(`[data-stage="${itemId}"]`); if (!stage) return;
    stage.classList.toggle('busy', !!busy);
    let sp = stage.querySelector('.stage-spin');
    if (busy && !sp) { sp = document.createElement('span'); sp.className = 'spinner stage-spin'; stage.appendChild(sp); }
    if (!busy && sp) sp.remove();
  }
  function updateStudioBadge() {
    const proj = activeProject();
    const b = $('studio-badge');
    if (proj && proj.items.length) { b.textContent = `${Store.countDone(proj)}/${proj.items.length}`; b.style.display = ''; }
    else b.style.display = 'none';
  }

  function updateItemField(id, field, value) {
    const proj = activeProject(); if (!proj) return;
    const it = proj.items.find(x => x.id === id); if (!it) return;
    it[field] = value;
    Store.saveProject(proj);
  }

  async function suggestSet() {
    if (!ConfigModal.hasValidConfig()) { showToast('먼저 ⚙️ 설정에서 Gemini API 키를 입력하세요.', 'error'); ConfigModal.open(); return; }
    const proj = activeProject(); if (!proj) return;
    if (proj.items.some(it => it.imageId) && !confirm('이미 그린 그림이 있어요. 세트 구성을 새로 만들면 칸 목록이 바뀝니다(그림 자체는 보관함에 남아요). 계속할까요?')) return;
    const sp = specOf(proj.concept.spec);
    $('s-suggest-set').disabled = true;
    setProc('s-progress', stepRunning('표정·상황 세트를 구성하고 있어요...'));
    try {
      const items = await GeminiText.suggestSetList({ name: proj.concept.name, tagline: proj.concept.tagline, personality: '' }, sp.count);
      proj.items = items.map(it => ({ id: Store.newId('it'), no: it.no, label: it.label, situation: it.situation, text: it.text, imageId: null, history: [], baseChar: false }));
      Store.saveProject(proj);
      setProc('s-progress', '');
      renderSetGrid();
      showToast(`📋 ${items.length}칸을 구성했어요!`, 'success');
    } catch (e) { setProc('s-progress', stepErr(e.message || e)); }
    finally { $('s-suggest-set').disabled = false; }
  }

  function addItem() {
    const proj = activeProject(); if (!proj) return;
    proj.items.push({ id: Store.newId('it'), no: proj.items.length + 1, label: '', situation: '', text: '', imageId: null, history: [], baseChar: false });
    Store.saveProject(proj); renderSetGrid();
  }

  async function delCell(id) {
    const proj = activeProject(); if (!proj) return;
    const it = proj.items.find(x => x.id === id); if (!it) return;
    if (!confirm('이 칸을 삭제할까요? (그림도 함께 삭제됩니다)')) return;
    for (const h of (it.history || [])) { _imgCache.delete(h); try { await Store.deleteImage(h); } catch (_) {} }
    proj.items = proj.items.filter(x => x.id !== id);
    Store.saveProject(proj); renderSetGrid();
  }

  function setBaseChar(id) {
    const proj = activeProject(); if (!proj) return;
    const it = proj.items.find(x => x.id === id); if (!it) return;
    const turningOn = !it.baseChar;
    proj.items.forEach(x => { x.baseChar = false; });
    it.baseChar = turningOn;
    Store.saveProject(proj); renderSetGrid();
    showToast(turningOn ? '⭐ 기준 캐릭터로 지정했어요. 다른 칸을 그릴 때 이 그림으로 일관성을 맞춰요.' : '기준 지정을 해제했어요.');
  }

  async function genCell(id, opts) {
    opts = opts || {};
    const proj = activeProject(); if (!proj) return false;
    const item = proj.items.find(x => x.id === id); if (!item) return false;
    if (!(item.situation || item.text || item.label)) { if (!opts.silent) showToast('이 칸의 표정·상황을 먼저 적어주세요.', 'error'); return false; }
    setStageBusy(id, true);
    try {
      const refs = [];
      const base = proj.items.find(x => x.baseChar && x.imageId && x.id !== id);
      if (base) { const bim = await Store.getImage(base.imageId); if (bim) refs.push(bim); }
      const concept = { name: proj.concept.name, tagline: proj.concept.tagline, style: proj.concept.style };
      const img = await GeminiImage.generate(concept, item, { bg: proj.concept.bg, model: proj.concept.model, references: refs });
      const imgId = Store.newId('img');
      await Store.saveImage(imgId, img);
      _imgCache.set(imgId, Store.dataUrl(img));
      item.imageId = imgId; // 로컬(paintStage용)
      commitItem(proj.id, id, (it) => { it.imageId = imgId; it.history = (it.history || []).concat(imgId); });
      paintStage(item); updateStudioBadge(); updateSetCountText(); renderProjectList();
      return true;
    } catch (e) { if (!opts.silent) showToast('❌ ' + (e.message || e), 'error'); return false; }
    finally { setStageBusy(id, false); }
  }
  function updateSetCountText() {
    const proj = activeProject(); if (!proj) return;
    const sp = specOf(proj.concept.spec);
    $('s-setcount').textContent = `(현재 ${proj.items.length}칸 / 권장 ${sp.count}종, 완성 ${Store.countDone(proj)}개)`;
  }

  function showGenCancel(show) {
    const btn = $('s-gen-all'); if (!btn) return;
    let c = $('s-gen-cancel');
    if (show && !c) {
      c = document.createElement('button');
      c.id = 's-gen-cancel'; c.className = 'btn btn-danger'; c.style.marginLeft = '8px';
      c.textContent = '⏹️ 중단';
      c.addEventListener('click', () => { state.genCancel = true; c.disabled = true; c.textContent = '중단하는 중...'; });
      btn.parentElement.insertBefore(c, btn.nextSibling);
    } else if (!show && c) { c.remove(); }
  }

  async function genAll() {
    if (!ConfigModal.hasValidConfig()) { showToast('먼저 ⚙️ 설정에서 Gemini API 키를 입력하세요.', 'error'); ConfigModal.open(); return; }
    const proj = activeProject(); if (!proj) return;
    const todo = proj.items.filter(it => !it.imageId && (it.situation || it.text || it.label));
    if (!todo.length) { showToast('그릴 빈 칸이 없어요. (표정·상황이 비어 있으면 건너뜁니다)', 'error'); return; }
    // 기준 캐릭터가 지정돼 있고 아직 안 그려졌으면 먼저 그려서 일관성 기준을 확보
    const base = proj.items.find(it => it.baseChar);
    const ordered = base && !base.imageId ? [base, ...todo.filter(it => it.id !== base.id)] : todo;
    const btn = $('s-gen-all'); btn.disabled = true;
    state.genCancel = false; showGenCancel(true);
    let ok = 0, fail = 0, stopped = false;
    for (let i = 0; i < ordered.length; i++) {
      if (state.genCancel) { stopped = true; break; }
      setProc('s-progress', stepRunning(`그리는 중... (${i + 1}/${ordered.length}) — ${escapeHtml(ordered[i].label || '')}`));
      const done = await genCell(ordered[i].id, { silent: true });
      done ? ok++ : fail++;
    }
    showGenCancel(false); state.genCancel = false; btn.disabled = false;
    setProc('s-progress', stopped
      ? `<div class="step">⏹️ 중단했어요 — 완성 ${ok}개${fail ? ` · 실패 ${fail}개` : ''}. 나머지는 개별 🎨로 이어서 그릴 수 있어요.</div>`
      : (fail ? `<div class="step err-line">완료 ${ok}개 · 실패 ${fail}개 (개별 🎨로 재시도하세요)</div>` : `<div class="step ok-line">✅ ${ok}개 완성!</div>`));
  }

  function saveStudioConcept() {
    const proj = activeProject(); if (!proj) { showToast('저장할 프로젝트가 없어요.', 'error'); return; }
    proj.name = ($('s-name').value.trim() || proj.name || '새 이모티콘');
    Store.saveProject(proj); renderProjectList();
    showToast('💾 프로젝트를 저장했어요. 보관함에서 볼 수 있어요.', 'success');
  }

  // ── 다듬기(편집) 모달 ──────────────────────────────────
  async function openEdit(id) {
    const proj = activeProject(); if (!proj) return;
    const item = proj.items.find(x => x.id === id); if (!item) return;
    if (!item.imageId) { showToast('먼저 🎨 그리기로 그림을 만든 뒤 다듬을 수 있어요.', 'error'); return; }
    state.editTarget = { projectId: proj.id, itemId: id };
    $('edit-instruction').value = '';
    setProc('edit-progress', '');
    const url = await imgUrl(item.imageId);
    $('edit-img').src = url;
    await renderEditHistory();
    $('edit-modal').classList.remove('hidden');
  }
  async function renderEditHistory() {
    const t = state.editTarget; if (!t) return;
    const proj = Store.getProject(t.projectId); const item = proj && proj.items.find(x => x.id === t.itemId);
    if (!item) return;
    const hist = item.history || [];
    const urls = await Promise.all(hist.map(h => imgUrl(h)));
    $('edit-history').innerHTML = hist.map((h, i) =>
      `<img src="${urls[i]}" class="${h === item.imageId ? 'cur' : ''}" data-action="revert-history" data-img="${h}" title="이 버전으로 되돌리기" />`
    ).join('');
  }
  async function applyEdit() {
    const t = state.editTarget; if (!t) return;
    const instr = $('edit-instruction').value.trim();
    if (!instr) { showToast('어떻게 바꿀지 적어주세요.', 'error'); return; }
    const proj = Store.getProject(t.projectId); const item = proj && proj.items.find(x => x.id === t.itemId);
    if (!item || !item.imageId) return;
    $('edit-apply').disabled = true;
    setProc('edit-progress', stepRunning('다듬는 중...'));
    try {
      const cur = await Store.getImage(item.imageId);
      const img = await GeminiImage.edit(cur, instr, { bg: proj.concept.bg, model: proj.concept.model });
      const imgId = Store.newId('img');
      await Store.saveImage(imgId, img);
      _imgCache.set(imgId, Store.dataUrl(img));
      item.imageId = imgId;
      commitItem(proj.id, item.id, (it) => { it.imageId = imgId; it.history = (it.history || []).concat(imgId); });
      $('edit-img').src = Store.dataUrl(img);
      $('edit-instruction').value = '';
      await renderEditHistory();
      paintStage(item);
      setProc('edit-progress', '<div class="step ok-line">✅ 새 버전을 만들었어요. 계속 다듬거나 닫으세요.</div>');
    } catch (e) { setProc('edit-progress', stepErr(e.message || e)); }
    finally { $('edit-apply').disabled = false; }
  }
  async function revertHistory(imgId) {
    const t = state.editTarget; if (!t) return;
    const proj = Store.getProject(t.projectId); const item = proj && proj.items.find(x => x.id === t.itemId);
    if (!item) return;
    item.imageId = imgId;
    commitItem(proj.id, item.id, (it) => { it.imageId = imgId; });
    $('edit-img').src = await imgUrl(imgId);
    await renderEditHistory(); await paintStage(item);
    showToast('이 버전으로 되돌렸어요.');
  }

  // ── 보관함 ─────────────────────────────────────────────
  function downloadDataUrl(url, filename) {
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function downloadImage(imageId, name) {
    const url = await imgUrl(imageId); if (!url) { showToast('이미지를 찾지 못했어요.', 'error'); return; }
    downloadDataUrl(url, sanitizeFilename(name) + '.png');
  }
  async function downloadProject(id) {
    const proj = Store.getProject(id); if (!proj) return;
    const done = proj.items.filter(it => it.imageId);
    if (!done.length) { showToast('내려받을 그림이 없어요.', 'error'); return; }
    showToast(`⬇️ ${done.length}개를 순서대로 저장해요. 브라우저의 다중 다운로드를 허용해 주세요.`);
    for (let i = 0; i < done.length; i++) {
      const it = done[i];
      const url = await imgUrl(it.imageId);
      if (url) downloadDataUrl(url, `${sanitizeFilename(proj.name)}_${String(i + 1).padStart(2, '0')}_${sanitizeFilename(it.label || '')}.png`);
      await new Promise(r => setTimeout(r, 250)); // 연속 다운로드 차단 방지
    }
  }
  async function deleteProject(id) {
    const proj = Store.getProject(id); if (!proj) return;
    if (!confirm(`'${proj.name}' 프로젝트를 삭제할까요? 되돌릴 수 없어요.`)) return;
    await Store.deleteProject(id);
    if (state.activeId === id) state.activeId = null;
    renderProjectList(); renderGallery(); renderStudio();
    showToast('프로젝트를 삭제했어요.');
  }

  async function renderGallery() {
    const projects = Store.getProjects();
    const wrap = $('g-projects');
    if (!projects.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">📦</div>아직 저장된 이모티콘이 없어요.<br/>컨셉 기획에서 시작해 보세요!</div>`;
      return;
    }
    wrap.innerHTML = projects.map(p => {
      const sp = specOf(p.concept.spec);
      const done = Store.countDone(p);
      const cells = (p.items || []).filter(it => it.imageId).slice(0, 24).map(it =>
        `<div class="gal-thumb" data-thumb="${it.imageId}"><span class="media"></span></div>`).join('');
      return `
      <div class="gal-project">
        <div class="gal-head">
          <div>
            <div class="gal-title">${escapeHtml(p.name)}</div>
            <div class="gal-sub">${escapeHtml(p.concept.tagline || '')} · ${escapeHtml(sp.label)} · 완성 ${done}/${p.items.length}</div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-ghost" style="padding:7px 11px;" data-action="open-project" data-id="${p.id}">✏️ 작업실에서 열기</button>
            <button class="btn btn-ghost" style="padding:7px 11px;" data-action="download-project" data-id="${p.id}">⬇️ 모두 저장</button>
            <button class="btn btn-ghost btn-danger" style="padding:7px 11px;" data-action="delete-project" data-id="${p.id}">🗑️</button>
          </div>
        </div>
        ${done ? `<div class="gal-grid">${cells}</div>` : '<div class="hint">아직 그린 그림이 없어요.</div>'}
      </div>`;
    }).join('');
    // 썸네일 비동기 로드
    document.querySelectorAll('#g-projects [data-thumb]').forEach(async (el) => {
      const url = await imgUrl(el.dataset.thumb);
      if (url) el.innerHTML = `<img src="${url}" alt="" />`;
    });
  }

  // ── 사이드바 프로젝트 목록 ────────────────────────────
  function renderProjectList() {
    const projects = Store.getProjects();
    const list = $('project-list');
    if (!projects.length) {
      list.innerHTML = `<div class="hint" style="padding:6px 4px;">아직 프로젝트가 없어요.<br/>컨셉 기획부터 시작해 보세요!</div>`;
    } else {
      list.innerHTML = projects.map(p =>
        `<button class="proj-item ${p.id === state.activeId ? 'active' : ''}" data-action="open-project" data-id="${p.id}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span>
          <span class="cnt">${Store.countDone(p)}/${(p.items || []).length}</span>
        </button>`).join('');
    }
    const proj = activeProject();
    $('active-project-chip').textContent = proj ? `📁 ${proj.name}` : '진행 중인 프로젝트 없음';
    updateStudioBadge();
  }

  function openProject(id) { state.activeId = id; renderProjectList(); showView('studio'); }

  // ── 사이드바(모바일) ──────────────────────────────────
  function openSidebar() {
    document.querySelector('.sidebar').classList.add('open'); $('sidebar-overlay').classList.add('show');
    const m = document.querySelector('.main'); if (m && 'inert' in m) m.inert = true;
  }
  function closeSidebar() {
    document.querySelector('.sidebar').classList.remove('open'); $('sidebar-overlay').classList.remove('show');
    const m = document.querySelector('.main'); if (m && 'inert' in m) m.inert = false;
  }

  // ── 액션 위임 ─────────────────────────────────────────
  const ACTIONS = {
    'use-concept': (d) => { const c = (d.src === 'idea' ? _lastIdeas : _lastConcepts)[parseInt(d.idx, 10)]; if (c) createProjectFromConcept(c, d.spec); },
    'remove-ref': (d) => { state.refs = state.refs.filter(r => r.id !== d.id); renderRefs(); },
    'gen-cell': (d) => genCell(d.id),
    'edit-cell': (d) => openEdit(d.id),
    'base-cell': (d) => setBaseChar(d.id),
    'del-cell': (d) => delCell(d.id),
    'revert-history': (d) => revertHistory(d.img),
    'open-project': (d) => openProject(d.id),
    'download-project': (d) => downloadProject(d.id),
    'download-img': (d) => downloadImage(d.img, d.name),
    'delete-project': (d) => deleteProject(d.id),
  };

  // ── 앱 진입/초기화 ────────────────────────────────────
  function enterApp() {
    $('login-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    renderProjectList();
    showView('concept');
    updateSpecHint();
  }
  function onConfigSaved() {
    // 설정 저장 직후, 아직 시작 화면이면 바로 앱으로 진입
    if (ConfigModal.hasValidConfig() && $('app').classList.contains('hidden')) enterApp();
  }

  function bindSelectCustom(selId, fieldId) {
    const sel = $(selId); if (!sel) return;
    sel.addEventListener('change', () => { $(fieldId).style.display = sel.value === '__custom' ? '' : 'none'; });
  }

  function init() {
    // 시작 화면
    $('start-btn').addEventListener('click', () => { if (ConfigModal.hasValidConfig()) enterApp(); else { showToast('Gemini API 키를 먼저 입력하세요.', 'error'); ConfigModal.open(); } });
    $('login-config-btn').addEventListener('click', () => ConfigModal.open());

    // 설정 모달
    $('side-settings').addEventListener('click', () => ConfigModal.open());
    $('cfg-cancel').addEventListener('click', () => ConfigModal.close());
    $('cfg-save').addEventListener('click', () => ConfigModal.save());
    $('cfg-export-btn').addEventListener('click', () => ConfigModal.exportConfig());
    $('cfg-import-btn').addEventListener('click', () => ConfigModal.importConfig());

    // 도움말
    $('help-btn').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
    $('help-close').addEventListener('click', () => $('help-modal').classList.add('hidden'));

    // 네비
    document.querySelectorAll('.side-item[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
    $('sidebar-toggle').addEventListener('click', openSidebar);
    $('sidebar-close').addEventListener('click', closeSidebar);
    $('sidebar-overlay').addEventListener('click', closeSidebar);
    $('new-project').addEventListener('click', () => { createBlankProject(); showView('studio'); });
    $('g-refresh').addEventListener('click', renderGallery);

    // 컨셉 기획
    bindSelectCustom('c-subject', 'c-subject-custom-field');
    bindSelectCustom('c-tone', 'c-tone-custom-field');
    bindSelectCustom('i-subject', 'i-subject-custom-field');
    $('c-spec').addEventListener('change', updateSpecHint);
    $('c-generate').addEventListener('click', generateConcepts);

    // 레퍼런스 업로드
    const dz = $('ref-dropzone');
    dz.addEventListener('click', () => $('ref-file').click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('ref-file').click(); } });
    $('ref-file').addEventListener('change', (e) => { addRefFiles(e.target.files); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) addRefFiles(e.dataTransfer.files); });
    document.addEventListener('paste', (e) => {
      if ($('view-ideate').classList.contains('hidden')) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const files = []; for (const it of items) { if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) files.push(f); } }
      if (files.length) { addRefFiles(files); showToast('붙여넣은 이미지를 추가했어요.'); }
    });
    $('i-generate').addEventListener('click', generateIdeas);

    // 작업실
    $('studio-blank').addEventListener('click', () => { createBlankProject(); });
    $('s-suggest-set').addEventListener('click', suggestSet);
    $('s-add-item').addEventListener('click', addItem);
    $('s-gen-all').addEventListener('click', genAll);
    $('studio-save').addEventListener('click', saveStudioConcept);
    // 컨셉 필드 → 프로젝트 반영
    [['s-name', 'name'], ['s-tagline', 'tagline'], ['s-style', 'style'], ['s-spec', 'spec'], ['s-bg', 'bg'], ['s-model', 'model']].forEach(([id, key]) => {
      const el = $(id); if (!el) return;
      el.addEventListener('change', () => {
        const proj = activeProject(); if (!proj) return;
        if (key === 'name') proj.name = el.value.trim() || proj.name;
        proj.concept[key] = el.value;
        Store.saveProject(proj);
        if (key === 'spec') { renderSetGrid(); }
        renderProjectList();
      });
    });
    // 셀 인라인 입력
    $('s-set-grid').addEventListener('input', (e) => {
      const inp = e.target.closest('[data-field]'); if (!inp) return;
      updateItemField(inp.dataset.id, inp.dataset.field, inp.value);
    });

    // 다듬기 모달
    $('edit-cancel').addEventListener('click', () => $('edit-modal').classList.add('hidden'));
    $('edit-apply').addEventListener('click', applyEdit);
    document.querySelectorAll('#edit-modal .chip').forEach(ch => ch.addEventListener('click', () => {
      const cur = $('edit-instruction'); cur.value = (cur.value ? cur.value.trim() + ', ' : '') + ch.dataset.edit; cur.focus();
    }));

    // 모달 바깥 클릭으로 닫기
    document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); }));
    // Esc로 열린 모달 닫기 / 모바일 사이드바 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll('.modal-overlay:not(.hidden)');
      if (open.length) { open.forEach(m => m.classList.add('hidden')); return; }
      closeSidebar();
    });

    // 액션 위임
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]'); if (!t) return;
      const fn = ACTIONS[t.dataset.action]; if (fn) { e.preventDefault(); fn(t.dataset, t, e); }
    });

    // 로그인 게이트
    if (ConfigModal.hasValidConfig()) enterApp();
  }

  return { init, onConfigSaved };
})();

document.addEventListener('DOMContentLoaded', App.init);
