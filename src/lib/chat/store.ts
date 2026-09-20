import { abortable } from '@/lib/async';
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
import { requireCapabilities } from '@/lib/ollama/client';
import { OllamaError } from '@/lib/ollama/errors';
import {
  addMessage,
  createConversation,
  db,
  deleteMessage,
  deleteMessagesFrom,
  deleteConversation,
  findForTab,
  listMessages,
  titleFrom,
  type Conversation,
  type StoredMessage,
} from '@/lib/storage/db';
import {
  buildContext,
  fitAttachment,
  uncachedPrefillSeconds,
  type AttachedPage,
  type Attachment,
} from '@/lib/chat/context';
import { estimateTokens } from '@/lib/extract/budget';
import { sameDocument, sendToSW } from '@/lib/messaging/protocol';
import type { ApprovalRequest, AppError, ExtractedPage } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';
import { AGENT_TOOLS } from '@/lib/agent/tools';
import { createBrowserTools } from '@/lib/agent/executor';
import { runAgentLoop, type AgentStep, type TurnResult } from '@/lib/agent/loop';
import { buildAgentSystem } from '@/lib/prompts/agent';
import { ACTION_CARD_SCHEMA, actionCardInstruction, parseActionCard, renderActionCard } from '@/lib/ai/action-card';
import { buildTaskCandidates, type TaskCandidate } from '@/lib/schedule/candidates';
import { bodyRevision, documentIdentity, readDocResult, saveDocResult } from '@/lib/cache/doc-results';
import { classifyScheduleIntent } from '@/lib/schedule/classify';
import { patchFor, planFor, type SchedulePlan } from '@/lib/schedule/resolve';
import { renderCancelled, renderList, renderOutcome, renderProblem } from '@/lib/schedule/report';
import { addTask, deleteTask, listTasks, setTaskDone, updateTask } from '@/lib/schedule/store';

/**
 * 도구 스키마가 매 턴 차지하는 프롬프트 비용. 상수라 한 번만 잰다.
 * 컨텍스트 조립과 전송 게이트가 같은 값을 보게 하기 위한 것이다.
 */
const AGENT_TOOLS_TOKENS = estimateTokens(JSON.stringify(AGENT_TOOLS));

/** 에이전트가 조작할 탭. 제목까지 필요하다 — 승인 카드와 모델 안내에 쓴다. */
export interface AgentTab {
  tabId: number;
  url: string;
  title: string;
}

/** 화면에 그리는 메시지. 저장 레코드에 스트리밍 중 상태가 얹힌다. */
export interface UiMessage extends Omit<StoredMessage, 'id'> {
  id: number | string;
  streaming?: boolean;
}

interface ChatState {
  conversation: Conversation | null;
  loading: boolean;
  /**
   * 아직 저장되지 않은 대화의 소속 정보.
   * 사이드패널은 탭마다 열리므로, 실제로 말이 오가기 전에는 레코드를 만들지
   * 않는다. 첫 메시지를 보낼 때 이 정보로 대화를 생성한다.
   */
  pending: { tabId: number; url: string } | null;
  messages: UiMessage[];

  /** 이 대화에 붙어 있는 페이지. 대화 내내 동일하게 유지된다(KV 캐시). */
  page: ExtractedPage | null;
  /**
   * 붙어 있는 화면 캡처(base64 PNG).
   * 실측상 약 262토큰 — 페이지 본문(2,000토큰)보다 8배 싸다.
   */
  screenshot: string | null;
  /** 페이지 추출 또는 화면 캡처 진행 중 */
  extracting: boolean;
  /**
   * 패널이 알고 있는 현재 탭의 URL.
   * 붙어 있는 첨부물이 아직 이 페이지의 것인지 대조하는 데 쓴다.
   */
  currentUrl: string;
  /**
   * 모델에 넣기 시작할 시각. 이보다 앞선 메시지는 화면에는 남지만 문맥에는 넣지 않는다.
   *
   * ★ 본문을 다른 페이지 것으로 바꾸면 앞 문서에 대한 문답은 더 이상 근거가 아니다.
   *   그대로 두면 작은 모델이 지난 문서 이야기를 섞고, 좁은 문맥도 그만큼 잡아먹는다.
   */
  contextFrom: number;
  /**
   * 같은 주소에서 화면(프레임)만 바뀐 시각.
   *
   * ★ 프레임으로 화면을 갈아 끼우는 사이트는 주소 비교만으로 문서 전환을 알 수 없다.
   *   이 값이 붙어 있는 본문보다 뒤면, 그 본문은 지난 화면의 것이다.
   */
  screenChangedAt: number;

  streaming: boolean;
  startedAt: number | null;
  /** 이번 요청에서 실제로 프리필해야 할 예상 초 — 캐시 적중분은 뺀 값 */
  expectedPrefillSec: number;

  /**
   * 화면에 띄울 오류. ★ 문자열이 아니라 코드가 붙은 AppError다.
   * 코드가 있어야 UI가 해결 방법(명령·권한 요청 버튼)을 붙일 수 있다 —
   * 계획서 Phase 7-2. 문구는 lib/errors/describe.ts 한곳에서 만든다.
   */
  error: AppError | null;
  abort: AbortController | null;
  /** 직전 요청의 컨텍스트. 접두사 캐시 적중분을 계산하는 데 쓴다. */
  lastContext: ChatMessage[] | null;

  /* ── 에이전트 (Phase 5) ── */

