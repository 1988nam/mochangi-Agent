/**
 * 모챙이 설정 예시.
 * 이 파일은 선택 사항입니다 — 앱은 ⚙️ 설정 화면에서 키를 입력하면 localStorage에 저장합니다.
 * 키를 코드로 고정하고 싶다면 이 파일을 config.js로 복사하고 index.html에서 불러오세요.
 * (단, 키가 소스에 노출되니 개인용 로컬 사용에만 권장)
 */
window.MOCHANGI_CONFIG = {
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',   // Google AI Studio(aistudio.google.com)에서 발급 — 컨셉 기획·텍스트(필수)
  OPENAI_API_KEY: '',                       // platform.openai.com 발급 — GPT 이미지(gpt-image-1) 쓸 때만. ChatGPT 구독과 별개
  IMAGE_MODEL: 'gemini-3-pro-image',        // 새 프로젝트 기본 엔진. gpt-image-1/gpt-image-2 고르면 OpenAI로 자동 연결
  OPENAI_IMAGE_MODEL: 'gpt-image-1',        // OpenAI 이미지 모델(투명배경 지원). gpt-image-2는 투명배경 미지원
  OPENAI_PROXY: '',                         // 비우면 같은 오리진 '/api/openai-image' 사용. 로컬에서 배포 프록시를 쓰려면 절대 URL 지정
  TEXT_MODEL: 'gemini-2.5-flash',           // 컨셉 기획·아이디에이션(항상 Gemini)
  ASPECT_RATIO: '1:1',                      // 카카오 이모티콘은 정사각 권장
  CLIENT_ID: '',                            // 구글 드라이브 동기화용 OAuth Client ID(웹). 비우면 동기화 비활성
  FOLDER_ID: '1H5b46InMhIs3zNWzyWYvIs3VL5VMb-PV',  // 저장 폴더 고정(URL/ID). 비우면 앱이 '모챙이 데이터' 폴더 자동 생성
  SCOPES: 'https://www.googleapis.com/auth/drive',  // 지정 폴더(직접 만든 폴더)에 쓰려면 전체 드라이브 범위 필요. 자동폴더만 쓰면 drive.file로 축소 가능
};
