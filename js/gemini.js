/**
 * 모챙이 - Gemini 텍스트 생성 모듈
 *   - 컨셉 기획(planConcepts), 레퍼런스 아이디에이션(ideate), 표정 세트 구성(suggestSetList)
 *   - API 키(GEMINI_API_KEY)로 직접 호출. 이미지 생성은 image.js(GeminiImage) 담당.
 */
const GeminiText = (() => {
  function _cfg() { return window.MOCHANGI_CONFIG || {}; }
  function _key() {
    const k = _cfg().GEMINI_API_KEY;
    if (!k || k.indexOf('YOUR_') === 0) throw new Error('Gemini API 키가 없습니다. ⚙️ 설정에서 키를 입력하세요.');
    return k;
  }
  function _model() { return _cfg().TEXT_MODEL || 'gemini-2.5-flash'; }

  // 코드펜스/잡텍스트가 섞여도 JSON 본문만 안전하게 파싱
  function _parseJSON(text) {
    if (!text) throw new Error('빈 응답');
    let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(t); } catch (_) {}
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    // 객체/배열 중 먼저 등장하는 쪽을 시도
    const candidates = [];
    if (s !== -1 && e > s) candidates.push(t.slice(s, e + 1));
    if (a !== -1 && b > a) candidates.push(t.slice(a, b + 1));
    for (const c of candidates) { try { return JSON.parse(c); } catch (_) {} }
    throw new Error('AI 응답을 JSON으로 해석하지 못했습니다.');
  }

  async function _call(parts, generationConfig) {
    const model = _model();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${_key()}`;
    let gc = Object.assign({ temperature: 0.9, maxOutputTokens: 8192 }, generationConfig || {});
    // thinkingConfig는 2.5-flash 계열에서만 유효 — 그 외 모델엔 보내지 않는다.
    if (gc.thinkingConfig && !/gemini-2\.5-flash/.test(model)) { gc = Object.assign({}, gc); delete gc.thinkingConfig; }

    const body = JSON.stringify({ contents: [{ parts }], generationConfig: gc });
    let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok && res.status === 400 && gc.thinkingConfig) {
      let info = ''; try { info = await res.text(); } catch (_) {}
      if (/think/i.test(info)) {
        const gc2 = Object.assign({}, gc); delete gc2.thinkingConfig;
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: gc2 }) });
      }
    }
    if (!res.ok) {
      let info = ''; try { info = await res.text(); } catch (_) {}
      throw new Error(`Gemini 오류 (${res.status}) ${info.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    const json = await res.json();
    const pf = json.promptFeedback;
    if (pf && pf.blockReason) throw new Error(`요청이 차단되었습니다 (사유: ${pf.blockReason}).`);
    const cand = json.candidates && json.candidates[0];
    if (!cand) throw new Error('응답에 결과가 없습니다 — 잠시 후 다시 시도하세요.');
    const text = (cand.content && cand.content.parts || []).filter(p => p && p.text).map(p => p.text).join('').trim();
    if (!text) {
      const fr = cand.finishReason || '';
      if (fr === 'MAX_TOKENS') throw new Error('출력이 토큰 한도에서 끊겼습니다 — 항목 수를 줄이거나 다시 시도하세요.');
      throw new Error(`응답을 완성하지 못했습니다${fr ? ` (사유: ${fr})` : ''}.`);
    }
    return text;
  }

  function _imgParts(images) {
    return (images || []).filter(im => im && im.data).map(im => ({ inline_data: { mime_type: im.mime || 'image/png', data: im.data } }));
  }

  // 컨셉안 JSON 스키마 설명(여러 함수에서 공유)
  const CONCEPT_SHAPE =
    '각 컨셉은 다음 형태:\n'
    + '{\n'
    + '  "name": "캐릭터 이름(짧고 부르기 쉽게)",\n'
    + '  "tagline": "한 줄 컨셉(쉼표 없이 14자 내외)",\n'
    + '  "personality": "성격·세계관 2~3문장",\n'
    + '  "visual": {"style":"그림 스타일을 구체적으로(선 굵기, 비율, 채색 방식)", "palette":["#hex", "#hex", "#hex"], "keyFeatures":"한눈에 알아볼 시각적 특징"},\n'
    + '  "differentiator": "비슷한 이모티콘과 다른 차별점 1~2문장",\n'
    + '  "titleCandidates": ["이모티콘 상품 제목 후보 3개"],\n'
    + '  "imagePromptStyle": "이 캐릭터를 그릴 때 모든 컷에 공통으로 넣을 영어+한국어 혼합 스타일 묘사(외곽선/채색/비율/무드). 카카오 이모티콘 스타일."\n'
    + '}';

  // ── 컨셉 기획 ──────────────────────────────────────────────
  // input: { subject, tone, target, keywords, count, specLabel, setCount }
  async function planConcepts(input) {
    const { subject, tone, target, keywords, count, specLabel, setCount } = input;
    const prompt = [
      '너는 카카오톡 이모티콘 기획자야. 잘 팔리고 사랑받는 이모티콘 컨셉을 잡아주는 게 일이야.',
      '',
      '[기획 의뢰]',
      `- 주제: ${subject}`,
      `- 톤/컨셉: ${tone}`,
      target ? `- 타깃/쓰임새: ${target}` : '',
      keywords ? `- 꼭 살릴 키워드·상황: ${keywords}` : '',
      `- 규격: ${specLabel} (한 세트 ${setCount}종 기준으로 기획)`,
      '',
      '[요청]',
      `- 서로 결이 다른 컨셉안을 정확히 ${count}개 제안해. 비슷비슷한 안을 여러 개 내지 말고, 캐릭터·매력 포인트가 확실히 구분되게.`,
      '- 흔하고 식상한 클리셰(그냥 웃는 동물 등)는 피하고, 한 끗 다른 매력과 "이거다" 싶은 후킹 포인트를 넣어.',
      '- 실제로 상품화 가능한, 구체적이고 그릴 수 있는 컨셉으로.',
      '- 한국어로. 결과는 아래 JSON 형식으로만 답하고 다른 말은 절대 하지 마.',
      '',
      CONCEPT_SHAPE,
      '',
      '최종 출력 형식: {"concepts": [컨셉, 컨셉, ...]}',
    ].filter(Boolean).join('\n');

    const text = await _call([{ text: prompt }], {
      temperature: 1.0, maxOutputTokens: 8192, responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    });
    const r = _parseJSON(text);
    const list = Array.isArray(r) ? r : (r.concepts || []);
    if (!list.length) throw new Error('컨셉을 생성하지 못했습니다 — 다시 시도해 주세요.');
    return list;
  }

  // ── 레퍼런스 아이디에이션(표절 방지) ──────────────────────────
  // refs: [{mime,data}], input: { subject, note, count, specLabel, setCount }
  // 업로드 이미지는 '글 분석'에만 쓰고, 새 컨셉은 사용자의 주제로 독창 생성한다.
  async function ideate(refs, input) {
    const { subject, note, count, specLabel, setCount } = input;
    const prompt = [
      '너는 이모티콘 아트디렉터야. 아래 첨부된 레퍼런스 이모티콘 이미지를 분석한 뒤,',
      '저작권을 침해하지 않는 완전히 새로운 컨셉을 제안하는 게 임무야.',
      '',
      '[매우 중요 — 표절 금지 원칙]',
      '- 레퍼런스의 "추상적 스타일 속성"만 배워: 선 굵기, 색감/팔레트 경향, 비율(머리:몸), 유머 코드, 구도, 여백, 텍스트 사용 방식.',
      '- 레퍼런스의 "구체적 형상"은 절대 가져오지 마: 특정 캐릭터의 생김새, 시그니처 포즈, 의상/소품, 이름, 브랜드/IP 요소.',
      '- 결과 캐릭터는 사용자가 고른 주제로 새로 창작한 독창적 캐릭터여야 해. 레퍼런스와 한눈에 구별돼야 해.',
      '- 참고: 이 레퍼런스 이미지는 이후 이미지 생성에 전달되지 않아. 그러니 컨셉을 레퍼런스 모방이 아니라 사용자 주제 기반의 완전한 새 캐릭터로 잡아.',
      '',
      '[사용자 요청]',
      `- 변형할 주제: ${subject}`,
      note ? `- 원하는 변화/메모: ${note}` : '',
      `- 규격: ${specLabel} (한 세트 ${setCount}종)`,
      '',
      '[출력] 아래 JSON으로만 답해. 다른 말 금지.',
      '{',
      '  "styleAnalysis": {"lineWeight":"", "palette":["#hex"...], "proportion":"", "humorType":"", "composition":"", "mood":"", "textUsage":""},',
      '  "doNotCopy": ["이 레퍼런스에서 절대 베끼면 안 되는 구체 요소들(특정 캐릭터 형상/소품/IP 등)"],',
      `  "freshDirections": [서로 다른 새 컨셉 ${count}개]`,
      '}',
      '각 freshDirection 컨셉의 형태는 다음과 같아:',
      CONCEPT_SHAPE,
    ].filter(Boolean).join('\n');

    const parts = [{ text: prompt }];
    if (refs && refs.length) {
      parts.push({ text: `\n[레퍼런스 이미지 ${refs.length}장 — 스타일 분석 전용]` });
      parts.push(..._imgParts(refs));
    }
    const text = await _call(parts, {
      temperature: 0.95, maxOutputTokens: 8192, responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    });
    const r = _parseJSON(text);
    if (!r.freshDirections || !r.freshDirections.length) throw new Error('변형 아이디어를 만들지 못했습니다 — 다시 시도해 주세요.');
    return r;
  }

  // ── 표정·상황 세트 구성 ───────────────────────────────────────
  // concept: {name,tagline,personality}, count: 종수
  async function suggestSetList(concept, count) {
    const prompt = [
      '아래 이모티콘 캐릭터로 한 세트를 구성할 거야. 단톡방·메신저에서 자주 쓰는 표현을 골고루 담아.',
      '',
      `- 캐릭터: ${concept.name || ''} / ${concept.tagline || ''}`,
      concept.personality ? `- 성격: ${concept.personality}` : '',
      '',
      `정확히 ${count}개의 칸을 만들어. 인사·긍정·부정·감정(웃음/슬픔/화남/사랑)·리액션(놀람/박수/엄지)·일상(배고픔/졸림/바쁨)·유행 표현 등이 겹치지 않게 골고루 섞어.`,
      '각 칸은 다음 형태의 JSON:',
      '{"no":1, "label":"짧은 이름(예: 반가워)", "situation":"캐릭터가 취하는 표정·동작·상황을 그릴 수 있게 구체적으로", "text":"이모티콘에 넣을 짧은 한국어 문구(없으면 빈 문자열)"}',
      '',
      `출력 형식: {"items": [${count}개]} — JSON만, 다른 말 금지.`,
    ].filter(Boolean).join('\n');

    const text = await _call([{ text: prompt }], {
      temperature: 0.9, maxOutputTokens: 8192, responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    });
    const r = _parseJSON(text);
    const items = Array.isArray(r) ? r : (r.items || []);
    if (!items.length) throw new Error('세트 구성을 만들지 못했습니다.');
    return items.map((it, i) => ({
      no: it.no || i + 1,
      label: (it.label || `${i + 1}번`).toString().slice(0, 20),
      situation: (it.situation || '').toString(),
      text: (it.text || '').toString().slice(0, 20),
    }));
  }

  // ── 표정·상황 자동 채우기 ─────────────────────────────────────
  //  items의 빈 항목(라벨/표정·상황/문구)만 채워 돌려준다. 이미 값이 있는 항목은 그대로 둔다.
  //  (프런트가 '비파괴 병합' 또는 '칸별 덮어쓰기'를 골라 적용)
  async function fillSet(concept, items) {
    const list = (items || []).map((it, i) => ({
      no: it.no || i + 1, label: it.label || '', situation: it.situation || '', text: it.text || '',
    }));
    if (!list.length) throw new Error('채울 칸이 없습니다.');
    const lines = list.map(it => `${it.no}) 라벨:"${it.label}" 표정·상황:"${it.situation}" 문구:"${it.text}"`).join('\n');
    const prompt = [
      '아래 이모티콘 캐릭터의 세트 칸들을 채워줘.',
      `- 캐릭터: ${concept.name || ''} / ${concept.tagline || ''}`,
      concept.personality ? `- 성격: ${concept.personality}` : '',
      '',
      '[현재 칸 목록] (빈 값은 "" 로 표시됨):',
      lines,
      '',
      '[규칙]',
      '- 각 칸에서 비어있는 항목만 채워. 이미 값이 있는 항목(라벨/표정·상황/문구)은 절대 바꾸지 마.',
      '- 라벨이 있으면 그 라벨에 어울리는 "표정·상황"을 캐릭터가 취하는 표정·동작·상황으로 그릴 수 있게 구체적으로 써.',
      '- 라벨에 어울리는 짧은 한국어 문구도 채워(문구가 굳이 필요 없으면 빈 문자열 "").',
      '- 라벨이 비어 있으면 다른 칸과 겹치지 않는 새 표현으로 라벨까지 채워.',
      '- 메신저에서 자주 쓰는 표현으로, 칸들끼리 의미가 겹치지 않게 다양하게.',
      '',
      `출력: {"items":[${list.length}개]} — 입력과 같은 개수·순서. 각 항목은 {"no","label","situation","text"}. JSON만, 다른 말 금지.`,
    ].filter(Boolean).join('\n');

    const text = await _call([{ text: prompt }], {
      temperature: 0.9, maxOutputTokens: 8192, responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    });
    const r = _parseJSON(text);
    const out = Array.isArray(r) ? r : (r.items || []);
    if (!out.length) throw new Error('표정·상황을 만들지 못했습니다 — 다시 시도해 주세요.');
    return out.map((it, i) => ({
      no: it.no || (list[i] && list[i].no) || i + 1,
      label: (it.label || '').toString().slice(0, 20),
      situation: (it.situation || '').toString(),
      text: (it.text || '').toString().slice(0, 20),
    }));
  }

  return { planConcepts, ideate, suggestSetList, fillSet };
})();
