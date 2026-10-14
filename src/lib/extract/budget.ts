/**
 * 토큰 예산 관리. 계획서 §5 Phase 3-2
 *
 * ★ 이 파일이 v2 계획에서 가장 크게 바뀐 지점이다.
 *
 * v2는 "컨텍스트 128K이므로 16K로 자른다"였다. 그러나 실측 프리필이
 * 131–161 tok/s라서 16K는 첫 토큰까지 약 2분을 의미한다. 사용 불가능하다.
 *
 * 실측 역산:
 *    700 tok →  5초
 *  1,400 tok → 10초
 *  2,800 tok → 20초  ← 채택 상한
 *  8,000 tok → 60초  ← 거부
 *
 * 그래서 본문 예산을 2,000토큰(≈4,000 한글자)으로 잡고, 초과분은 자른다.
 * map-reduce 요약은 5청크 × 20초 = 100초라 MVP에서 제외했다.
 * 단, GPU 이전 시 되살릴 수 있도록 예산은 설정값으로 노출한다.
 */

/**
 * 글자 종류별 토큰 비용. gemma4:e2b 토크나이저로 실측해 맞춘 값이다.
 *
 * ★ 예전에는 "한국어 2.0자/토큰, 영문 4.0자/토큰"을 한글 비중으로 보간했다.
 *   실제 뉴스 기사(2026-10-14, 네이버 뉴스 본문 추출본)에서 추정 1,420토큰이
 *   실측 3,616토큰이었다 — 2.5배 과소추정. 원인은 둘이다.
 *     ① 한글 산문이 1.41자/토큰이다(2.0이 아니다).
 *     ② 공백·줄바꿈·숫자·문장부호가 거의 한 글자에 한 토큰인데, 한글이 아니라는
 *        이유로 영문과 같은 4자/토큰을 매겼다. Readability 결과는 "\n \n \n" 같은
 *        빈 줄이 글자의 45%를 차지했다.
 *   과소추정된 본문은 num_ctx를 넘고, Ollama는 **오류 없이 본문 메시지를 통째로
 *   버린다**(시스템 프롬프트와 질문만 남아 202토큰). 모델은 "페이지 내용이 제공되지
 *   않았다"고 답하고, 사용자는 본문이 붙어 있는 화면을 보며 그 답을 읽는다.
 *
 * 실측(700자 표본 12개 + 영문·숫자·코드 표본, 오차 ±5%):
 *   한글 0.63, 숫자 1.07, 공백류 0.97, 기타 0.83, 라틴 문자 ≈0
 *   — 영단어는 앞 공백과 합쳐 한 토큰이 되므로 비용이 공백 쪽에 잡힌다.
 *   아래 값은 그보다 조금 보수적으로 올렸다. 모델을 바꾸면 다시 재야 한다.
 */
const TOKEN_COST = {
  hangul: 0.66,
  latin: 0.05,
  digit: 1.1,
  space: 1.0,
  /** 문장부호·기호 등 ASCII 나머지 */
  ascii: 0.85,
  /** 한자·가나·이모지 등. 바이트 단위로 쪼개지는 경우가 있어 높게 잡는다. */
  other: 1.2,
} as const;

/** 가장 싼 글자도 이보다 싸게 치지 않는다. 라틴 문자만 길게 이어진 URL·해시 대비. */
const MIN_TOKENS_PER_CHAR = 0.22;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cost = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)) cost += TOKEN_COST.hangul;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) cost += TOKEN_COST.latin;
    else if (c >= 0x30 && c <= 0x39) cost += TOKEN_COST.digit;
    else if (c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0) cost += TOKEN_COST.space;
    else if (c < 0x80) cost += TOKEN_COST.ascii;
    else cost += TOKEN_COST.other;
  }
  return Math.ceil(Math.max(cost, text.length * MIN_TOKENS_PER_CHAR));
}

/** 이 글의 평균 자·토큰 비율. 예산을 글자 수로 바꿀 때 쓴다. */
export function estimateCharsPerToken(text: string): number {
  if (!text) return 4.0;
  return text.length / Math.max(1, estimateTokens(text));
}

/**
 * 추출한 본문의 공백을 정리한다.
 *
 * ★ 공백류는 거의 한 글자에 한 토큰이다(위 TOKEN_COST). Readability 결과에는
 *   "\n \n \n", 탭 들여쓰기가 흔해 실측 기사에서 이것만 정리해도 3,524 → 2,287
 *   토큰(-35%)이 됐다. 모델이 볼 내용은 한 글자도 줄지 않는다.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface BudgetResult {
  text: string;
  truncated: boolean;
  /** 0~1. 원본 대비 남긴 비율. UI가 "앞부분 62%만 참조" 로 표시한다. */
  keptRatio: number;
  estimatedTokens: number;
}

/**
 * 본문을 예산 안으로 줄인다.
 *
 * 문장 중간에서 자르면 요약 품질이 눈에 띄게 나빠지므로 문단·문장 경계를
 * 찾아 자른다. 다만 경계가 너무 앞에 있으면(60% 미만) 버리는 양이 커지므로
 * 그때는 그냥 문자 단위로 자른다.
 */
