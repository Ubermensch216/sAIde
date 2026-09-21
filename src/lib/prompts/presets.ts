/**
 * 프롬프트 프리셋. 계획서 §5 Phase 3-4 / 3-6 / 4-3 / 4-4
 *
 * 페이지 액션, 선택 텍스트 액션(컨텍스트 메뉴), 슬래시 커맨드를 한 곳에서
 * 정의한다. background.ts의 메뉴 id와 여기 id가 일치해야 한다.
 */

/** 프리셋이 요구하는 첨부물 */
export type PresetNeeds = 'none' | 'page' | 'screen' | 'selection';

export interface Preset {
  id: string;
  /** 버튼·메뉴에 표시할 이름 */
  label: string;
  /** 슬래시 커맨드 (앞의 / 포함) */
  slash?: string;
  /** 같은 뜻으로 통하는 다른 이름들. 자동완성에서 함께 매치된다. */
  aliases?: string[];
  /** 자동완성 목록에 보여줄 한 줄 설명 */
  hint?: string;
  needs: PresetNeeds;
  /**
   * 슬래시 뒤에 남은 텍스트를 build()의 **인자로** 넘길지.
   *
   * 페이지형은 기본적으로 남은 텍스트를 프롬프트 뒤에 덧붙인다("/summary 표로").
   * 그런데 번역은 그 텍스트가 추가 지시가 아니라 **대상 언어**다. 덧붙이면
   * "…번역해줘\n\n영어"가 되어 모델이 언어를 지시로 읽지 못한다.
   */
  takesArg?: boolean;
  /** 사용자 메시지로 보낼 문구를 만든다 */
  build: (selection?: string) => string;
}

/* ── 번역 대상 언어 ────────────────────────────────────── */

/**
 * 사용자가 쓰는 이름을 프롬프트에 넣을 한 가지 표기로 모은다.
 *
 * ★ 목록에 없는 언어도 막지 않는다. 모델이 아는 언어는 우리 표보다 훨씬
 *   많으므로, 모르는 이름은 다듬기만 해서 그대로 넘긴다. 여기서 거부하면
 *   "지원하지 않는 언어"라는 없는 제약을 우리가 만들어내는 셈이다.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  en: '영어', eng: '영어', english: '영어', 영어: '영어',
  ko: '한국어', kr: '한국어', korean: '한국어', 한국어: '한국어', 한글: '한국어', 국어: '한국어',
  ja: '일본어', jp: '일본어', japanese: '일본어', 일본어: '일본어', 일어: '일본어',
  zh: '중국어', cn: '중국어', chinese: '중국어', 중국어: '중국어', 중어: '중국어',
  es: '스페인어', spanish: '스페인어', 스페인어: '스페인어',
  fr: '프랑스어', french: '프랑스어', 프랑스어: '프랑스어',
  de: '독일어', german: '독일어', 독일어: '독일어',
  ru: '러시아어', russian: '러시아어', 러시아어: '러시아어',
  vi: '베트남어', vietnamese: '베트남어', 베트남어: '베트남어',
};

/**
 * 슬래시 뒤에 남은 텍스트에서 대상 언어를 뽑는다.
 *
 * ★ 사용자는 슬래시 문법을 외우지 않는다. "/translate 영어"만 받게 만들면
 *   "/translate 영어로", "/translate 영어로 번역해줘"가 전부 빗나간다.
 *   조사와 "번역" 꼬리를 떼고 본다.
 */
export function resolveLanguage(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;

  t = t.replace(/번역(해\s*줘|해\s*주세요|해|하기|해줘)?/g, '').trim();
  t = t.replace(/(으로|로|into|to)$/i, '').trim();
  if (!t) return null;

  const hit = LANGUAGE_ALIASES[t.toLowerCase()];
  if (hit) return hit;

  // 표에 없는 이름. 언어 이름치고 지나치게 길면 언어가 아니라고 본다.
  return t.length <= 20 ? t : null;
}

/** 언어를 지정하지 않았을 때. 예전 선택 텍스트 번역과 같은 왕복 규칙을 쓴다. */
const TRANSLATE_FALLBACK = '한국어로 번역해줘. 본문이 이미 한국어라면 영어로 번역해줘.';

/**
 * 페이지 번역 프롬프트.
 *
 * ★ 본문을 여기에 다시 넣지 않는다. 본문은 이미 컨텍스트 앞쪽 고정 블록의
 *   <page_content>에 있고, 그 블록은 대화 내내 바이트 단위로 같아서 KV 캐시가
 *   재사용된다(실측 7,684ms → 183ms). 여기서 본문을 한 번 더 실으면 그 이득을
 *   버리는 데다 2,000토큰을 두 번 프리필한다.
 */
