/**
 * 계약 ② — Side Panel ↔ Service Worker ↔ Content Script 3자 통신 규약.
 * 계획서 §4.2
 *
 * 이 파일이 없으면 Phase 3·5에서 반드시 꼬인다. 코드보다 먼저 고정한다.
 *
 * 방향 규칙:
 *   Panel  → SW      : PanelToSW  (sendMessage, 응답을 await)
 *   SW     → Panel   : SWToPanel  (요청의 반환값 또는 push)
 *   SW     → Content : SWToContent (tabs.sendMessage)
 */

/* ── 오류 분류 ─────────────────────────────────────────── */

export type ErrorCode =
  /** Ollama 프로세스가 없음. fetch가 TypeError로 즉시 실패. */
  | 'OLLAMA_DOWN'
  /** 서버는 살아 있으나 요청한 모델이 /api/tags에 없음. */
  | 'MODEL_MISSING'
  /** ★ 서버는 응답하나 chrome-extension:// origin이 거부됨. OLLAMA_ORIGINS 미설정. */
  | 'CORS_BLOCKED'
  /** 메모리 부족. 16GB에 6.9GB 상주 + 임베딩 1.2GB 동시 로드 시 발생 가능. */
  | 'OOM'
  | 'TIMEOUT'
  /** 사용자가 중단(AbortController). 오류가 아니라 정상 흐름. */
  | 'ABORTED'
  /** chrome://, 웹스토어 등 content script 주입이 금지된 페이지. */
  | 'TAB_RESTRICTED'
  /** 승인 카드에서 사용자가 거부. */
  | 'ACTION_DENIED'
  | 'UNKNOWN';

export interface AppError {
  code: ErrorCode;
  message: string;
  /** 사용자에게 보여줄 해결 방법. 없으면 UI가 기본 문구를 쓴다. */
  hint?: string;
}

/* ── 페이지 추출 결과 ──────────────────────────────────── */

export type ExtractMethod = 'readability' | 'innerText' | 'youtube-caption';

export interface ExtractedPage {
  url: string;
  title: string;
  /** ★ 이미 토큰 예산 내로 절단된 상태로 전달된다. 수신 측에서 다시 자르지 않는다. */
  text: string;
  /** 절단 전 원본 길이 (자) */
  charCount: number;
  /** true면 UI가 절단 고지 칩을 반드시 표시한다. 계획서 §6 완료 기준. */
  truncated: boolean;
  /** 0~1. 원본 대비 실제로 모델에 넣은 비율. */
  keptRatio: number;
  /** 추정 토큰 수 — 대기시간 예측에 쓴다. */
  estimatedTokens: number;
  method: ExtractMethod;
  extractedAt: number;
}

/* ── 페이지 액션 (Phase 5 에이전트) ─────────────────────── */

export type PageAction =
  | { kind: 'read_page' }
  | { kind: 'find_element'; query: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number }
  | { kind: 'click'; selector: string }
  | { kind: 'type_text'; selector: string; text: string }
  | { kind: 'navigate'; url: string };

/** 부작용이 있어 사용자 승인이 반드시 필요한 액션. 예외를 만들지 않는다. */
export const SIDE_EFFECT_ACTIONS = ['click', 'type_text', 'navigate'] as const;

export function requiresApproval(action: PageAction): boolean {
  return (SIDE_EFFECT_ACTIONS as readonly string[]).includes(action.kind);
}

/** 승인 카드가 사용자에게 보여줄 내용. 모델이 아니라 우리가 만든다. */
export interface ApprovalRequest {
  action: PageAction;
  /** 사람이 읽는 설명. 예: "'제출' 버튼을 클릭합니다" */
  humanDescription: string;
  /** 대상 요소의 표시 텍스트 또는 aria-label */
  targetLabel?: string;
  pageUrl: string;
  pageTitle: string;
}

/* ── Panel → Service Worker ────────────────────────────── */

export type PanelToSW =
  | { type: 'EXTRACT_PAGE'; tabId: number; budgetTokens: number }
  | { type: 'CAPTURE_SCREENSHOT'; tabId: number }
  | { type: 'EXEC_ACTION'; tabId: number; action: PageAction }
  | { type: 'LIST_TABS' }
  | { type: 'GET_ACTIVE_TAB' };

/* ── Service Worker → Panel ────────────────────────────── */

export interface TabSummary {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

export type SWToPanel =
  | { type: 'PAGE_EXTRACTED'; payload: ExtractedPage }
  | { type: 'SCREENSHOT'; dataUrl: string }
  | { type: 'ACTION_RESULT'; ok: boolean; detail: string }
  | { type: 'TABS'; tabs: TabSummary[] }
  | { type: 'ACTIVE_TAB'; tab: TabSummary | null }
  | { type: 'TAB_CHANGED'; tab: TabSummary }
  | { type: 'CONTEXT_MENU'; preset: string; selectionText: string; tab: TabSummary }
  | { type: 'ERROR'; error: AppError };

/* ── Service Worker → Content Script ───────────────────── */

export type SWToContent =
  | { type: 'EXTRACT'; budgetTokens: number }
  | { type: 'ACT'; action: PageAction };

export type ContentToSW =
  | { type: 'EXTRACTED'; payload: ExtractedPage }
  | { type: 'ACTED'; ok: boolean; detail: string }
  | { type: 'FAILED'; error: AppError };

/* ── 타입 안전한 sendMessage 헬퍼 ──────────────────────── */

export async function sendToSW(msg: PanelToSW): Promise<SWToPanel> {
  return chrome.runtime.sendMessage(msg) as Promise<SWToPanel>;
}

export async function sendToContent(
  tabId: number,
  msg: SWToContent,
): Promise<ContentToSW> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<ContentToSW>;
}

/** content script를 주입할 수 없는 URL인지 판정. 시도 전에 거른다. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:') ||
    url.startsWith('https://chromewebstore.google.com') ||
    url.startsWith('https://chrome.google.com/webstore')
  );
}