  /** 진행 중인 루프의 단계 기록. 완료 시 메시지에 실려 저장된다. */
  agentSteps: AgentStep[];
  /** 지금 몇 번째 턴인가. 0이면 에이전트가 돌고 있지 않다. */
  agentTurn: number;
  /**
   * 승인 대기 중인 요청.
   *
   * ★ resolve를 부르기 전까지 루프는 여기서 멈춰 있다. 이 상태를 우회하는
   *   경로(자동 승인·기억하기)는 만들지 않는다 — 계획서 §7의 실질 방어선이다.
   */
  pendingApproval: { request: ApprovalRequest; resolve: (ok: boolean) => void } | null;

  /**
   * 확인을 기다리는 일정 계획(`@일정`).
   *
   * ★ 등록·수정·삭제는 예외 없이 이 카드를 거친다. 자동 저장 경로는 없다 —
   *   모델이 문장을 잘못 읽었을 때 되돌릴 수 없는 쪽은 사용자의 일정이다.
   */
  pendingSchedule: { plan: SchedulePlan; typed: string } | null;

  openForTab: (tabId: number, url: string) => Promise<void>;
  openConversation: (conversation: Conversation) => Promise<void>;
  /** 같은 작업이 다른 탭(팝업)으로 이어질 때 대상만 옮긴다. 대화는 그대로 둔다. */
  followTab: (tabId: number, url: string) => Promise<void>;
  /** 주소는 그대로인데 화면만 바뀌었다. 붙여 둔 본문을 지난 것으로 본다. */
  noteScreenChange: (frameId: number) => void;
  attachPage: (tabId: number, settings: Settings) => Promise<ExtractedPage | null>;
  attachScreenshot: (tabId: number) => Promise<string | null>;
  detachPage: () => void;
  detachScreenshot: () => void;
  send: (text: string, settings: Settings) => Promise<void>;
  /** 에이전트 모드 전송 (Phase 5). 툴을 붙여 최대 8턴까지 돈다. */
  sendAgent: (text: string, settings: Settings, tab: AgentTab) => Promise<void>;
  /** 승인 카드의 응답. false면 실행하지 않는다. */
  resolveApproval: (approved: boolean) => void;
  regenerate: (settings: Settings) => Promise<void>;
  /** 메시지 한 건을 대화와 저장소에서 지운다. */
  removeMessage: (id: UiMessage['id']) => Promise<void>;
  /** 지금 대화를 통째로 비운다. 같은 페이지에서 처음부터 다시 시작한다. */
  resetConversation: () => Promise<void>;
  /** 구조화 명령(`/조치`) 실행. 결과는 캐시를 거쳐 모델 호출을 아낀다. */
  runActionCard: (settings: Settings) => Promise<void>;
  /** `@일정` 한 문장 실행. 모델은 분류만 하고, 목록과 답변 문장은 코드가 만든다. */
  runScheduleIntent: (text: string, settings: Settings) => Promise<void>;
  /** 확인 카드의 응답. null이면 취소. */
  commitSchedulePlan: (ids: number[] | null) => Promise<void>;
  stop: () => void;
  setError: (e: AppError | string | null) => void;
  clearError: () => void;
}

let viewEpoch = 0;
let operationEpoch = 0;
let attachmentEpoch = 0;

