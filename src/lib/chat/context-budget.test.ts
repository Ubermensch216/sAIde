/**
 * 조립기와 전송 게이트의 계약. (회귀 방지)
 *
 * ★ 이 파일이 지키는 불변식은 하나다.
 *
 *     buildContext가 만든 컨텍스트는 assertRequestBudget를 반드시 통과한다.
 *
 *   예전에는 두 쪽이 서로 다른 공식으로 토큰을 셌다. context.ts는
 *   `length / 2.5`와 이미지 262토큰, stream.ts는 estimateTokens(한국어
 *   length/2.0)와 이미지 1024토큰. 그래서 조립기가 "예산 안"이라고 판단한
 *   요청을 게이트가 HTTP 전에 되돌려 보냈다. 기본 설정에서 본문+캡처 조합은
 *   예외 없이 거부됐다 — 한도 2,867토큰에 게이트 추정 3,191토큰.
 *
 * ★ 증상이 조용하지 않고 시끄러운 대신, 원인이 두 파일 사이의 빈틈에 있어서
 *   어느 쪽 단위 테스트로도 잡히지 않았다. 그래서 두 모듈을 함께 부르는
 *   테스트를 따로 둔다. 한쪽 공식만 고치면 여기서 깨진다.
 */

import { describe, expect, it } from 'vitest';
import { buildContext, fitAttachment, CONTEXT_RESERVE_TOKENS, type ContextInput } from './context';
import { assertRequestBudget } from '@/lib/ollama/stream';
import { fitToBudget, promptBudget, promptTokens } from '@/lib/extract/budget';
import { AGENT_TOOLS } from '@/lib/agent/tools';
import type { ChatMessage, ChatRequest } from '@/types/ollama';

const KOREAN =
  '로컬 LLM은 데이터를 컴퓨터 밖으로 내보내지 않는다는 점이 가장 큰 이점이다. ';

/** 실제 추출 경로와 같다 — injected.ts가 pageTokenBudget으로 잘라서 보낸다. */
function extractedPage(budgetTokens: number) {
  const raw = KOREAN.repeat(400);
  const fitted = fitToBudget(raw, budgetTokens);
  return {
    url: 'https://example.com/article',
    title: '로컬 LLM 도입기',
    text: fitted.text,
    truncated: fitted.truncated,
    keptRatio: fitted.keptRatio,
  };
}

const ask = (n = 1): ContextInput[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: i % 2 === 0 ? `${i}번째 질문입니다. 자세히 설명해주세요.` : `${i}번째 답변. ${KOREAN.repeat(4)}`,
  }));

/** 실제 전송과 같은 모양으로 게이트를 통과시킨다. */
function send(messages: ChatMessage[], numCtx: number, tools?: ChatRequest['tools']) {
  const req: ChatRequest = {
    model: 'gemma4:e2b',
    messages,
    stream: true,
    options: { num_ctx: numCtx },
  };
  if (tools) req.tools = tools;
  assertRequestBudget(req);
}

