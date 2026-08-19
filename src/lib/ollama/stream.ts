/**
 * NDJSON 스트리밍 파서. 계획서 §5 Phase 2-1
 *
 * v2 골격에 두 가지를 추가했다:
 *   ① `message.thinking` — gemma4:e2b가 추론 텍스트를 content와 별도 필드로 보낸다.
 *      분기하지 않으면 사고 과정이 답변에 섞여 화면이 오염된다.
 *   ② `message.tool_calls` — Phase 5에서 쓴다.
 *
 * 잘림 처리가 이 파일의 핵심이다. 청크 경계는 줄 경계와 무관하게 떨어지므로
 * 마지막 불완전한 줄을 buffer에 남겨야 한다. 실사용에서 간헐적으로만
 * 재현되는 버그라 반드시 유닛 테스트로 고정한다 (stream.test.ts).
 */

import type {
  ChatRequest,
  DoneChunk,
  PerfSample,
  StreamChunk,
  ToolCall,
} from '@/types/ollama';
import { classifyFetchError, classifyResponse } from './errors';

export interface StreamHandlers {
  /** 답변 본문 토큰 */
  onToken?: (text: string) => void;
  /** ★ 추론 텍스트. 접이식 UI에 따로 렌더한다. */
  onThinking?: (text: string) => void;
  /** ★ 툴 호출. arguments는 이미 객체다 — JSON.parse 하지 말 것. */
  onToolCall?: (call: ToolCall) => void;
  onDone?: (done: DoneChunk, perf: PerfSample) => void;
}

/**
 * 한 줄(NDJSON)을 소비해 핸들러로 분배한다.
 * 파서 본체와 분리해 두어 테스트에서 잘림 위치를 자유롭게 조작할 수 있다.
 */
export function consumeLine(
  line: string,
  handlers: StreamHandlers,
  onDoneChunk: (c: StreamChunk) => void,
): void {
  if (!line.trim()) return;

  let chunk: StreamChunk;
  try {
    chunk = JSON.parse(line) as StreamChunk;
  } catch {
    // 서버가 비정상 종료하면 잘린 JSON이 올 수 있다. 스트림 전체를 죽이지 않는다.
    return;
  }

  const msg = chunk.message;
  if (msg?.thinking) handlers.onThinking?.(msg.thinking);
  if (msg?.content) handlers.onToken?.(msg.content);
  if (msg?.tool_calls?.length) {
    for (const call of msg.tool_calls) handlers.onToolCall?.(call);
  }
  if (chunk.done) onDoneChunk(chunk);
}

/** DoneChunk의 나노초 필드를 사람이 읽는 단위로 환산한다. */
export function toPerfSample(done: DoneChunk, ttfbMs: number): PerfSample {
  const nsToSec = (ns: number) => ns / 1e9;
  const safeDiv = (n: number, d: number) => (d > 0 ? Math.round(n / d) : 0);

  return {
    ttfbMs,
    prefillTokPerSec: safeDiv(
      done.prompt_eval_count,
      nsToSec(done.prompt_eval_duration),
    ),
    decodeTokPerSec: safeDiv(done.eval_count, nsToSec(done.eval_duration)),
    promptTokens: done.prompt_eval_count ?? 0,
    outputTokens: done.eval_count ?? 0,
    totalMs: Math.round(nsToSec(done.total_duration) * 1000),
    // load_duration이 유의미하면 모델을 새로 올린 것 — 콜드 스타트다.
    wasCold: (done.load_duration ?? 0) > 1e9,
  };
}

/**
 * /api/chat 스트리밍 호출.
 *
 * ★ 기본값 주의: think:false 와 keep_alive 를 여기서 씌우고, 호출자가
 *   명시적으로 넘긴 값이 이를 덮도록 스프레드 순서를 잡았다.
 */
export async function streamChat(
  endpoint: string,
  req: ChatRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<PerfSample | null> {
  const body: ChatRequest = {
    think: false,
    keep_alive: '10m',
    ...req,
    stream: true,
  };

  const startedAt = performance.now();
  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw classifyFetchError(e);
  }

  if (!res.ok || !res.body) throw await classifyResponse(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ttfbMs = 0;
  let perf: PerfSample | null = null;

  const markFirst = () => {
    if (ttfbMs === 0) ttfbMs = Math.round(performance.now() - startedAt);
  };

  const wrapped: StreamHandlers = {
    onToken: (t) => {
      markFirst();
      handlers.onToken?.(t);
    },
    onThinking: (t) => {
      markFirst();
      handlers.onThinking?.(t);
    },
    onToolCall: handlers.onToolCall,
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // ★ 불완전한 마지막 줄을 다음 청크로 넘긴다

      for (const line of lines) {
        consumeLine(line, wrapped, (c) => {
          perf = toPerfSample(c as unknown as DoneChunk, ttfbMs);
          handlers.onDone?.(c as unknown as DoneChunk, perf);
        });
      }
    }

    // 스트림이 개행 없이 끝나는 경우 버퍼에 마지막 줄이 남는다.
    if (buffer.trim()) {
      consumeLine(buffer, wrapped, (c) => {
        perf = toPerfSample(c as unknown as DoneChunk, ttfbMs);
        handlers.onDone?.(c as unknown as DoneChunk, perf);
      });
    }
  } finally {
    reader.releaseLock();
  }

  return perf;
}