export const useChat = create<ChatState>((set, get) => ({
  conversation: null,
  loading: false,
  pending: null,
  messages: [],
  page: null,
  screenshot: null,
  extracting: false,
  currentUrl: '',
  contextFrom: 0,
  screenChangedAt: 0,
  streaming: false,
  startedAt: null,
  expectedPrefillSec: 0,
  error: null,
  abort: null,
  lastContext: null,
  agentSteps: [],
  agentTurn: 0,
  pendingApproval: null,
  pendingSchedule: null,

  /** 탭별 세션 분리 (Phase 2-5). 탭이 바뀌면 그 탭의 대화로 갈아끼운다. */
  async openForTab(tabId, url) {
    get().stop();
    const epoch = ++viewEpoch;
    ++attachmentEpoch;
    set({ loading: true, extracting: false, conversation: null, pending: null, messages: [], page: null, screenshot: null, currentUrl: url, error: null, lastContext: null, agentSteps: [], contextFrom: 0, screenChangedAt: 0 });
    try {
      const conversation = await findForTab(tabId, url);
      const messages = conversation ? await listMessages(conversation.id) : [];
      if (epoch === viewEpoch) set({ conversation, pending: conversation ? null : { tabId, url }, messages, loading: false,
        contextFrom: conversation?.contextFrom ?? 0 });
    } catch (error) { if (epoch === viewEpoch) set({ loading: false, error: toAppError(null, error) }); }
  },
  async openConversation(conversation) {
    get().stop();
    const epoch = ++viewEpoch;
    ++attachmentEpoch;
    set({ loading: true, extracting: false, page: null, screenshot: null, messages: [], pending: null, conversation: null, agentSteps: [], lastContext: null, error: null });
    try {
      const messages = await listMessages(conversation.id);
      if (epoch === viewEpoch) set({ conversation, messages, loading: false, contextFrom: conversation.contextFrom ?? 0 });
    } catch (error) { if (epoch === viewEpoch) set({ loading: false, error: toAppError(null, error) }); }
  },

  /**
   * 팝업처럼 같은 작업이 다른 탭으로 이어질 때 대상만 옮긴다.
   *
   * ★ 대화를 갈아끼우지 않는다. 목록에서 항목을 하나 열었을 뿐인데 화면이 빈 대화로
   *   바뀌면, 사용자는 방금까지의 문답과 붙여 둔 본문을 잃는다.
   *   대신 읽고 쓸 대상 탭만 옮기고, 화면이 달라졌으므로 지난 본문은 지난 것으로 표시한다.
   */
  async followTab(tabId, url) {
    const state = get();
    if (state.currentUrl === url && state.conversation?.tabId === tabId) return;
    const moved = Boolean(state.currentUrl) && !sameDocument(state.currentUrl, url);
    set({
      currentUrl: url,
      ...(moved ? { screenChangedAt: Date.now() } : {}),
      ...(state.pending ? { pending: { ...state.pending, tabId } } : {}),
    });
    const conversation = state.conversation;
    if (!conversation || conversation.tabId === tabId) return;
    set({ conversation: { ...conversation, tabId } });
    await db.conversations.update(conversation.id, { tabId }).catch(() => undefined);
  },

  /**
   * 탭 주소는 그대로인데 화면만 바뀌는 경우를 잡는다.
   *
   * ★ 관계없는 프레임(알림 폴링, 광고 등)까지 받아 본문을 떼면 사용자는 붙여 둔 문서를
   *   자꾸 잃는다. 붙어 있는 본문을 뽑은 프레임과 최상위 프레임의 이동만 센다.
   */
  noteScreenChange(frameId) {
    const page = get().page;
    if (!page && !get().screenshot) return;
    const attachedFrame = page?.sourceFrameId ?? 0;
    if (frameId !== 0 && page && frameId !== attachedFrame) return;
    set({ screenChangedAt: Date.now() });
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
    if (get().extracting || get().loading) return current;
    const epoch = ++attachmentEpoch;
    const expectedUrl = get().currentUrl;

    set({ extracting: true, error: null });
    try {
      const res = await sendToSW({
        type: 'EXTRACT_PAGE',
        tabId,
        budgetTokens: settings.pageTokenBudget,
        control: { id: '', deadline: 0, expectedUrl: expectedUrl || undefined },
      });
      if (epoch !== attachmentEpoch) return null;

      if (res.type === 'ERROR') {
        set({ error: res.error });
        return null;
      }
      if (res.type !== 'PAGE_EXTRACTED') return null;

      const page = res.payload;
      // 같은 URL이면 기존 것을 유지해 접두사를 보존한다.
      if (current && current.url === page.url) return current;

      set({ page, currentUrl: page.url, lastContext: null, screenChangedAt: 0 });
      // 본문이 바뀌면 앞 문서에 대한 문답은 더 이상 근거가 아니다.
      await moveContextBoundary(set, get, nextStamp(get()));
      return page;
    } catch (error) {
      if (epoch === attachmentEpoch) set({ error: toAppError(null, error) });
      return null;
    } finally {
      if (epoch === attachmentEpoch) set({ extracting: false });
    }
  },

  /**
   * 현재 탭 화면을 캡처해 붙인다.
   *
   * 본문 추출이 실패하는 페이지(캔버스 앱, 대시보드, 차트)에서 특히 유용하다 —
   * 실측 262토큰 / 프리필 4.5초로, 본문을 넣는 것보다 오히려 싸고 빠르다.
   */
  async attachScreenshot(tabId) {
    if (get().extracting || get().loading) return get().screenshot;
    const epoch = ++attachmentEpoch;
    const expectedUrl = get().currentUrl;

    set({ extracting: true, error: null });
    try {
      const res = await sendToSW({ type: 'CAPTURE_SCREENSHOT', tabId, control: { id: '', deadline: 0, expectedUrl: expectedUrl || undefined } });
      if (epoch !== attachmentEpoch) return null;
      if (res.type === 'ERROR') {
        set({ error: res.error });
        return null;
      }
      if (res.type !== 'SCREENSHOT') return null;

      // Ollama의 images 필드는 순수 base64를 받는다. data: 프리픽스를 떼어낸다.
      const base64 = res.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      set({ screenshot: base64, lastContext: null });
      return base64;
    } catch (error) {
      if (epoch === attachmentEpoch) set({ error: toAppError(null, error) });
      return null;
    } finally {
      if (epoch === attachmentEpoch) set({ extracting: false });
    }
  },

  detachPage: () => { ++attachmentEpoch; set({ page: null, lastContext: null, extracting: false }); void moveContextBoundary(set, get, nextStamp(get())); },
  detachScreenshot: () => { ++attachmentEpoch; set({ screenshot: null, lastContext: null, extracting: false }); },

  async send(text, settings) { await submit(set, get, text, settings); },
  async sendAgent(text, settings, tab) { await submit(set, get, text, settings, tab); },

  resolveApproval(approved) {
    const pending = get().pendingApproval;
    if (!pending) return;
    set({ pendingApproval: null });
    pending.resolve(approved);
  },

  /** 재생성: 마지막 assistant 응답을 걷어내고 같은 입력으로 다시 돌린다. */
  async regenerate(settings) {
    if (get().streaming || get().loading) return;
    const conv = get().conversation;
    const msgs = get().messages;
    const index = findLastIndex(msgs, m => m.role === 'assistant');
    if (!conv || index < 0) return;
    const epoch = ++operationEpoch;
    set({ streaming: true, abort: new AbortController() });
    const ownSet = guardedSet(set, () => epoch === operationEpoch);
    try {
      await requireCapabilities(settings.endpoint, settings.model, get().screenshot ? ['vision'] : [], get().abort?.signal);
      if (epoch !== operationEpoch) return;
      await deleteMessagesFrom(conv.id, msgs[index]!.createdAt);
      if (epoch !== operationEpoch) return;
      ownSet({ messages: msgs.slice(0, index) });
      await runGeneration(ownSet, get, settings);
    } catch (error) { ownSet({ error: toAppError(null, error) }); }
    finally { ownSet({ streaming: false, abort: null }); }
  },

  async removeMessage(id) {
    const { conversation, streaming, loading } = get();
    if (!conversation || streaming || loading) return;
    if (!get().messages.some(message => message.id === id)) return;
    set({ loading: true, error: null });
    try {
      await deleteMessage(conversation.id, id);
      set(state => ({ messages: state.messages.filter(message => message.id !== id), lastContext: null }));
    } catch (error) { set({ error: toAppError(null, error) }); }
    finally { set({ loading: false }); }
  },

  async resetConversation() {
    if (get().loading) return;
    const { conversation, pending } = get();
    get().stop();
    ++attachmentEpoch;
    set({ loading: true, extracting: false, error: null });
    try {
      // 레코드를 지우면 취소된 요청의 늦은 저장도 함께 거부된다.
      if (conversation) await deleteConversation(conversation.id);
      set({
        conversation: null,
        pending: conversation ? { tabId: conversation.tabId, url: conversation.originUrl } : pending,
        messages: [], page: null, screenshot: null, lastContext: null, contextFrom: 0,
        agentSteps: [], agentTurn: 0, expectedPrefillSec: 0, pendingSchedule: null,
      });
    } catch (error) { set({ error: toAppError(null, error) }); }
    finally { set({ loading: false }); }
  },

  async runActionCard(settings) { await runActionCard(set, get, settings); },
  async runScheduleIntent(text, settings) { await runScheduleIntent(set, get, text, settings); },
  async commitSchedulePlan(ids) { await commitSchedulePlan(set, get, ids); },

  stop() {
    ++operationEpoch;
    // 승인 대기 중에 중단을 누르면 그 동작은 거부로 처리한다.
    // 대기 중인 Promise를 남겨 두면 루프가 영원히 멈춰 있게 된다.
    const pending = get().pendingApproval;
    if (pending) {
      set({ pendingApproval: null });
      pending.resolve(false);
    }

    const { abort } = get();
    abort?.abort();
    set(s => ({ abort: null, streaming: false, startedAt: null, agentTurn: 0,
      messages: s.messages.filter(m => !m.streaming || m.content || m.thinking).map(m => m.streaming ? { ...m, streaming: false, aborted: true } : m),
    }));
  },

  // 문자열로 넘어온 것은 분류되지 않은 오류다. 코드만 씌워 형태를 맞춘다.
  setError: (e) =>
    set({ error: typeof e === 'string' ? { code: 'UNKNOWN', message: e } : e }),
  clearError: () => set({ error: null }),
}));