describe('buildContext → assertRequestBudget 계약', () => {
  it('★ 기본 설정에서 본문+캡처를 함께 보낼 수 있다 (거부되던 조합)', () => {
    // 기본값: numCtx 4,096 / pageTokenBudget 2,000. 이 조합이 예전에는
    // 100% 거부됐다 — README가 홍보하는 기능인데도.
    const ctx = buildContext(ask(1), 4096, {
      page: extractedPage(2000),
      screenshot: 'BASE64PNG',
    });

    expect(ctx[1]!.images).toEqual(['BASE64PNG']);
    expect(() => send(ctx, 4096)).not.toThrow();
  });

  it('본문만 붙여도 통과한다', () => {
    const ctx = buildContext(ask(1), 4096, extractedPage(2000));
    expect(() => send(ctx, 4096)).not.toThrow();
  });

  it('★ 본문 예산을 컨텍스트보다 크게 잡아도 거부하지 않고 줄여서 보낸다', () => {
    // 설정 UI가 허용하는 조합이다(본문 최대 8,000 / 컨텍스트 최소 2,048).
    // 예전에는 사용자가 질문을 지워도 빠져나갈 수 없었다 — 넘치는 건 본문이었다.
    const page = extractedPage(8000);
    const ctx = buildContext(ask(1), 2048, page);

    expect(() => send(ctx, 2048)).not.toThrow();
    expect(ctx[1]!.content).toContain('<page_content>');
    // 본문이 실제로 줄었고, 그 사실이 블록 안에 적혀 있다.
    expect(ctx[1]!.content.length).toBeLessThan(page.text.length);
    expect(ctx[1]!.content).toContain('참고:');
  });

  it('대화가 길어져 트리밍이 걸려도 통과한다', () => {
    // 트리밍이 실제로 동작하는 구간이 위험했다. 조립기가 싼 자로 재서
    // 남긴 이력을 게이트가 비싼 자로 다시 재면 그만큼 초과로 잡혔다.
    for (const turns of [2, 10, 40, 120]) {
      const ctx = buildContext(ask(turns), 4096, extractedPage(2000));
      expect(() => send(ctx, 4096)).not.toThrow();
    }
  });

  it('여러 설정 조합에서 예외 없이 통과한다', () => {
    for (const numCtx of [2048, 4096, 8192, 32768]) {
      for (const pageBudget of [500, 2000, 8000]) {
        for (const shot of [null, 'B64']) {
          const ctx = buildContext(ask(12), numCtx, {
            page: extractedPage(pageBudget),
            screenshot: shot,
          });
          expect(
            () => send(ctx, numCtx),
            `numCtx=${numCtx} page=${pageBudget} shot=${Boolean(shot)}`,
          ).not.toThrow();
        }
      }
    }
  });

  it('★ 에이전트의 도구 스키마까지 합쳐도 통과한다', () => {
    // 도구 8종은 메시지 밖 비용이라 조립기가 모르면 게이트만 보게 된다.
    const reserved = promptTokens([], AGENT_TOOLS);
    const ctx = buildContext(ask(8), 4096, extractedPage(2000), '에이전트 지침', reserved);

    expect(() => send(ctx, 4096, AGENT_TOOLS)).not.toThrow();
  });
});

describe('fitAttachment', () => {
  const page = extractedPage(2000);

  it('예산에 들어가면 첨부를 건드리지 않는다 (KV 접두사 보존)', () => {
    const att = { page, screenshot: null };
    expect(fitAttachment(att, 8192)).toBe(att);
  });

  it('멱등이다 — 두 번 맞춰도 결과가 같다', () => {
    const once = fitAttachment({ page: extractedPage(8000), screenshot: null }, 2048);
    const twice = fitAttachment(once, 2048);
    expect(twice.page!.text).toBe(once.page!.text);
    expect(twice.page!.keptRatio).toBe(once.page!.keptRatio);
  });

  it('★ 대화 길이와 무관하다 — 턴이 늘어도 접두사가 바이트 단위로 같다', () => {
    // 절단 위치가 대화에 따라 움직이면 턴마다 페이지를 다시 프리필한다
    // (실측 183ms → 7,684ms). 이걸 막으려고 fitAttachment는 이력을 안 본다.
    const big = extractedPage(8000);
    const short = buildContext(ask(2), 2048, big, 'SYS');
    const long = buildContext(ask(60), 2048, big, 'SYS');

    expect(long.slice(0, 3)).toEqual(short.slice(0, 3));
  });

  it('추출 단계의 절단과 합쳐 원문 대비 비율을 고지한다', () => {
    const half = { ...page, truncated: true, keptRatio: 0.5 };
    const fitted = fitAttachment({ page: half, screenshot: null }, 2048).page!;

    expect(fitted.truncated).toBe(true);
    // 원문의 절반만 받은 상태에서 다시 줄었으므로 0.5보다 작아야 한다.
    expect(fitted.keptRatio!).toBeLessThan(0.5);
    expect(fitted.keptRatio!).toBeGreaterThan(0);
  });

  it('대화 몫을 남긴다 — 고정 블록이 예산 전부를 먹지 않는다', () => {
    const fitted = fitAttachment({ page: extractedPage(8000), screenshot: null }, 4096);
    const pinnedCost = promptTokens(buildContext([], 4096, fitted, 'SYS'));

    expect(pinnedCost).toBeLessThanOrEqual(promptBudget(4096) - CONTEXT_RESERVE_TOKENS);
  });
});
