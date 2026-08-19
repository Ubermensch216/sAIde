/**
 * 실제 Ollama 대상 통합 점검 — 접두사 캐시가 구현에서도 실제로 먹는가.
 * `npm run test:live`
 *
 * 유닛 테스트는 "접두사가 바이트 단위로 같다"까지만 보장한다. 그게 실제
 * 프리필 절감으로 이어지는지는 서버에 물어봐야 안다. 이 파일이 그 확인이다.
 */

import { describe, expect, it } from 'vitest';
import { buildContext, type AttachedPage, type ContextInput } from './context';
import { streamChat } from '@/lib/ollama/stream';
import type { DoneChunk } from '@/types/ollama';

const EP = 'http://localhost:11434';
const MODEL = 'gemma4:e2b';

/**
 * 기본 예산(2,000토큰 ≈ 한국어 4,000자)과 같은 크기의 가짜 본문.
 *
 * ★ 매 실행마다 고유한 값을 섞는다. Ollama의 KV 캐시는 프로세스에 남아 있어서,
 *   같은 본문으로 두 번 돌리면 1턴부터 캐시가 적중해(실측 64ms) 측정이 무의미해진다.
 *   1턴이 진짜 콜드 프리필이어야 비교가 성립한다.
 */
const NONCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const PAGE: AttachedPage = {
  url: `https://example.com/local-llm?run=${NONCE}`,
  title: `로컬 LLM 개요 (${NONCE})`,
  text:
    `문서 식별자 ${NONCE}. 로컬에서 동작하는 언어 모델은 사용자의 데이터를 외부 서버로 보내지 않는다는 이점이 있다. ` +
    '다만 소형 모델은 복잡한 추론에서 정확도가 떨어질 수 있고, 긴 문맥을 처리할 때 지연이 누적된다. '.repeat(
      60,
    ),
};

async function ask(messages: ReturnType<typeof buildContext>) {
  let done: DoneChunk | null = null;
  let out = '';
  await streamChat(
    EP,
    { model: MODEL, messages, stream: true, options: { num_ctx: 4096, temperature: 0 } },
    {
      onToken: (t) => {
        out += t;
      },
      onDone: (d) => {
        done = d;
      },
    },
  );
  const d = done as DoneChunk | null;
  return {
    out: out.trim(),
    promptTokens: d?.prompt_eval_count ?? 0,
    prefillMs: Math.round((d?.prompt_eval_duration ?? 0) / 1e6),
  };
}

describe('페이지 접두사 캐시 (실서버)', () => {
  it('★ 페이지를 붙인 후속 질문은 프리필을 거의 다시 물지 않는다', async () => {
    const turn1: ContextInput[] = [{ role: 'user', content: '이 글을 한 문장으로 요약해줘.' }];
    const ctx1 = buildContext(turn1, 4096, PAGE);
    const r1 = await ask(ctx1);

    const turn2: ContextInput[] = [
      ...turn1,
      { role: 'assistant', content: r1.out },
      { role: 'user', content: '핵심 단어 하나만 말해줘.' },
    ];
    const ctx2 = buildContext(turn2, 4096, PAGE);
    const r2 = await ask(ctx2);

    console.log(`  1턴: ${r1.promptTokens}tok / 프리필 ${r1.prefillMs}ms`);
    console.log(`  2턴: ${r2.promptTokens}tok / 프리필 ${r2.prefillMs}ms`);
    console.log(`  → 2턴이 1턴의 ${((r2.prefillMs / r1.prefillMs) * 100).toFixed(1)}%`);

    // 접두사가 보존되므로 2턴은 프롬프트가 더 긴데도 프리필은 훨씬 짧아야 한다.
    expect(r2.promptTokens).toBeGreaterThan(r1.promptTokens);
    expect(r2.prefillMs).toBeLessThan(r1.prefillMs * 0.3);
  }, 300_000);

  it('접두사(앞 3개)가 두 턴에서 바이트 단위로 같다', () => {
    const a = buildContext([{ role: 'user', content: 'A' }], 4096, PAGE);
    const b = buildContext(
      [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
      ],
      4096,
      PAGE,
    );
    expect(b.slice(0, 3)).toEqual(a.slice(0, 3));
  });
});
