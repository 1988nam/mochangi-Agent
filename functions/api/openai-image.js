/**
 * 모챙이 - OpenAI 이미지 생성 프록시 (Cloudflare Pages Function)
 *   브라우저는 api.openai.com을 CORS로 직접 못 부르므로, 같은 오리진의 이 함수가 서버에서 중계한다.
 *   - 키는 호출자가 헤더(X-OpenAI-Key)로 가져온다(BYO-key). 서버에 저장하지 않고 그대로 전달만 함.
 *   - 요청(JSON): { mode:'generate'|'edit', model, prompt, size, background, images?:[base64...] }
 *   - 응답(JSON): { b64, mime } 또는 { error }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-OpenAI-Key',
};
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'image/png' });
}

export function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request } = context;
  const key = request.headers.get('X-OpenAI-Key');
  if (!key) return json({ error: 'OpenAI API 키가 없습니다. ⚙️ 설정에서 입력하세요.' }, 400);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: '잘못된 요청 형식입니다.' }, 400); }
  const { mode, model, prompt, size, background, images } = body || {};
  const mdl = model || 'gpt-image-1';

  try {
    let ores;
    if (mode === 'edit' && Array.isArray(images) && images.length) {
      // 이미지 편집/참조: multipart (image[] + prompt)
      const form = new FormData();
      form.append('model', mdl);
      form.append('prompt', prompt || '');
      if (size) form.append('size', size);
      if (background) form.append('background', background);
      form.append('output_format', 'png');
      form.append('n', '1');
      images.forEach((b64, i) => form.append('image[]', b64ToBlob(b64, 'image/png'), `img${i}.png`));
      ores = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      });
    } else {
      // 신규 생성: JSON
      const payload = { model: mdl, prompt: prompt || '', size: size || '1024x1024', n: 1, output_format: 'png' };
      if (background) payload.background = background;
      ores = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    }

    let data;
    try { data = await ores.json(); } catch (_) { data = null; }
    if (!ores.ok) {
      const msg = (data && data.error && data.error.message) || `OpenAI 오류 (${ores.status})`;
      return json({ error: msg }, ores.status);
    }
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return json({ error: 'OpenAI 응답에 이미지가 없습니다.' }, 502);
    return json({ b64, mime: 'image/png' }, 200);
  } catch (e) {
    return json({ error: '프록시 오류: ' + String((e && e.message) || e) }, 502);
  }
}
