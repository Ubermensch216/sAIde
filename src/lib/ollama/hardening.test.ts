import { afterEach, expect, it, vi } from 'vitest';
import { requestJson, requireCapabilities } from './client';
import { streamChat } from './stream';
const endpoint = 'http://localhost:11434';
const req = { model: 'test', messages: [], stream: true as const };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([403, 404, 500])('JSON API의 HTTP %i를 공통 오류로 분류한다', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('failure', { status })));
  await expect(requestJson(endpoint, '/api/show')).rejects.toMatchObject({ code: status === 403 ? 'CORS_BLOCKED' : status === 404 ? 'MODEL_MISSING' : 'UNKNOWN' });
});
it('AbortSignal을 무시하는 JSON 요청도 deadline에 종료한다', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const result = expect(requestJson(endpoint, '/api/show', {}, 100)).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(101); await result;
});
it.each(['{"error":"inference failed"}\n', '{"message":{"content":"partial"}}\n', 'null\n', 'broken\n'])('불완전·오류 스트림을 성공으로 처리하지 않는다: %s', async body => {
  vi.stubGlobal('fetch', async () => new Response(body));
  await expect(streamChat(endpoint, req, {})).rejects.toMatchObject({ code: 'UNKNOWN' });
});
it('done 뒤 연결이 열려 있어도 완료하고 reader를 취소한다', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"done":true}\n')); }, cancel })));
  expect(await streamChat(endpoint, req, {})).toMatchObject({ totalMs: 0 });
  expect(cancel).toHaveBeenCalledOnce();
});
it('흐르다 멈춘 스트림은 180초에 중단한다', async () => {
  vi.useFakeTimers();
  let pulls = 0;
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
    pull(controller) {
      // 한 줄을 흘린 뒤 그대로 멈춘다. 연결은 살아 있으나 진행이 없는 상태다.
      if (pulls++) return new Promise(() => {});
      controller.enqueue(new TextEncoder().encode('{"message":{"content":"가"}}\n'));
      return undefined;
    },
  })));
  const result = expect(streamChat(endpoint, req, {})).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(180001); await result;
});

/**
 * ★ 프리필 침묵은 실패가 아니다. 긴 본문을 붙인 정상 요청은 첫 바이트까지
 *   수 분을 침묵할 수 있고, 그것을 끊으면 기능 자체가 쓸 수 없게 된다.
 */
it('★ 첫 바이트 전의 침묵은 상한에 걸리지 않는다', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const prefill = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
    async pull(controller) {
      await prefill;
      controller.enqueue(new TextEncoder().encode('{"done":true}\n'));
      controller.close();
    },
  })));
  const running = streamChat(endpoint, req, {});
  await vi.advanceTimersByTimeAsync(400_000);
  release();
  await expect(running).resolves.toMatchObject({ totalMs: expect.any(Number) });
});
it('초과한 컨텍스트는 HTTP 요청 전에 거부한다', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(streamChat(endpoint, { ...req, messages: [{ role: 'user', content: '가'.repeat(10000) }], options: { num_ctx: 2048 } }, {})).rejects.toThrow('입력 예산');
  expect(fetch).not.toHaveBeenCalled();
});
it('기능이 없거나 확인되지 않은 모델의 도구 사용을 차단한다', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ capabilities: ['completion'] }));
  await expect(requireCapabilities(endpoint, 'test', ['tools'])).rejects.toThrow('tools');
});