/* ── 생성 루프 ─────────────────────────────────────────── */

type Set = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;
type Get = () => ChatState;

function guardedSet(set: Set, owns: () => boolean): Set {
  return patch => { if (owns()) set(patch); };
}

/**
 * 대화 안에서 다음에 쓸 시각. 새 메시지의 `createdAt`과 문맥 경계를 모두 이 값으로 잡는다.
 *
 * ★ 밀리초는 생각보다 넉넉하지 않다. 답변이 캐시로 즉시 끝나면 질문·답변·다음 동작이 같은
 *   밀리초에 들어오고, 그러면 `createdAt`만으로는 무엇이 먼저인지 알 수 없다.
 *
 * ★ 문맥 경계는 같은 시각의 메시지를 **포함**한다(contextMessages). 그래서 경계와 메시지 시각이
 *   겹치면 두 가지가 동시에 깨진다 — 본문을 떼었는데 그 문서 문답이 문맥에 남거나,
 *   방금 보낸 질문이 문맥에서 빠지거나. 시각이 절대 뒤로 가지 않게 하면 둘 다 사라진다.
 */
function nextStamp(state: ChatState): number {
  return Math.max(Date.now(), (state.messages.at(-1)?.createdAt ?? 0) + 1);
}

/**
 * 문맥 경계를 지금으로 옮긴다. 이 시점보다 앞선 문답은 화면에만 남고 모델에는 가지 않는다.
 *
 * ★ 본문을 새로 붙일 때마다 부른다. 앞 문서 요약이 다음 문서 답변에 섞이면 사용자는
 *   무엇을 근거로 한 답인지 알 수 없고, 좁은 문맥(num_ctx)도 그만큼 잡아먹는다.
 */
async function moveContextBoundary(set: Set, get: Get, at = Date.now()): Promise<void> {
  set({ contextFrom: at, lastContext: null });
  const conversation = get().conversation;
  if (!conversation) return;
  set({ conversation: { ...conversation, contextFrom: at } });
  await db.conversations.update(conversation.id, { contextFrom: at }).catch(() => undefined);
}

/** 모델에 넣을 대화. 경계 이전 메시지는 뺀다. */
function contextMessages(state: ChatState): UiMessage[] {
  return state.contextFrom ? state.messages.filter(message => message.createdAt >= state.contextFrom) : state.messages;
}