export function fitToBudget(text: string, budgetTokens: number): BudgetResult {
  const clean = text.trim();
  if (!clean) {
    return { text: '', truncated: false, keptRatio: 1, estimatedTokens: 0 };
  }

  const total = estimateTokens(clean);
  if (total <= budgetTokens) {
    return { text: clean, truncated: false, keptRatio: 1, estimatedTokens: total };
  }

  // ★ 평균 비율로 한 번에 자르면 앞쪽이 촘촘한 글(메뉴·날짜가 몰린 기사 머리)에서
  //   예산을 넘긴다. 잘라 본 조각을 다시 재며 줄인다.
  let maxChars = Math.floor(budgetTokens * estimateCharsPerToken(clean));
  let finalText = '';
  for (let i = 0; i < 8; i++) {
    const cut = clean.slice(0, maxChars);
    const boundary = Math.max(
      cut.lastIndexOf('\n\n'),
      cut.lastIndexOf('다. '),
      cut.lastIndexOf('. '),
      cut.lastIndexOf('요. '),
    );
    finalText = (boundary > maxChars * 0.6 ? cut.slice(0, boundary + 1) : cut).trim();
    const cost = estimateTokens(finalText);
    if (cost <= budgetTokens || maxChars <= 1) break;
    maxChars = Math.max(1, Math.floor(maxChars * (budgetTokens / cost) * 0.98));
  }

  return {
    text: finalText,
    truncated: true,
    keptRatio: finalText.length / clean.length,
    estimatedTokens: estimateTokens(finalText),
  };
}

/**
 * 절단 사실을 사용자에게 알리는 문구.
 *
 * ★ 계획서 §6 완료 기준: "절단 발생 시 사용자에게 항상 고지".
 *   조용한 절단은 신뢰를 깬다 — 모델이 못 본 내용을 사용자는 봤다고 믿게 된다.
 */
export function truncationNotice(r: BudgetResult): string | null {
  if (!r.truncated) return null;
  return `본문이 길어 앞부분 ${Math.round(r.keptRatio * 100)}%만 참조했습니다.`;
}

/* ── 프롬프트 예산 — 조립기와 전송 게이트의 공용 자 ───── */

/**
 * ★ 아래 상수·함수는 **자르는 쪽과 거부하는 쪽이 같은 자를 쓰게** 하려고 있다.
 *
 *   예전에는 context.ts가 `length / 2.5`와 이미지 262토큰으로 재서 컨텍스트를
 *   조립하고, stream.ts가 estimateTokens(한국어 length/2.0)와 이미지 1024토큰으로
 *   다시 쟀다. 두 자가 다르니 조립기가 "예산 안"이라고 판단한 컨텍스트를 전송
 *   게이트가 HTTP 전에 되돌려 보냈다. 기본 설정(numCtx 4,096)에서 본문+캡처
 *   조합은 예외 없이 거부됐다 — 한도 2,867토큰에 게이트 추정 3,191토큰.
 *
 *   그래서 두 쪽 모두 반드시 이 함수들을 통과해야 한다. 한쪽만 고치면 같은
 *   버그가 반대 방향(조용한 컨텍스트 초과)으로 되살아난다.
 */

/**
 * 프롬프트가 num_ctx를 다 먹으면 답할 자리가 없다.
 * 생성 여유를 남기기 위해 컨텍스트의 70%만 프롬프트에 쓴다.
 */
export const PROMPT_BUDGET_RATIO = 0.7;

/**
 * 이미지 한 장의 프롬프트 비용.
 *
 * ★ 실측(2026-08-19, gemma4:e2b): 해상도와 거의 무관하게 약 260토큰이다
 *   (1180x800 +262, 1536x864 +266). Gemma가 고정 타일 예산으로 정규화한다.
 *
 * ★ 이전 게이트가 쓰던 1,024는 근거 없는 보수치였고, 기본 컨텍스트에서
 *   캡처 기능 자체를 불가능하게 만들었다. 추정이 빗나가도 Ollama는 앞쪽을
 *   버릴 뿐 실패하지 않지만, 과대추정은 기능을 통째로 막는다. 모델을 바꿔
 *   타일 예산이 크게 다르면 이 상수를 다시 재야 한다.
 */
export const IMAGE_TOKEN_COST = 262;

/** 역할·구분자 등 메시지 한 건의 고정 부대비용. */
export const MESSAGE_OVERHEAD_TOKENS = 8;

/** 이 컨텍스트에서 프롬프트에 쓸 수 있는 토큰 수. */
export function promptBudget(numCtx: number): number {
  return Math.floor(numCtx * PROMPT_BUDGET_RATIO);
}

/** 비용 계산에 필요한 최소 형태. ChatMessage가 구조적으로 이를 만족한다. */
export interface CostedMessage {
  content: string;
  images?: string[];
  tool_calls?: unknown;
}

/** 메시지 한 건의 추정 프롬프트 비용. */
export function messageTokens(m: CostedMessage): number {
  return (
    estimateTokens(m.content) +
    (m.images?.length ?? 0) * IMAGE_TOKEN_COST +
    (m.tool_calls ? estimateTokens(JSON.stringify(m.tool_calls)) : 0) +
    MESSAGE_OVERHEAD_TOKENS
  );
}

/** 요청 하나의 추정 프롬프트 비용. 도구 스키마도 매 턴 프리필에 들어간다. */
export function promptTokens(messages: readonly CostedMessage[], tools?: unknown): number {
  const body = messages.reduce((sum, m) => sum + messageTokens(m), 0);
  return body + (tools ? estimateTokens(JSON.stringify(tools)) : 0);
}
