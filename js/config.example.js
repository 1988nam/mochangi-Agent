/**
 * 모챙이 설정 예시.
 * 이 파일은 선택 사항입니다 — 앱은 ⚙️ 설정 화면에서 키를 입력하면 localStorage에 저장합니다.
 * 키를 코드로 고정하고 싶다면 이 파일을 config.js로 복사하고 index.html에서 불러오세요.
 * (단, 키가 소스에 노출되니 개인용 로컬 사용에만 권장)
 */
window.MOCHANGI_CONFIG = {
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',   // Google AI Studio(aistudio.google.com)에서 발급
  IMAGE_MODEL: 'gemini-3-pro-image',        // 이모티콘 그림 생성 (Nano Banana Pro). 비용 절약: gemini-2.5-flash-image
  TEXT_MODEL: 'gemini-2.5-flash',           // 컨셉 기획·아이디에이션
  ASPECT_RATIO: '1:1',                      // 카카오 이모티콘은 정사각 권장
};