export function buildPageTranslation(lang?: string): string {
  const target = resolveLanguage(lang ?? '');
  return [
    `위 <page_content>의 내용을 ${target ? `${target}로 번역해줘.` : TRANSLATE_FALLBACK}`,
    '제목부터 시작해 본문 순서대로 옮기고, 문단 구분은 원문 그대로 유지한다.',
    '번역문만 출력한다. 원문을 다시 적거나 요약·설명·감상을 덧붙이지 않는다.',
    '고유명사·인명·수치는 임의로 바꾸지 않는다. 원문에 없는 내용을 채워 넣지 않는다.',
  ].join('\n');
}

/* ── 페이지 액션 ───────────────────────────────────────── */

export const PAGE_PRESETS: Preset[] = [
  {
    id: 'summary',
    label: '이 페이지 요약',
    slash: '/summary',
    hint: '페이지 본문을 읽고 요약합니다',
    needs: 'page',
    build: () =>
      '이 페이지의 내용을 요약해줘. 무엇에 대한 글인지 먼저 한 줄로 말하고, 그다음 주요 내용을 정리해줘.',
  },
  {
    id: 'three-lines',
    label: '핵심 3줄',
    slash: '/three',
    aliases: ['/3'],
    hint: '핵심만 세 문장으로',
    needs: 'page',
    build: () => '이 페이지의 핵심을 정확히 3줄로 정리해줘. 각 줄은 한 문장으로.',
  },
  {
    /**
     * ★ 번역은 출력이 입력만큼 길다. numCtx 4096에 본문 2,000토큰을 넣으면
     *   남는 출력 공간이 2,000토큰 안팎이라 긴 기사는 뒤가 잘릴 수 있다.
     *   pageTokenBudget을 줄이거나 numCtx를 올리는 게 해법이고, 그건 설정이다.
     */
    id: 'translate-page',
    label: '이 페이지 번역',
    slash: '/translate',
    aliases: ['/번역', '/tr'],
    hint: '/translate 영어 처럼 언어를 지정합니다',
    needs: 'page',
    takesArg: true,
    build: (lang) => buildPageTranslation(lang),
  },
  {
    /**
     * 핵심·조치사항 카드.
     *
     * ★ 이 명령만 프리셋 문구를 쓰지 않는다. JSON 스키마로 구속해 받고, 코드가 원문과
     *   대조해 배지를 붙인 뒤에야 화면에 나온다(lib/ai/action-card.ts). build는
     *   프리셋 표를 채우기 위한 자리일 뿐이며 App이 별도 경로로 실행한다.
     */
    id: 'actions',
    label: '할 일·기한 뽑기',
    slash: '/actions',
    aliases: ['/조치', '/todo'],
    hint: '문서에서 할 일·기한·제출물을 뽑고 원문과 대조합니다',
    needs: 'page',
    build: () => '',
  },
  {
    id: 'ask',
    label: '이 페이지에 대해 질문',
    hint: '페이지를 붙여 두고 이어서 물어봅니다',
    needs: 'page',
    // 질문은 사용자가 직접 입력한다. 페이지만 붙여 두는 프리셋.
    build: () => '',
  },
  {
    /**
     * 화면 캡처는 본문 추출이 실패하는 페이지에서 쓴다.
     * 실측 262토큰 / 4.5초로 본문(2,000토큰)보다 8배 싸다 — 계획서 §0.8.
     */
    id: 'screen',
    label: '화면 보고 설명',
    slash: '/screenshot',
    // 사용자가 어느 쪽을 칠지 알 수 없다. 둘 다 받는다.
    aliases: ['/screen', '/capture', '/shot'],
    hint: '차트·대시보드처럼 글로 안 읽히는 화면에',
    needs: 'screen',
    build: () =>
      '이 화면에 무엇이 보이는지 설명해줘. 그림이나 차트가 있으면 무엇을 나타내는지도 알려줘.',
  },
];

