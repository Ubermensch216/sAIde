import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChat } from './store';
import * as storage from '@/lib/storage/db';
import * as stream from '@/lib/ollama/stream';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import type { SWToPanel } from '@/lib/messaging/protocol';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => {
  useChat.getState().stop();
  await storage.deleteAllConversations();
  useChat.setState({ conversation: null, pending: null, messages: [], loading: false, page: null, screenshot: null, selection: null, extracting: false, error: null });
});
afterEach(() => { useChat.getState().stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('A 조회가 B보다 늦게 끝나도 현재 탭은 B로 유지한다', async () => {
  const slow = deferred<storage.Conversation | null>();
  vi.spyOn(storage, 'findForTab').mockImplementation(tab => tab === 1 ? slow.promise : Promise.resolve(null));
  const a = useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().openForTab(2, 'https://b.test');
  slow.resolve({ id: 1, tabId: 1, originUrl: 'https://a.test', title: 'A', createdAt: 0, updatedAt: 0 });
  await a;
  expect(useChat.getState()).toMatchObject({ currentUrl: 'https://b.test', conversation: null, pending: { tabId: 2 }, messages: [], loading: false });
});

it('동시에 두 번 전송해도 사용자 메시지와 생성은 한 번뿐이다', async () => {
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://a.test');
  await Promise.all([useChat.getState().send('first', DEFAULT_SETTINGS), useChat.getState().send('duplicate', DEFAULT_SETTINGS)]);
  expect(stream.streamChat).toHaveBeenCalledTimes(1);
  expect(await storage.db.conversations.count()).toBe(1);
  expect((await storage.db.messages.toArray()).filter(m => m.role === 'user').map(m => m.content)).toEqual(['first']);
});

it('중단을 무시한 이전 스트림의 늦은 응답이 새 대화를 오염시키지 않는다', async () => {
  const started = deferred<void>();
  const slow = deferred<null>();
  let lateToken!: (text: string) => void;
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    lateToken = handlers.onToken!; started.resolve(); return slow.promise;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  const sending = useChat.getState().send('A', DEFAULT_SETTINGS);
  await started.promise;
  await useChat.getState().openForTab(2, 'https://b.test');
  await sending; // underlying slow promise has not resolved
  lateToken('old answer'); slow.resolve(null);
  expect(useChat.getState()).toMatchObject({ currentUrl: 'https://b.test', messages: [], streaming: false, error: null });
  expect((await storage.db.messages.toArray()).map(m => m.content)).toEqual(['A']);
});

it('탭을 전환한 뒤 도착한 이전 탭 캡처를 붙이지 않는다', async () => {
  const slow = deferred<SWToPanel>();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => slow.promise) } });
  await useChat.getState().openForTab(1, 'https://a.test');
  const attachment = useChat.getState().attachScreenshot(1);
  await useChat.getState().openForTab(2, 'https://b.test');
  slow.resolve({ type: 'SCREENSHOT', dataUrl: 'data:image/png;base64,old' });
  expect(await attachment).toBeNull();
  expect(useChat.getState()).toMatchObject({ screenshot: null, extracting: false });
});

it('삭제한 대화에 메시지를 쓰면 실패하고 고아 메시지를 만들지 않는다', async () => {
  const id = await storage.createConversation(1, 'https://a.test');
  await storage.deleteConversation(id);
  await expect(storage.addMessage({ conversationId: id, role: 'assistant', content: 'late' })).rejects.toThrow('삭제된');
  expect(await storage.db.messages.count()).toBe(0);
});

/** 선택 영역 응답 한 건. 실제 payload와 같은 모양이어야 붙는 경로가 검증된다. */
function selectionResponse(text: string, url = 'https://a.test'): SWToPanel {
  return {
    type: 'SELECTION_EXTRACTED',
    payload: {
      url,
      title: '문서',
      text,
      charCount: text.length,
      truncated: false,
      keptRatio: 1,
      estimatedTokens: text.length,
      method: 'selection',
      extractedAt: Date.now(),
    },
  };
}

it('고른 부분을 붙여도 붙여 둔 본문을 떼지 않는다', async () => {
  // 둘은 역할이 다르다 — 본문은 맥락, 고른 부분은 질문이 가리키는 곳이다.
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => selectionResponse('고른 문단')) } });
  await useChat.getState().openForTab(1, 'https://a.test');
  useChat.setState({ page: { url: 'https://a.test', title: '문서', text: '본문', charCount: 2, truncated: false, keptRatio: 1, estimatedTokens: 1, method: 'readability', extractedAt: Date.now() } });

  await useChat.getState().attachSelection(1, DEFAULT_SETTINGS);

  expect(useChat.getState().selection?.text).toBe('고른 문단');
  expect(useChat.getState().page?.text).toBe('본문');
});

it('같은 글자를 다시 붙이면 같은 객체를 유지한다', async () => {
  // 갈아끼우면 접두사가 밀려 프리필을 다시 문다(실측 183ms → 7,684ms).
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => selectionResponse('같은 문단')) } });
  await useChat.getState().openForTab(1, 'https://a.test');

  const first = await useChat.getState().attachSelection(1, DEFAULT_SETTINGS);
  const second = await useChat.getState().attachSelection(1, DEFAULT_SETTINGS);

  expect(second).toBe(first);
});

it('탭을 전환한 뒤 도착한 이전 탭 선택을 붙이지 않는다', async () => {
  const slow = deferred<SWToPanel>();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => slow.promise) } });
  await useChat.getState().openForTab(1, 'https://a.test');
  const attachment = useChat.getState().attachSelection(1, DEFAULT_SETTINGS);
  await useChat.getState().openForTab(2, 'https://b.test');
  slow.resolve(selectionResponse('지난 탭에서 고른 문단'));

  expect(await attachment).toBeNull();
  expect(useChat.getState()).toMatchObject({ selection: null, extracting: false });
});

it('고른 부분이 없으면 페이지 본문으로 대신하지 않는다', async () => {
  // 고른 적 없는 2,000토큰을 사용자가 프리필 비용으로 무는 일은 없어야 한다.
  const empty: SWToPanel = { type: 'ERROR', error: { code: 'SELECTION_EMPTY', message: '' } };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => empty) } });
  await useChat.getState().openForTab(1, 'https://a.test');

  expect(await useChat.getState().attachSelection(1, DEFAULT_SETTINGS)).toBeNull();
  expect(useChat.getState().selection).toBeNull();
  expect(useChat.getState().error?.code).toBe('SELECTION_EMPTY');
});
