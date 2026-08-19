/**
 * 프롬프트 프리셋. 계획서 §5 Phase 3-4 / 3-6
 *
 * 페이지 액션과 선택 텍스트 액션(컨텍스트 메뉴)을 한 곳에서 정의한다.
 * background.ts의 메뉴 id와 여기 id가 일치해야 한다.
 */

export interface Preset {
  id: string;
  /** 버튼·메뉴에 표시할 이름 */
  label: string;
  /** 슬래시 커맨드 (Phase 4에서 자동완성에 쓴다) */
  slash?: string;
  /** 페이지 본문이 필요한가 */
  needsPage: boolean;
  /** 사용자 메시지로 보낼 문구를 만든다 */
  build: (selection?: string) => string;
}

/* ── 페이지 액션 ───────────────────────────────────────── */

export const PAGE_PRESETS: Preset[] = [
  {
    id: 'summary',
    label: '이 페이지 요약',
    slash: '/summary',
    needsPage: true,
    build: () =>
      '이 페이지의 내용을 요약해줘. 무엇에 대한 글인지 먼저 한 줄로 말하고, 그다음 주요 내용을 정리해줘.',
  },
  {
    id: 'three-lines',
    label: '핵심 3줄',
    slash: '/three',
    needsPage: true,
    build: () => '이 페이지의 핵심을 정확히 3줄로 정리해줘. 각 줄은 한 문장으로.',
  },
  {
    id: 'ask',
    label: '이 페이지에 대해 질문',
    needsPage: true,
    // 질문은 사용자가 직접 입력한다. 페이지만 붙여 두는 프리셋.
    build: () => '',
  },
];

/* ── 선택 텍스트 액션 (컨텍스트 메뉴) ──────────────────── */

/**
 * ★ 선택 텍스트는 페이지 본문이 아니라 사용자가 직접 고른 조각이다.
 *   그래도 출처는 웹페이지이므로 <page_content>로 감싸 데이터임을 명시한다.
 *   여기에 인젝션이 들어 있을 수 있다는 전제는 동일하다.
 */
function wrapSelection(text: string): string {
  return `<page_content>\n${text}\n</page_content>`;
}

export const SELECTION_PRESETS: Preset[] = [
  {
    id: 'translate',
    label: '번역',
    slash: '/translate',
    needsPage: false,
    build: (s = '') =>
      `다음 텍스트를 한국어로 자연스럽게 번역해줘. 이미 한국어면 영어로 번역해줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'explain',
    label: '쉽게 설명',
    slash: '/explain',
    needsPage: false,
    build: (s = '') =>
      `다음 텍스트를 처음 접하는 사람도 이해할 수 있게 쉽게 설명해줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'polish',
    label: '문장 다듬기',
    slash: '/polish',
    needsPage: false,
    build: (s = '') =>
      `다음 문장을 뜻은 그대로 두고 더 자연스럽게 다듬어줘. 다듬은 결과만 보여줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'send',
    label: '사이드패널로 보내기',
    needsPage: false,
    // 사용자가 무엇을 물을지 정한다. 입력창에 넣어만 준다.
    build: (s = '') => wrapSelection(s),
  },
];

export const ALL_PRESETS = [...PAGE_PRESETS, ...SELECTION_PRESETS];

export function findPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id);
}