/* ── 선택 텍스트 액션 (컨텍스트 메뉴 + 슬래시) ─────────── */

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
    /**
     * ★ 슬래시가 없다. `/translate`는 페이지 번역이 가져갔다.
     *   선택 텍스트 번역의 진입점은 우클릭 메뉴(background.ts의 saide.translate)이고,
     *   거기서는 id로 찾으므로 슬래시가 필요 없다. 한 이름이 첨부 대상이 다른 두
     *   동작을 가리키면, 사용자는 무엇이 번역될지 칠 때마다 추측해야 한다.
     */
    id: 'translate',
    label: '번역',
    hint: '선택한 텍스트를 한↔영으로',
    needs: 'selection',
    build: (s = '') =>
      `다음 텍스트를 한국어로 자연스럽게 번역해줘. 이미 한국어면 영어로 번역해줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'explain',
    label: '쉽게 설명',
    slash: '/explain',
    hint: '처음 보는 사람도 알아듣게',
    needs: 'selection',
    build: (s = '') =>
      `다음 텍스트를 처음 접하는 사람도 이해할 수 있게 쉽게 설명해줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'polish',
    label: '문장 다듬기',
    slash: '/polish',
    hint: '뜻은 그대로, 더 자연스럽게',
    needs: 'selection',
    build: (s = '') =>
      `다음 문장을 뜻은 그대로 두고 더 자연스럽게 다듬어줘. 다듬은 결과만 보여줘.\n\n${wrapSelection(s)}`,
  },
];

/**
 * 우클릭 메뉴의 "선택 영역으로 묻기".
 *
 * ★ 프리셋이 아니다. 프롬프트를 만들지 않고 고른 부분을 **첨부로** 붙이기만 한다.
 *   전에 있던 'send'는 <page_content> 태그째로 입력창을 채워, 정작 질문을 쓸
 *   자리를 원문이 덮었다. 무엇을 물을지는 빈 입력창에 사용자가 쓴다.
 *
 * ★ 'ask'가 아니다 — 그 id는 페이지 프리셋("이 페이지에 대해 질문")이 이미 쓴다.
 *   같은 id를 나눠 쓰면 우클릭 메뉴가 어느 쪽을 부르는지 읽는 사람마다 달라진다.
 */
export const ASK_SELECTION_ID = 'ask-selection';

export const ALL_PRESETS = [...PAGE_PRESETS, ...SELECTION_PRESETS];

export function findPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id);
}

/* ── 슬래시 커맨드 (Phase 4-3) ─────────────────────────── */

/**
 * 명령의 접두 문자. **결과가 남는 곳**을 가른다.
 *
 * - `/` 답이 AI 창 안에서 끝난다.
 * - `@` 결과가 다른 탭에 남는다. 화면은 저절로 옮겨 가지 않고, 답변 안의 링크를 눌러야 간다.
 */
export type CommandPrefix = '/' | '@';

/** `@` 명령이 결과를 남기는 탭. */
export type PanelTab = 'schedule';

export interface SlashCommand {
  /**
   * 접두 문자.
   *
   * ★ 이름(`slash`, `aliases`)은 접두 문자를 **포함한** 전체 문자열이다. 입력창은 실제로
   *   친 이름의 길이만큼 잘라 인자를 뽑으므로, 이름에서 접두 문자를 떼면 인자가 어긋난다.
   */
  prefix: CommandPrefix;
  slash: string;
  label: string;
  hint: string;
  presetId: string;
  needs: PresetNeeds;
  /** `@` 명령이 끝나고 넘어갈 탭. 자동완성의 뱃지도 이 값으로 그린다. */
  opensTab?: PanelTab;
  /** 자동완성에서 함께 매치될 다른 이름들 */
  aliases?: string[];
  /** 사용자 정의 프리셋인가 */
  custom?: boolean;
}

/** 사용자가 만든 프리셋. chrome.storage.local에 저장된다. */
export interface CustomPreset {
  id: string;
  label: string;
  /** 앞의 / 없이 저장한다 */
  slash: string;
  /** 본문. {{selection}} 자리에 입력창에 남은 텍스트가 들어간다. */
  template: string;
  needs: PresetNeeds;
}

export function builtinCommands(): SlashCommand[] {
  return ALL_PRESETS.filter((p) => p.slash).map((p) => ({
    // 내장 프리셋의 답은 모두 AI 창 안에서 끝난다.
    prefix: '/' as const,
    slash: p.slash!,
    label: p.label,
    hint: p.hint ?? '',
    presetId: p.id,
    needs: p.needs,
    aliases: p.aliases,
  }));
}

/** 이 커맨드가 반응하는 모든 이름 */
export function namesOf(c: SlashCommand): string[] {
  return [c.slash, ...(c.aliases ?? [])];
}