async function submit(set: Set, get: Get, text: string, settings: Settings, tab?: AgentTab) {
  const trimmed = text.trim();
  if (!trimmed || get().streaming || get().loading) return;
  const epoch = ++operationEpoch;
  const owns = () => epoch === operationEpoch;
  const ownSet = guardedSet(set, owns);
  ownSet({ streaming: true, abort: new AbortController(), error: null });
  try {
    await requireCapabilities(settings.endpoint, settings.model, [...(tab ? ['tools'] : []), ...(get().screenshot ? ['vision'] : [])], get().abort?.signal);
    if (!owns()) return;
    const conv = await ensureConversation(ownSet, get, trimmed, owns);
    if (!conv || !owns()) return;
    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: nextStamp(get()) };
    const id = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id }] }));
    if (tab) await runAgent(ownSet, get, settings, tab);
    else await runGeneration(ownSet, get, settings);
  } catch (error) { ownSet({ error: toAppError(error instanceof OllamaError ? error : null, error) }); }
  finally { ownSet({ streaming: false, abort: null, startedAt: null }); }
}

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
  owns: () => boolean,
): Promise<Conversation | null> {
  const existing = get().conversation;
  if (existing) return existing;

  const p = get().pending;
  if (!p) return null;

  const id = await createConversation(p.tabId, p.url, titleFrom(firstMessage));
  const conv = await db.conversations.get(id);
  if (!conv) return null;
  if (!owns()) { await deleteConversation(id); return null; }

  set({ conversation: conv, pending: null });
  return conv;
}

function toAttachment(page: ExtractedPage | null, screenshot: string | null): Attachment {
  const p: AttachedPage | null = page
    ? {
        url: page.url,
        title: page.title,
        text: page.text,
        truncated: page.truncated,
        keptRatio: page.keptRatio,
      }
    : null;
  return { page: p, screenshot };
}

/**
 * ★ 최종 안전망 — 첨부물이 아직 현재 페이지의 것인지 대조한다.
 *
 *   탭 변경 감지(background의 onUpdated)와 대화 이어가기 규칙(findForTab)이
 *   이미 막고 있지만, 둘 다 브라우저 이벤트에 의존한다. iframe 이동이나
 *   이벤트 유실 같은 경우에 낡은 본문이 남을 수 있다.
 *
 *   그 상태로 생성하면 모델이 **다른 글을 근거로 그럴듯하게** 답한다.
 *   사용자가 알아채기 가장 어려운 종류의 오답이므로, 여기서 한 번 더 막고
 *   왜 페이지가 빠졌는지 알린다.
 */
function freshAttachment(
  set: Set,
  get: Get,
): { page: ExtractedPage | null; screenshot: string | null; stale: boolean } {
  const currentUrl = get().currentUrl;
  const rawPage = get().page;
  // 주소가 같아도 화면이 바뀌었으면 지난 본문이다(프레임으로 문서를 갈아 끼우는 사이트).
  const screenMoved = Boolean(rawPage && get().screenChangedAt > rawPage.extractedAt);
  const stale = Boolean(rawPage && currentUrl && !sameDocument(rawPage.url, currentUrl)) || screenMoved;

  if (stale) set({ page: null, screenshot: null, lastContext: null });

  return {
    page: stale ? null : rawPage,
    screenshot: stale ? null : get().screenshot,
    stale,
  };
}

const STALE_NOTICE =
  '페이지가 바뀌어 이전 본문을 떼어냈습니다. 현재 페이지 내용은 참조하지 않았습니다.';

async function runGeneration(set: Set, get: Get, settings: Settings) {
  const conv = get().conversation;
  if (!conv) return;

  const abort = get().abort ?? new AbortController();
  const startedAt = Date.now();

  const { page, screenshot, stale } = freshAttachment(set, get);

  // ★ 먼저 예산에 맞춘 첨부를 만든다. buildContext도 같은 함수를 부르지만
  //   멱등이라 결과가 같다 — 여기서 미리 부르는 이유는 절단 고지에 실제로
  //   모델이 본 비율을 적기 위해서다.
  const attachment = fitAttachment(toAttachment(page, screenshot), settings.numCtx);

  const context = buildContext(contextMessages(get()), settings.numCtx, attachment);
  // 캐시 적중분을 뺀 예상 대기시간. 페이지를 붙인 후속 질문은 이 값이 거의 0이다.
  const expectedPrefillSec = uncachedPrefillSeconds(get().lastContext, context);

  // 스트리밍 중 자리표시자. 실제 저장은 완료 후 한 번만 한다 —
  // 토큰마다 IndexedDB에 쓰면 21 tok/s에서도 부하가 크다.
  const placeholder: UiMessage = {
    id: `streaming-${crypto.randomUUID()}`,
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
        m.id === placeholder.id ? { ...m, content, thinking } : m,
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
  // 조용히 넘어가지 않는다 — 페이지 없이 답한 사실을 반드시 알린다.
  const staleNotice = stale ? STALE_NOTICE : undefined;

  // 추출 단계의 절단과 컨텍스트에 맞추느라 생긴 절단을 합친 비율이다.
  const fitted = attachment.page;
  const truncNotice =
    fitted?.truncated && !get().lastContext
      ? `본문이 길어 앞부분 ${Math.round((fitted.keptRatio ?? 1) * 100)}%만 참조했습니다.`
      : undefined;

  const notice = staleNotice ?? truncNotice;

  try {
    perf = await abortable(streamChat(
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
    ), abort.signal);
    abort.signal.throwIfAborted();

    flush();

    const id = await addMessage({
      conversationId: conv.id,
      clientId: String(placeholder.id),
      role: 'assistant',
      content,
      thinking: thinking || undefined,
      notice,
      perf: perf ?? undefined,
      createdAt: startedAt,
    });

    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id
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
        clientId: String(placeholder.id),
        role: 'assistant',
        content,
        thinking: thinking || undefined,
        notice,
        aborted: true,
        createdAt: startedAt,
      });
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === placeholder.id
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
      messages: s.messages.filter((m) => m.id !== placeholder.id),
      streaming: false,
      startedAt: null,
      abort: null,
      lastContext: null,
      error: aborted ? null : toAppError(err, e),
    }));
  }
}

