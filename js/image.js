/**
 * 모챙이 - Gemini 이미지 생성/편집 모듈 (Nano Banana)
 *   generate(): 텍스트(+기준 캐릭터 참조)로 이모티콘 컷 생성
 *   edit():     기존 컷 + 자연어 지시로 다듬기(편집)
 *   응답의 inlineData(base64)를 { mime, data } 로 돌려준다.
 */
const GeminiImage = (() => {
  function _cfg() { return window.MOCHANGI_CONFIG || {}; }
  function _key() {
    const k = _cfg().GEMINI_API_KEY;
    if (!k || k.indexOf('YOUR_') === 0) throw new Error('Gemini API 키가 없습니다. ⚙️ 설정에서 키를 입력하세요.');
    return k;
  }
  function _model(override) { return override || _cfg().IMAGE_MODEL || 'gemini-3-pro-image'; }
  function _aspect() { return _cfg().ASPECT_RATIO || '1:1'; }

  // 응답 파트에서 첫 이미지 추출 (REST는 camelCase inlineData/mimeType)
  function _extractImage(json) {
    const cand = json.candidates && json.candidates[0];
    if (!cand) {
      const pf = json.promptFeedback;
      if (pf && pf.blockReason) throw new Error(`이미지 요청이 차단되었습니다 (사유: ${pf.blockReason}) — 표현/문구를 바꿔 다시 시도하세요.`);
      throw new Error('이미지 응답에 결과가 없습니다 — 잠시 후 다시 시도하세요.');
    }
    const parts = (cand.content && cand.content.parts) || [];
    for (const p of parts) {
      const inl = p.inlineData || p.inline_data;
      if (inl && inl.data) return { mime: inl.mimeType || inl.mime_type || 'image/png', data: inl.data };
    }
    // 이미지 없이 텍스트만 온 경우(안전필터/거절) — 사유를 사용자에게 전달
    const txt = parts.filter(p => p && p.text).map(p => p.text).join(' ').trim();
    const fr = cand.finishReason || '';
    if (fr === 'IMAGE_SAFETY' || fr === 'SAFETY') throw new Error(`안전 필터에 걸려 이미지를 만들지 못했습니다${txt ? ` (${txt.slice(0, 120)})` : ''} — 표현을 순화해 다시 시도하세요.`);
    throw new Error('이미지를 생성하지 못했습니다' + (txt ? `: ${txt.slice(0, 160)}` : ' — 다시 시도해 주세요.'));
  }

  async function _imageCall(parts, aspect) {
    const model = _model(parts._model);
    const key = _key();
    const ar = aspect || _aspect();
    const base = { contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
    const withCfg = JSON.parse(JSON.stringify(base));
    withCfg.generationConfig.imageConfig = { aspectRatio: ar };

    function url(ver) { return `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${key}`; }
    async function post(ver, payload) {
      return fetch(url(ver), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }

    // API 버전 폴백: 최신 이미지 모델이 v1beta/v1 어디에만 있을 수 있어 404면 다른 버전 시도
    let ver = 'v1beta';
    let res = await post(ver, withCfg);
    if (!res.ok && res.status === 404) { ver = 'v1'; res = await post(ver, withCfg); }
    if (!res.ok && res.status === 400) {
      let info = ''; try { info = await res.text(); } catch (_) {}
      if (/aspect|imageConfig|image_config|responseFormat|unknown name|Unknown field/i.test(info)) {
        res = await post(ver, base); // imageConfig 없이 재시도
      } else {
        throw new Error(`이미지 오류 (400) ${info.replace(/\s+/g, ' ').slice(0, 200)}`);
      }
    }
    if (!res.ok) {
      let info = ''; try { info = await res.text(); } catch (_) {}
      if (res.status === 429) throw new Error('요청이 많아요(429) — 잠시 후 다시 시도하세요. 무료 등급은 이미지 한도가 낮을 수 있어요.');
      if (res.status === 404) throw new Error(`이미지 모델(${model})을 찾지 못했어요(404) — 설정에서 다른 이미지 모델로 바꿔보세요.`);
      throw new Error(`이미지 오류 (${res.status}) ${info.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    return _extractImage(await res.json());
  }

  function _imgPart(im) { return { inline_data: { mime_type: im.mime || 'image/png', data: im.data } }; }

  const BG_GUIDE = {
    transparent: 'Transparent background with alpha channel — fully isolated subject, NO background scene, output as PNG with transparency.',
    white: 'Clean solid pure-white background.',
    soft: 'Soft single flat pastel-color background, minimal.',
  };

  // 이모티콘 한 컷 프롬프트 조립
  //   concept: { name, tagline, style(=imagePromptStyle/visual.style) }
  //   item: { label, situation, text }
  //   opts: { bg, hasRef }
  function buildPrompt(concept, item, opts) {
    opts = opts || {};
    const style = concept.style || concept.imagePromptStyle || (concept.visual && concept.visual.style) || '';
    const lines = [];
    lines.push('Korean messenger sticker / KakaoTalk emoticon, single mascot character, centered with small margin, square 1:1 composition.');
    if (opts.hasRef) {
      lines.push('IMPORTANT: the reference image is a previous drawing of THIS SAME character from this project. Keep its identity (design, colors, line style, proportions) exactly consistent. Only change the pose and facial expression as described.');
    } else {
      if (concept.name) lines.push(`Character: ${concept.name}${concept.tagline ? ` (${concept.tagline})` : ''}.`);
      if (style) lines.push(`Art style: ${style}.`);
      lines.push('Bold clean even outline, flat cel coloring, simple and very expressive, cute appealing emoticon look.');
    }
    if (item.situation) lines.push(`Pose / expression / scene: ${item.situation}.`);
    if (item.text) {
      lines.push(`Render this exact Korean text large and clearly readable in the image: "${item.text}". Korean hangul, bold rounded lettering, no spelling changes.`);
    } else {
      lines.push('No text.');
    }
    lines.push(BG_GUIDE[opts.bg] || BG_GUIDE.transparent);
    lines.push('No watermark, no signature, no extra characters, no UI frame.');
    return lines.join(' ');
  }

  // 한 컷 생성. references: [{mime,data}] — 작업실 '기준 캐릭터' 등 프로젝트 내부 이미지만(일관성용).
  //   ⚠️ 사용자가 업로드한 레퍼런스(state.refs)는 절대 여기로 넘기지 않는다(표절 방지).
  //   opts: { bg, aspect, model, references }
  async function generate(concept, item, opts) {
    opts = opts || {};
    const refs = (opts.references || []).filter(r => r && r.data);
    const prompt = buildPrompt(concept, item, { bg: opts.bg, hasRef: refs.length > 0 });
    const parts = [{ text: prompt }];
    refs.forEach(r => parts.push(_imgPart(r)));
    if (opts.model) parts._model = opts.model;
    return _imageCall(parts, opts.aspect);
  }

  // 다듬기(편집): 기존 이미지 + 자연어 지시 → 새 버전
  //   opts: { bg, aspect, model }
  async function edit(image, instruction, opts) {
    opts = opts || {};
    const guide = [
      'Edit this Korean emoticon sticker image as instructed, keeping the same character identity and overall style consistent.',
      `Instruction: ${instruction}.`,
      opts.bg ? (BG_GUIDE[opts.bg] || '') : '',
      'Keep it a clean single-character emoticon. No watermark, no signature.',
    ].filter(Boolean).join(' ');
    const parts = [{ text: guide }, _imgPart(image)];
    if (opts.model) parts._model = opts.model;
    return _imageCall(parts, opts.aspect);
  }

  return { generate, edit, buildPrompt };
})();
