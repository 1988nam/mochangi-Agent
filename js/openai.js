/**
 * 모챙이 - OpenAI(GPT) 이미지 생성/편집 모듈
 *   브라우저는 OpenAI API를 CORS로 직접 못 부르므로, 같은 오리진의 프록시(functions/api/openai-image)를 통해 호출한다.
 *   프롬프트 조립은 GeminiImage.buildPrompt를 그대로 재사용(엔진과 무관한 텍스트).
 */
const OpenAIImage = (() => {
  function _cfg() { return window.MOCHANGI_CONFIG || {}; }
  function _key() {
    const k = _cfg().OPENAI_API_KEY;
    if (!k || k.indexOf('YOUR_') === 0) throw new Error('OpenAI API 키가 없습니다. ⚙️ 설정에서 입력하세요. (platform.openai.com에서 발급 — ChatGPT 구독과 별개)');
    return k;
  }
  function _proxy() { return _cfg().OPENAI_PROXY || '/api/openai-image'; }
  function _model(override) { return override || _cfg().OPENAI_IMAGE_MODEL || 'gpt-image-1'; }
  function _bg(bg) { return bg === 'transparent' ? 'transparent' : (bg === 'white' ? 'opaque' : 'auto'); }
  // gpt-image 사이즈는 정사각/세로/가로만 — 카카오 이모티콘은 정사각
  function _size(aspect) {
    if (aspect === '4:5' || aspect === '3:4' || aspect === '9:16') return '1024x1536';
    return '1024x1024';
  }

  async function _call(payload) {
    let res;
    try {
      res = await fetch(_proxy(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenAI-Key': _key() },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error('프록시에 연결하지 못했습니다 — GPT 이미지는 배포된 사이트(mochangi.pages.dev)에서 동작해요. 로컬 파일로 열면 Gemini만 됩니다. (' + ((e && e.message) || e) + ')');
    }
    let data; try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok || !data || data.error) {
      const msg = (data && data.error) || `OpenAI 이미지 오류 (${res.status})`;
      if (res.status === 401) throw new Error('OpenAI 인증 실패(401) — API 키를 확인하세요.');
      if (res.status === 429) throw new Error('OpenAI 사용량 한도(429) — 잠시 후 다시 시도하거나 크레딧을 확인하세요.');
      throw new Error(String(msg).slice(0, 220));
    }
    if (!data.b64) throw new Error('OpenAI 응답에 이미지가 없습니다.');
    return { mime: data.mime || 'image/png', data: data.b64 };
  }

  // 한 컷 생성. references(기준 캐릭터 등)가 있으면 편집(images/edits) 경로로 일관성 유지.
  async function generate(concept, item, opts) {
    opts = opts || {};
    const refs = (opts.references || []).filter(r => r && r.data);
    const prompt = GeminiImage.buildPrompt(concept, item, { bg: opts.bg, hasRef: refs.length > 0 });
    return _call({
      mode: refs.length ? 'edit' : 'generate',
      model: _model(opts.model),
      prompt,
      size: _size(opts.aspect || _cfg().ASPECT_RATIO),
      background: _bg(opts.bg),
      images: refs.map(r => r.data),
    });
  }

  // 다듬기(편집)
  async function edit(image, instruction, opts) {
    opts = opts || {};
    const prompt = [
      'Edit this Korean messenger emoticon sticker as instructed, keeping the same character identity and overall style consistent.',
      `Instruction: ${instruction}.`,
      'Keep it a clean single-character emoticon. No watermark, no signature.',
    ].join(' ');
    return _call({
      mode: 'edit',
      model: _model(opts.model),
      prompt,
      size: _size(opts.aspect || _cfg().ASPECT_RATIO),
      background: _bg(opts.bg),
      images: [image.data],
    });
  }

  return { generate, edit };
})();