/* ── `@일정` 자연어 일정 관리 ───────────────────────────── */

/** 코드가 저장소를 읽어 만든 기록. 모델 답변과 구분해 표시된다. */
async function reportInto(set: Set, get: Get, content: string, owns: () => boolean = () => true): Promise<void> {
  const conv = get().conversation;
  if (!conv || !owns()) return;
  const message = { conversationId: conv.id, role: 'assistant' as const, content,
    origin: 'automation' as const, createdAt: nextStamp(get()) };
  const id = await addMessage(message);
  if (!owns()) return;
  set(s => ({ messages: [...s.messages, { ...message, id }] }));
}

/**
 * `@일정` 한 문장을 실행한다.
 *
 * ★ 모델은 **분류만** 한다. 목록도 결과 문장도 코드가 저장소를 읽어 만든다(report.ts).
 *   대화 모델에게 일정 목록을 맡기면 없는 일정을 지어내고, 사용자는 그것을 구분할 수 없다.
 * ★ 쓰기는 여기서 일어나지 않는다. 계획을 카드에 걸어 두고 끝낸다 — 실제 저장은
 *   사용자가 누른 뒤 commitSchedulePlan에서만 일어난다.
 * ★ 분류 호출은 독립 1회성 요청이다. 문서 대화의 KV 캐시 접두사를 훼손하지 않는다.
 */
async function runScheduleIntent(set: Set, get: Get, text: string, settings: Settings) {
  const trimmed = text.trim();
  if (!trimmed || get().streaming || get().loading) return;
  const epoch = ++operationEpoch;
  const owns = () => epoch === operationEpoch;
  const ownSet = guardedSet(set, owns);
  // 앞서 걸어 둔 계획은 여기서 버린다. 새 지시가 앞 지시를 대신한다.
  ownSet({ streaming: true, startedAt: Date.now(), abort: new AbortController(), error: null, pendingSchedule: null });
  try {
    const conv = await ensureConversation(ownSet, get, trimmed, owns);
    if (!conv || !owns()) return;

    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: nextStamp(get()) };
    const userId = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id: userId }] }));

    const intent = await classifyScheduleIntent(settings, trimmed, get().abort?.signal);
    if (!owns()) return;

    const plan = planFor(intent, await listTasks(), trimmed);
    if (!owns()) return;

    // 조회와 안내는 확인받을 것이 없다. 바로 답한다.
    // ★ 화면을 옮기지 않는다. 결과는 여기 남고, 일정 탭으로 가는 길은 답변 안의 링크다.
    if (plan.kind === 'list') { await reportInto(ownSet, get, renderList(plan), owns); return; }
    if (plan.kind === 'none') { await reportInto(ownSet, get, renderProblem(plan.problem), owns); return; }

    ownSet({ pendingSchedule: { plan, typed: trimmed } });
  } catch (error) {
    const err = error instanceof OllamaError ? error : null;
    const aborted = err?.code === 'ABORTED' || get().abort?.signal.aborted;
    ownSet({ error: aborted ? null : toAppError(err, error) });
  } finally {
    ownSet({ streaming: false, abort: null, startedAt: null });
  }
}

/**
 * 확인 카드의 응답을 실행한다.
 *
 * @param ids `null`이면 취소. 등록은 배열이 비어 있지 않기만 하면 되고,
 *            수정·삭제는 이 배열에 든 항목만 건드린다.
 */
async function commitSchedulePlan(set: Set, get: Get, ids: number[] | null) {
  const pending = get().pendingSchedule;
  if (!pending) return;
  const { plan } = pending;
  if (plan.kind === 'list' || plan.kind === 'none') { set({ pendingSchedule: null }); return; }

  // 카드를 먼저 내린다. 저장이 도는 동안 한 번 더 눌러 두 번 실행되는 일을 막는다.
  set({ pendingSchedule: null });

  try {
    if (ids === null || !ids.length) {
      await reportInto(set, get, renderCancelled(plan.kind));
      return;
    }

    if (plan.kind === 'create') {
      const id = await addTask(plan.task);
      const saved = (await listTasks()).filter(task => task.id === id);
      await reportInto(set, get, renderOutcome('create', saved));
      return;
    }

    const chosen = plan.targets.filter(task => ids.includes(task.id));
    if (!chosen.length) { await reportInto(set, get, renderCancelled(plan.kind)); return; }

    if (plan.kind === 'update') {
      for (const task of chosen) {
        const { status, ...rest } = patchFor(task, plan.changes);
        if (Object.keys(rest).length) await updateTask(task.id, rest);
        // ★ 완료 여부는 setTaskDone을 거친다. 직접 쓰면 완료 시각이 비어 목록 정렬이 흔들린다.
        if (status) await setTaskDone(task.id, status === 'done');
      }
      const after = (await listTasks()).filter(task => chosen.some(item => item.id === task.id));
      await reportInto(set, get, renderOutcome('update', after));
      return;
    }

    for (const task of chosen) await deleteTask(task.id);
    // ★ 지운 항목은 제목만 남긴다. 기한과 D-day를 되살려 적으면 아직 있는 것처럼 읽힌다.
    await reportInto(set, get, renderOutcome('delete', chosen.map(task => ({ title: task.title }))));
  } catch (error) {
    set({ error: toAppError(null, error) });
  }
}

/* ── 핵심·조치사항 카드 ────────────────────────────────── */

