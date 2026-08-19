/**
 * 채팅 상태. 계획서 §5 Phase 2–3
 *
 * Zustand를 쓰는 이유: 21 tok/s로 토큰이 들어올 때마다 상태가 갱신되는데,
 * Context는 구독자 전체를 리렌더시킨다. 셀렉터로 구독 범위를 좁힐 수 있어야 한다.
 *
 * ★ 이 스토어는 Side Panel 문서에서만 산다. Service Worker가 아니다.
 *   (MV3 워커는 30초 유휴에 죽으므로 장시간 스트리밍을 맡길 수 없다.)
 */

import { create } from 'zustand';
import type { ChatMessage, PerfSample } from '@/types/ollama';
import { streamChat } from '@/lib/ollama/stream';
import { OllamaError } from '@/lib/ollama/errors';
import {
  addMessage,
  createConversation,
  db,
  deleteMessagesFrom,
  findForTab,
  listMessages,
  titleFrom,
  type Conversation,
  type StoredMessage,
} from '@/lib/storage/db';
import { buildContext, uncachedPrefillSeconds, type AttachedPage } from '@/lib/chat/context';
import { sendToSW } from '@/lib/messaging/protocol';
import type { AppError, ExtractedPage } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';

/** 화면에 그리는 메시지. 저장 레코드에 스트리밍 중 상태가 얹힌다. */
export interface UiMessage extends Omit<StoredMessage, 'id'> {
  id: number | 'streaming';
  streaming?: boolean;
}

interface ChatState {
  conversation: Conversation | null;
  /**
   * 아직 저장되지 않은 대화의 소속 정보.
   * 사이드패널은 탭마다 열리므로, 실제로 말이 오가기 전에는 레코드를 만들지
   * 않는다. 첫 메시지를 보낼 때 이 정보로 대화를 생성한다.
   */
  pending: { tabId: number; url: string } | null;
  messages: UiMessage[];

  /** 이 대화에 붙어 있는 페이지. 대화 내내 동일하게 유지된다(KV 캐시). */
  page: ExtractedPage | null;
  /** 페이지 추출 진행 중 */
  extracting: boolean;

  streaming: boolean;
  startedAt: number | null;
  /** 이번 요청에서 실제로 프리필해야 할 예상 초 — 캐시 적중분은 뺀 값 */
  expectedPrefillSec: number;

  error: string | null;
  abort: AbortController | null;
  /** 직전 요청의 컨텍스트. 접두사 캐시 적중분을 계산하는 데 쓴다. */
  lastContext: ChatMessage[] | null;

  openForTab: (tabId: number, url: string) => Promise<void>;
  attachPage: (tabId: number, settings: Settings) => Promise<ExtractedPage | null>;
  detachPage: () => void;
  send: (text: string, settings: Settings) => Promise<void>;
  regenerate: (settings: Settings) => Promise<void>;
  stop: () => void;
  setError: (e: string | null) => void;
  clearError: () => void;
}