export function customCommands(customs: CustomPreset[]): SlashCommand[] {
  return customs.map((c) => ({
    // 사용자 프리셋의 결과도 AI 창에 나타난다. 그래서 언제나 `/` 그룹이다.
    prefix: '/' as const,
    slash: `/${c.slash}`,
    label: c.label,
    hint: '내 프리셋',
    presetId: c.id,
    needs: c.needs,
    custom: true,
  }));
}

/** 이 글자로 명령이 시작될 수 있는가. */
export function isCommandPrefix(ch: string): ch is CommandPrefix {
  return ch === '/' || ch === '@';
}

/**
 * 입력창 내용에서 명령 후보를 찾는다.
 *
 * 첫 글자가 `/` 또는 `@`이고 아직 공백이 없을 때만 자동완성을 띄운다.
 * 본문 중간의 `/`(URL, 날짜 등)나 `@`(전자우편 주소)를 건드리면 방해만 된다.
 *
 * ★ 친 접두 문자와 같은 그룹만 보여 준다. 두 그룹을 섞어 보이면 접두 문자로 결과가
 *   어디에 나타나는지 알린다는 구분 자체가 무의미해진다.
 *
 * ★ 다만 같은 그룹에 맞는 것이 하나도 없으면 반대 그룹에서 찾아 보여 준다. 명령이
 *   그룹을 옮겼을 때 예전 이름을 친 사람에게 빈 목록 대신 새 이름을 보여 주는 길이다.
 *   골라 넣으면 입력이 새 이름으로 바뀌므로 한 번에 옮겨 배운다.
 */
export function matchSlash(
  input: string,
  commands: SlashCommand[],
): SlashCommand[] {
  const head = input.slice(0, 1);
  if (!isCommandPrefix(head)) return [];
  const token = input.slice(1);
  if (/\s/.test(token)) return [];
  const q = token.toLowerCase();
  const hits = commands.filter((c) =>
    namesOf(c).some((n) => n.slice(1).toLowerCase().startsWith(q)),
  );
  const sameGroup = hits.filter((c) => c.prefix === head);
  return sameGroup.length ? sameGroup : hits;
}

/**
 * 다 쓰고 Enter를 친 한 줄에서 실행할 명령과 인자를 가려낸다.
 *
 * ★ 접두 문자가 어긋나도 이름이 맞으면 찾아 준다. 명령이 그룹을 옮겼는데 예전 이름을
 *   친 사람의 입력이 그대로 모델에게 보내지면, 명령이 사라진 것처럼 보이고 토큰까지 쓴다.
 *   접두 문자가 맞는 명령을 먼저 보고, 없을 때만 이름으로 찾는다.
 */
export function resolveTyped(
  input: string,
  commands: SlashCommand[],
): { cmd: SlashCommand; rest: string } | null {
  const text = input.trim();
  const head = text.slice(0, 1);
  if (!isCommandPrefix(head)) return null;
  const body = text.slice(1).toLowerCase();

  /** 이 명령의 이름 중 하나로 시작하는가. 맞으면 접두 문자를 뺀 이름 길이. */
  const nameLength = (c: SlashCommand): number => {
    for (const full of namesOf(c)) {
      const name = full.slice(1).toLowerCase();
      if (body === name || body.startsWith(`${name} `)) return name.length;
    }
    return -1;
  };

  for (const group of [commands.filter((c) => c.prefix === head), commands]) {
    for (const c of group) {
      const len = nameLength(c);
      if (len >= 0) return { cmd: c, rest: text.slice(1 + len).trim() };
    }
  }
  return null;
}

/** 슬래시 커맨드를 실제 프롬프트로 바꾼다. */
export function expandCommand(
  cmd: SlashCommand,
  rest: string,
  customs: CustomPreset[],
): string {
  if (cmd.custom) {
    const c = customs.find((x) => x.id === cmd.presetId);
    if (!c) return rest;
    return c.template.includes('{{selection}}')
      ? c.template.replace(/\{\{selection\}\}/g, rest)
      : rest
        ? `${c.template}\n\n${wrapSelection(rest)}`
        : c.template;
  }

  const preset = findPreset(cmd.presetId);
  if (!preset) return rest;

  // 선택 텍스트형은 뒤에 붙은 내용을 대상으로 삼는다.
  if (preset.needs === 'selection') return preset.build(rest);

  // 인자를 받는 페이지형(번역의 대상 언어)은 뒤에 덧붙이지 않고 넘겨준다.
  if (preset.takesArg) return preset.build(rest);

  const base = preset.build();
  return rest ? `${base}\n\n${rest}` : base;
}