/**
 * 붙어 있는 본문에서 할 일·기한·제출물을 뽑는다.
 *
 * ★ 자유 형식으로 쓰게 하면 소형 모델은 항목을 빠뜨리거나 날짜를 바꿔 쓴다. JSON 스키마로
 *   구속하고, 화면에 내놓기 전에 **코드가 원문과 대조**해 `원문 확인` 배지를 붙인다.
 *   확인하지 못한 값도 지우지 않는다 — 판단은 사용자가 한다.
 *
 * ★ 본문은 언제나 이미 붙어 있는 것을 쓰고, 본문 판본이 같을 때만 모델 호출을 건너뛴다.
 *   제목만 같고 내용이 바뀐 페이지에 지난 분석을 붙이면 캐시가 조용한 거짓말이 된다.
 */
async function runActionCard(set: Set, get: Get, settings: Settings) {
  if (get().streaming || get().loading) return;
  const { page } = freshAttachment(set, get);
  if (!page) {
    set({ error: { code: 'UNKNOWN', message: '먼저 이 페이지의 본문을 붙여 주세요.',
      hint: '입력창 위의 페이지 첨부를 누르면 본문을 읽어 옵니다.' } });
    return;
  }

  const epoch = ++operationEpoch;
  const owns = () => epoch === operationEpoch;
  const ownSet = guardedSet(set, owns);
  ownSet({ streaming: true, startedAt: Date.now(), abort: new AbortController(), error: null });

  try {
    const instruction = actionCardInstruction(page.title);
    const conv = await ensureConversation(ownSet, get, `핵심·조치사항 · ${page.title}`, owns);
    if (!conv || !owns()) return;

    const lookup = {
      identity: documentIdentity({ title: page.title, listName: new URL(page.url).host }),
      command: 'actions',
      instruction,
      model: settings.model,
    };
    const revision = bodyRevision(page.text);
    const hit = await readDocResult(lookup, revision);
    if (!owns()) return;

    if (hit) {
      await commitActionCard(ownSet, get, conv.id, hit.content, hit.taskCandidates ?? [], page, hit.createdAt);
      return;
    }

    const abort = get().abort ?? new AbortController();
    let raw = '';
    await abortable(streamChat(settings.endpoint, {
      model: settings.model,
      messages: [
        { role: 'system', content: '너는 문서에서 할 일과 기한을 뽑아 JSON으로만 답하는 도구다.' },
        { role: 'user', content: `<page_content>\n${page.text}\n</page_content>\n\n${instruction}` },
      ],
      stream: true,
      format: ACTION_CARD_SCHEMA as unknown as Record<string, unknown>,
      keep_alive: settings.keepAlive,
      options: { temperature: 0, num_ctx: settings.numCtx },
    }, { onToken: token => { raw += token; } }, abort.signal), abort.signal);
    if (!owns()) return;

    const card = parseActionCard(raw);
    if (!card) {
      ownSet({ error: { code: 'UNKNOWN', message: '모델이 정해진 형식으로 답하지 않았습니다.',
        hint: '다시 시도하거나 다른 모델을 선택해 보세요.' } });
      return;
    }
    const content = renderActionCard(page.title, card, page.text);
    const candidates = buildTaskCandidates(card, page.text);
    await saveDocResult(lookup, { bodyRevision: revision, content, taskCandidates: candidates,
      sourceDoc: { title: page.title, url: page.url } });
    if (!owns()) return;
    await commitActionCard(ownSet, get, conv.id, content, candidates, page);
  } catch (error) {
    ownSet({ error: toAppError(error instanceof OllamaError ? error : null, error) });
  } finally {
    ownSet({ streaming: false, abort: null, startedAt: null });
  }
}

/** 카드 결과를 대화에 남긴다. 캐시에서 꺼낸 것이면 처음 분석한 시각을 함께 적는다. */
async function commitActionCard(
  set: Set,
  get: Get,
  conversationId: number,
  content: string,
  taskCandidates: TaskCandidate[],
  page: ExtractedPage,
  cached?: number,
) {
  const message = {
    conversationId,
    role: 'assistant' as const,
    content,
    ...(taskCandidates.length ? { taskCandidates } : {}),
    sourceDoc: { title: page.title, url: page.url },
    ...(cached ? { cached } : {}),
    createdAt: nextStamp(get()),
  };
  const id = await addMessage(message);
  set(state => ({ messages: [...state.messages, { ...message, id }], lastContext: null }));
}

/* ── 에이전트 루프 (Phase 5) ───────────────────────────── */

/**
 * 툴을 붙여 최대 8턴을 돈다. 계획서 §5 Phase 5-2
 *
 * ★ 일반 생성과 나눠 둔 이유는 비용이다. 툴 스키마 8종은 매 턴 프리필에
 *   들어가므로, 툴이 필요 없는 대화에까지 붙이면 모든 질문이 느려진다.
 *   그래서 에이전트는 사용자가 명시적으로 켰을 때만 이 경로로 온다.
 */