export const useChat = create<ChatState>((set, get) => ({
  conversation: null,
  pending: null,
  messages: [],
  page: null,
  extracting: false,
  streaming: false,
  startedAt: null,
  expectedPrefillSec: 0,
  error: null,
  abort: null,
  lastContext: null,

  /** 탭별 세션 분리 (Phase 2-5). 탭이 바뀌면 그 탭의 대화로 갈아끼운다. */
  async openForTab(tabId, url) {
    // 스트리밍 중 탭이 바뀌면 진행 중인 생성을 끊는다. 다른 대화에 토큰이
    // 섞여 들어가는 것이 훨씬 나쁘다.
    get().stop();

    // ★ 여기서 대화를 만들지 않는다. 사이드패널은 탭이 열릴 때마다 함께
    //   열리므로, 열자마자 레코드를 만들면 빈 대화방이 탭 수만큼 쌓인다.
    //   실제 생성은 첫 메시지를 보낼 때(ensureConversation) 한다.
    const conversation = await findForTab(tabId, url);
    const stored = conversation ? await listMessages(conversation.id) : [];

    // 페이지는 대화를 갈아끼울 때 떼어낸다. 다른 탭의 본문을 물고 가면
    // 모델이 엉뚱한 페이지를 근거로 답하게 된다.
    set({
      conversation,
      pending: conversation ? null : { tabId, url },
      messages: stored,
      page: null,
      error: null,
      lastContext: null,
    });
  },

  /**
   * 현재 탭 본문을 추출해 대화에 붙인다.
   *
   * ★ 이미 같은 URL이 붙어 있으면 재추출하지 않는다(계획서 Phase 3-5).
   *   재추출은 낭비일 뿐 아니라, 본문이 1바이트라도 달라지면 접두사가 바뀌어
   *   KV 캐시가 통째로 무효화된다(프리필 183ms → 7,684ms).
   */
  async attachPage(tabId, settings) {
    const current = get().page;
    if (get().extracting) return current;

    set({ extracting: true, error: null });
    try {
      const res = await sendToSW({
        type: 'EXTRACT_PAGE',
        tabId,
        budgetTokens: settings.pageTokenBudget,
      });

      if (res.type === 'ERROR') {
        set({ error: describeError(res.error) });
        return null;
      }
      if (res.type !== 'PAGE_EXTRACTED') return null;

      const page = res.payload;
      // 같은 URL이면 기존 것을 유지해 접두사를 보존한다.
      if (current && current.url === page.url) return current;

      set({ page, lastContext: null });
      return page;
    } finally {
      set({ extracting: false });
    }
  },

  detachPage: () => set({ page: null, lastContext: null }),

  async send(text, settings) {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    // 대화는 여기서 처음 저장된다 — 제목까지 한 번에 정해 갱신 쿼리를 아낀다.
    const conv = await ensureConversation(set, get, trimmed);
    if (!conv) return;

    const userMsg: Omit<StoredMessage, 'id'> = {
      conversationId: conv.id,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    const userId = await addMessage(userMsg);

    set((s) => ({ messages: [...s.messages, { ...userMsg, id: userId }] }));
    await runGeneration(set, get, settings);
  },

  /** 재생성: 마지막 assistant 응답을 걷어내고 같은 입력으로 다시 돌린다. */
  async regenerate(settings) {
    if (get().streaming) return;
    const conv = get().conversation;
    if (!conv) return;

    const msgs = get().messages;
    const lastAssistantIdx = findLastIndex(msgs, (m) => m.role === 'assistant');
    if (lastAssistantIdx < 0) return;

    const target = msgs[lastAssistantIdx]!;
    await deleteMessagesFrom(conv.id, target.createdAt);
    set({ messages: msgs.slice(0, lastAssistantIdx) });

    await runGeneration(set, get, settings);
  },

  stop() {
    const { abort } = get();
    if (!abort) return;
    abort.abort();
    set({ abort: null, streaming: false, startedAt: null });
  },

  setError: (e) => set({ error: e }),
  clearError: () => set({ error: null }),
}));

/* ── 생성 루프 ─────────────────────────────────────────── */

type Set = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;
type Get = () => ChatState;

/**
 * 대화 레코드를 확보한다. 아직 없으면 지금 만든다.
 *
 * ★ 대화가 DB에 생기는 지점은 여기 한 곳뿐이다.
 *   패널이 열릴 때가 아니라 **첫 메시지를 보낼 때** 만들어야 빈 대화방이
 *   쌓이지 않는다. 제목도 이때 함께 정해 별도 갱신 쿼리를 아낀다.
 */
async function ensureConversation(
  set: Set,
  get: Get,
  firstMessage: string,
): Promise<Conversation | null> {
  const existing = get().conversation;
  if (existing) return existing;

  const p = get().pending;
  if (!p) return null;

  const id = await createConversation(p.tabId, p.url, titleFrom(firstMessage));
  const conv = await db.conversations.get(id);
  if (!conv) return null;

  set({ conversation: conv, pending: null });
  return conv;
}

function toAttached(page: ExtractedPage | null): AttachedPage | null {
  if (!page) return null;
  return {
    url: page.url,
    title: page.title,
    text: page.text,
    truncated: page.truncated,
    keptRatio: page.keptRatio,
  };
}

async function runGeneration(set: Set, get: Get, settings: Settings) {
  const conv = get().conversation;
  if (!conv) return;

  const abort = new AbortController();
  const startedAt = Date.now();
  const page = get().page;

  const context = buildContext(get().messages, settings.numCtx, toAttached(page));
  // 캐시 적중분을 뺀 예상 대기시간. 페이지를 붙인 후속 질문은 이 값이 거의 0이다.
  const expectedPrefillSec = uncachedPrefillSeconds(get().lastContext, context);

  // 스트리밍 중 자리표시자. 실제 저장은 완료 후 한 번만 한다 —
  // 토큰마다 IndexedDB에 쓰면 21 tok/s에서도 부하가 크다.
  const placeholder: UiMessage = {
    id: 'streaming',
    conversationId: conv.id,
    role: 'assistant',
    content: '',
    thinking: '',
    createdAt: startedAt,
    streaming: true,
  };

  set((s) => ({
    messages: [...s.messages, placeholder],
    streaming: true,
    startedAt,
    expectedPrefillSec,
    abort,
    error: null,
  }));

  let content = '';
  let thinking = '';
  let perf: PerfSample | null = null;

  const flush = () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === 'streaming' ? { ...m, content, thinking } : m,
      ),
    }));

  // 토큰마다 React를 돌리면 프레임을 놓친다. 60ms 단위로 묶는다.
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      flush();
    }, 60);
  };

  // 페이지를 처음 붙인 턴에만 절단 고지를 메시지에 남긴다.
  const notice =
    page?.truncated && !get().lastContext
      ? `본문이 길어 앞부분 ${Math.round(page.keptRatio * 100)}%만 참조했습니다.`
      : undefined;

  try {
    perf = await streamChat(
      settings.endpoint,
      {
        model: settings.model,
        messages: context,
        stream: true,
        // 일반 대화에서는 thinking을 끈다. 실측상 총 지연이 6.4배 차이난다.
        think: settings.thinkMode === 'always',
        keep_alive: settings.keepAlive,
        options: { temperature: settings.temperature, num_ctx: settings.numCtx },
      },
      {
        onToken: (t) => {
          content += t;
          schedule();
        },
        onThinking: (t) => {
          thinking += t;
          schedule();
        },
      },
      abort.signal,
    );

    flush();

    const id = await addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content,
      thinking: thinking || undefined,
      notice,
      perf: perf ?? undefined,
      createdAt: startedAt,
    });

    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === 'streaming'
          ? {
              ...m,
              id,
              content,
              thinking: thinking || undefined,
              notice,
              perf: perf ?? undefined,
              streaming: false,
            }
          : m,
      ),
      streaming: false,
      startedAt: null,
      abort: null,
      // 다음 턴의 캐시 적중분 계산 기준. 이번 응답까지 포함해야 정확하다.
      lastContext: [...context, { role: 'assistant', content }],
    }));
  } catch (e) {
    const err = e instanceof OllamaError ? e : null;
    const aborted = err?.code === 'ABORTED' || abort.signal.aborted;

    // 중단은 오류가 아니다. 여기까지 받은 내용은 살려서 저장한다.
    if (aborted && content) {
      const id = await addMessage({
        conversationId: conv.id,
        role: 'assistant',
        content,
        thinking: thinking || undefined,
        notice,
        aborted: true,
        createdAt: startedAt,
      });
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === 'streaming'
            ? { ...m, id, content, notice, aborted: true, streaming: false }
            : m,
        ),
        streaming: false,
        startedAt: null,
        abort: null,
        lastContext: null, // 중단된 응답은 캐시 기준으로 삼지 않는다
      }));
      return;
    }

    // 실패한 자리표시자는 남기지 않는다. 오류는 배너로 보여준다.
    set((s) => ({
      messages: s.messages.filter((m) => m.id !== 'streaming'),
      streaming: false,
      startedAt: null,
      abort: null,
      lastContext: null,
      error: aborted ? null : (err?.message ?? String(e)),
    }));
  }
}

function describeError(e: AppError): string {
  return e.hint ? `${e.message} ${e.hint}` : e.message;
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}
