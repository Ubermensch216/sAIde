/**
 * 컨텍스트 구성 테스트. 계획서 §9
 *
 * 이 로직이 틀리면 증상이 조용하다 — 대화가 길어질수록 응답이 점점 느려지거나,
 * 반대로 모델이 직전 발언을 기억하지 못한다. 둘 다 사용자가 원인을 짚기 어렵다.
 */

import { describe, expect, it } from 'vitest';
import {
  buildContext,
  estimatePrefillSeconds,
  trimToContext,
  PROMPT_BUDGET_RATIO,
  type ContextInput,
} from './context';
import type { ChatMessage } from '@/types/ollama';

const sys = (content = 'SYSTEM'): ChatMessage => ({ role: 'system', content });
const turn = (role: 'user' | 'assistant', content: string): ChatMessage => ({ role, content });

describe('trimToContext', () => {
  it('예산 안에 들면 그대로 둔다', () => {
    const msgs = [sys(), turn('user', '안녕'), turn('assistant', '안녕하세요')];
    expect(trimToContext(msgs, 4096)).toHaveLength(3);
  });

  it('오래된 턴부터 버린다', () => {
    const long = '가'.repeat(2000); // 약 800토큰
    const msgs = [
      sys(),
      turn('user', `오래된-${long}`),
      turn('assistant', `오래된답변-${long}`),
      turn('user', `최신-${long}`),
    ];

    const kept = trimToContext(msgs, 2048); // 예산 1,433토큰

    expect(kept[0]!.role).toBe('system');
    // 최신 메시지는 반드시 남는다
    expect(kept[kept.length - 1]!.content).toContain('최신');
    // 오래된 것은 밀려났다
    expect(kept.some((m) => m.content.includes('오래된-'))).toBe(false);
  });

  it('시스템 프롬프트는 절대 버리지 않는다 (인젝션 가드가 들어 있다)', () => {
    const huge = '나'.repeat(50_000);
    const kept = trimToContext([sys('GUARD'), turn('user', huge)], 1024);
    expect(kept[0]!.content).toBe('GUARD');
  });

  it('최신 메시지가 예산을 넘어도 최소 1개는 남긴다 (빈 요청 방지)', () => {
    const huge = '다'.repeat(50_000);
    const kept = trimToContext([sys(), turn('user', huge)], 512);
    expect(kept).toHaveLength(2);
    expect(kept[1]!.content).toBe(huge);
  });

  it('빈 배열에서 터지지 않는다', () => {
    expect(trimToContext([], 4096)).toEqual([]);
  });

  it('num_ctx가 커지면 더 많이 담는다', () => {
    const msgs = [sys(), ...Array.from({ length: 40 }, (_, i) => turn('user', '라'.repeat(300) + i))];
    const small = trimToContext(msgs, 2048);
    const large = trimToContext(msgs, 16384);
    expect(large.length).toBeGreaterThan(small.length);
  });

  it('예산은 num_ctx의 70%다 (생성 여유를 남긴다)', () => {
    expect(PROMPT_BUDGET_RATIO).toBe(0.7);

    const msgs = [sys(''), ...Array.from({ length: 200 }, () => turn('user', '마'.repeat(250)))];
    const kept = trimToContext(msgs, 4096);
    const cost = kept.reduce((s, m) => s + Math.ceil(m.content.length / 2.5), 0);

    expect(cost).toBeLessThanOrEqual(Math.floor(4096 * 0.7));
  });
});

describe('buildContext', () => {
  const base: ContextInput[] = [
    { role: 'user', content: '질문' },
    { role: 'assistant', content: '답변' },
  ];

  it('시스템 프롬프트를 맨 앞에 넣는다', () => {
    const ctx = buildContext(base, 4096, 'SYS');
    expect(ctx[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('스트리밍 중인 자리표시자를 제외한다', () => {
    const ctx = buildContext(
      [...base, { role: 'assistant', content: '생성중...', streaming: true }],
      4096,
      'SYS',
    );
    expect(ctx.some((m) => m.content === '생성중...')).toBe(false);
  });

  it('빈 메시지를 넣지 않는다', () => {
    const ctx = buildContext([...base, { role: 'assistant', content: '' }], 4096, 'SYS');
    expect(ctx.every((m) => m.content.length > 0)).toBe(true);
  });

  it('저장된 system 역할 메시지를 중복으로 넣지 않는다', () => {
    const ctx = buildContext(
      [{ role: 'system', content: '옛날 시스템' }, ...base],
      4096,
      'SYS',
    );
    expect(ctx.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(ctx[0]!.content).toBe('SYS');
  });

  it('thinking을 컨텍스트에 되돌려 넣지 않는다', () => {
    // ContextInput에는 thinking 필드가 아예 없다 — 타입 수준에서 막는다.
    // 실측 1,077자짜리 추론 텍스트가 턴마다 쌓이면 프리필이 폭증한다.
    const ctx = buildContext(base, 4096, 'SYS');
    expect(JSON.stringify(ctx)).not.toContain('thinking');
  });
});

describe('estimatePrefillSeconds', () => {
  it('실측 처리량으로 대기시간을 환산한다', () => {
    // 약 2,000토큰 → 131 tok/s에서 약 15초
    const msgs = [sys(''), turn('user', '바'.repeat(5000))];
    const sec = estimatePrefillSeconds(msgs, 131);
    expect(sec).toBeGreaterThan(12);
    expect(sec).toBeLessThan(20);
  });

  it('GPU 처리량을 넣으면 훨씬 짧아진다 (하드웨어 이전 대비)', () => {
    const msgs = [sys(''), turn('user', '사'.repeat(5000))];
    expect(estimatePrefillSeconds(msgs, 1500)).toBeLessThan(
      estimatePrefillSeconds(msgs, 131),
    );
  });
});