async function runAgent(set: Set, get: Get, settings: Settings, tab: AgentTab) {
  const conv = get().conversation;
  if (!conv) return;

  const abort = get().abort ?? new AbortController();
  const startedAt = Date.now();
  const { page, screenshot, stale } = freshAttachment(set, get);

  // ★ 시스템 프롬프트 · 에이전트 지침 · 현재 탭 안내를 **하나로 합쳐** 넣는다.
  //   나눠 넣으면 도구 호출이 깨지고, 탭을 알려주지 않으면 "어떤 페이지요?"라고
  //   되묻고 끝난다. 둘 다 실측 근거는 prompts/agent.ts 머리말.
  // ★ 도구 스키마 8종은 매 턴 프리필에 들어가고 전송 게이트도 합산한다.
  //   조립할 때 빼두지 않으면 게이트가 첫 턴부터 요청을 되돌려 보낸다.
  const agentSystem = buildAgentSystem(tab);
  const context = buildContext(
    get().messages,
    settings.numCtx,
    fitAttachment(toAttachment(page, screenshot), settings.numCtx, {
      systemPrompt: agentSystem,
      reservedTokens: AGENT_TOOLS_TOKENS,
    }),
    agentSystem,
    AGENT_TOOLS_TOKENS,
  );

  const placeholder: UiMessage = {
    id: `streaming-${crypto.randomUUID()}`,
    conversationId: conv.id,
    role: 'assistant',
    content: '',
    thinking: '',
    steps: [],
    createdAt: startedAt,
    streaming: true,
  };

  set((s) => ({
    messages: [...s.messages, placeholder],
    streaming: true,
    startedAt,
    expectedPrefillSec: uncachedPrefillSeconds(get().lastContext, context),
    abort,
    error: null,
    agentSteps: [],
    agentTurn: 0,
  }));

  let content = '';
  let thinking = '';

  // 토큰마다 리렌더하면 프레임을 놓친다. 60ms로 묶는 것은 일반 생성과 같다.
  let pending = false;
  const flush = () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id ? { ...m, content, thinking, steps: s.agentSteps } : m,
      ),
    }));
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      flush();
    }, 60);
  };

  const { execute, describeTarget } = createBrowserTools(() => tab.tabId, () => tab.url);
  let visionChecked = Boolean(screenshot);

  try {
    const outcome = await runAgentLoop(
      context,
      {
        chat: async (messages, handlers, signal): Promise<TurnResult> => {
          if (!visionChecked && messages.some(message => message.images?.length)) {
            await requireCapabilities(settings.endpoint, settings.model, ['vision'], signal);
            visionChecked = true;
          }
          let turnContent = '';
          let turnThinking = '';
          const toolCalls: TurnResult['toolCalls'] = [];

          const perf = await streamChat(
            settings.endpoint,
            {
              model: settings.model,
              messages,
              stream: true,
              // ★ 여기서만 thinking을 켠다(계획서 Phase 5). 계획 단계의 정확도가
              //   6.4배의 지연보다 중요한 유일한 지점이다. 'off'면 사용자 뜻대로 끈다.
              think: settings.thinkMode !== 'off',
              keep_alive: settings.keepAlive,
              tools: AGENT_TOOLS,
              options: { temperature: settings.temperature, num_ctx: settings.numCtx },
            },
            {
              onToken: (t) => {
                turnContent += t;
                content = turnContent;
                handlers.onToken?.(t);
                if (!abort.signal.aborted) schedule();
              },
              onThinking: (t) => {
                turnThinking += t;
                thinking += t;
                handlers.onThinking?.(t);
                if (!abort.signal.aborted) schedule();
              },
              onToolCall: (c) => toolCalls.push(c),
            },
            signal,
          );

          return { content: turnContent, thinking: turnThinking, toolCalls, perf };
        },

        execute,
        describeTarget,

        // 승인 카드가 뜨고, 사용자가 누를 때까지 루프가 여기서 멈춘다.
        approve: (request) =>
          new Promise<boolean>((resolve) => { if (abort.signal.aborted) resolve(false); else set({ pendingApproval: { request, resolve } }); }),

        currentPage: () => ({ url: tab.url, title: tab.title }),

        onEvent: (e) => {
          if (e.type === 'turn-start') set({ agentTurn: e.turn });
          else if (e.type === 'step') {
            set((s) => ({ agentSteps: [...s.agentSteps, e.step] }));
            flush();
          }
        },
      },
      {
        maxTurns: settings.agentMaxTurns,
        idleTimeoutMs: settings.agentIdleTimeoutMs,
        signal: abort.signal,
      },
    );

    content = outcome.content;
    thinking = outcome.thinking;
    const steps = outcome.steps;

    const notice = stale ? STALE_NOTICE : outcome.notice;
    const aborted = outcome.stopReason === 'aborted';

    const id = await addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content,
      thinking: thinking || undefined,
      notice,
      steps: steps.length > 0 ? steps : undefined,
      perf: outcome.perf ?? undefined,
      aborted: aborted || undefined,
      createdAt: startedAt,
    });

    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id
          ? {
              ...m,
              id,
              content,
              thinking: thinking || undefined,
              notice,
              steps: steps.length > 0 ? steps : undefined,
              perf: outcome.perf ?? undefined,
              aborted: aborted || undefined,
              streaming: false,
            }
          : m,
      ),
      streaming: false,
      startedAt: null,
      abort: null,
      agentTurn: 0,
      pendingApproval: null,
      // ★ 에이전트 턴은 캐시 기준으로 삼지 않는다. 툴 결과가 중간에 끼어
      //   다음 일반 대화와 접두사가 어차피 어긋난다.
      lastContext: null,
    }));
  } catch (e) {
    const err = e instanceof OllamaError ? e : null;
    const aborted = err?.code === 'ABORTED' || abort.signal.aborted;

    set((s) => ({
      messages: s.messages.filter((m) => m.id !== placeholder.id),
      streaming: false,
      startedAt: null,
      abort: null,
      agentTurn: 0,
      pendingApproval: null,
      lastContext: null,
      error: aborted ? null : toAppError(err, e),
    }));
  }
}

/** 예외를 AppError로 정규화한다. OllamaError면 분류된 코드를 살린다. */
function toAppError(err: OllamaError | null, raw: unknown): AppError {
  if (err) return err.toAppError();
  return { code: 'UNKNOWN', message: String(raw) };
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}
