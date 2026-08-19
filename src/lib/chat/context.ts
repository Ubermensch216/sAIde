/**
 * 모델에 보낼 컨텍스트 구성. 계획서 §5 Phase 2–3 / §6
 *
 * ★ 이 파일이 프리필 비용을 직접 결정한다. 두 가지 실측이 설계를 지배한다.
 *
 * ① 프리필은 131 tok/s다.
 *    컨텍스트에 1,000토큰을 더 넣는다는 것은 사용자를 8초 더 기다리게 한다는 뜻.
 *
 * ② Ollama는 접두사가 같으면 KV 캐시를 재사용한다. (2026-08-19 실측)
 *      1턴 (페이지 접두사 최초)      프리필 7,684ms
 *      2턴 (접두사 동일, 뒤에만 추가)  프리필   183ms  ← 42배
 *      3턴 (시스템 프롬프트 한 단어 변경) 프리필 8,360ms  ← 전액 재지불
 *
 *    그래서 **앞부분을 절대 건드리지 않는 것**이 이 파일의 제1원칙이다.
 *    시스템 프롬프트와 페이지 본문은 고정(pinned)하고, 잘라낼 때는 그 뒤의
 *    오래된 대화 턴만 버린다.
 */

import type { ChatMessage } from '@/types/ollama';
import { PAGE_ACK, SYSTEM_PROMPT, wrapPageContent } from '@/lib/prompts/system';

export interface ContextInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 진행 중인 스트리밍 자리표시자는 컨텍스트에 넣지 않는다. */
  streaming?: boolean;
}

/** 컨텍스트에 붙일 페이지. 한 대화에 하나만 고정된다. */
export interface AttachedPage {
  url: string;
  title: string;
  text: string;
  truncated?: boolean;
  keptRatio?: number;
}

/**
 * 프롬프트가 num_ctx를 다 먹으면 답할 자리가 없다.
 * 생성 여유를 남기기 위해 컨텍스트의 70%만 프롬프트에 쓴다.
 */
export const PROMPT_BUDGET_RATIO = 0.7;

/** 대략적인 토큰 환산. 한/영 혼재를 감안한 보수적 값. */
function costOf(m: { content: string }): number {
  return Math.ceil(m.content.length / 2.5);
}

/**
 * 오래된 턴부터 버려 예산 안에 맞춘다.
 *
 * @param pinnedCount 앞에서부터 절대 버리지 않을 메시지 수.
 *   시스템 프롬프트(1) + 페이지가 붙었으면 본문·확인 응답(2) = 최대 3.
 *   이걸 버리면 인젝션 가드가 사라지고, 페이지 KV 캐시도 무효화된다.
 */
export function trimToContext(
  messages: ChatMessage[],
  numCtx: number,
  pinnedCount = 1,
): ChatMessage[] {
  if (messages.length === 0) return [];

  const budget = Math.floor(numCtx * PROMPT_BUDGET_RATIO);
  const pinned = messages.slice(0, pinnedCount);
  const rest = messages.slice(pinnedCount);

  let total = pinned.reduce((s, m) => s + costOf(m), 0);
  const kept: ChatMessage[] = [];

  // 최신 것부터 담는다. 오래된 턴이 먼저 밀려난다.
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i]!;
    const c = costOf(m);
    if (total + c > budget && kept.length > 0) break;
    total += c;
    kept.unshift(m);
  }

  return [...pinned, ...kept];
}

/**
 * 대화 이력을 Ollama 메시지 배열로 만든다.
 *
 * 배치 순서가 성능을 결정한다:
 *   [0] 시스템 프롬프트  — 상수
 *   [1] 페이지 본문      — 페이지가 붙어 있으면. 대화 내내 동일
 *   [2] 확인 응답        — 고정 문구
 *   [3…] 대화 턴         — 여기만 늘어나고, 넘치면 여기서만 버린다
 *
 * ★ thinking은 다시 넣지 않는다. 이전 턴의 추론 텍스트(실측 1,077자)를
 *   컨텍스트에 쌓으면 프리필 토큰이 턴마다 불어난다. 모델도 자기 사고 과정을
 *   다시 볼 필요가 없다.
 */
export function buildContext(
  messages: ContextInput[],
  numCtx: number,
  page?: AttachedPage | null,
  systemPrompt: string = SYSTEM_PROMPT,
): ChatMessage[] {
  const ctx: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  if (page) {
    ctx.push({ role: 'user', content: wrapPageContent(page) });
    ctx.push({ role: 'assistant', content: PAGE_ACK });
  }
  const pinnedCount = page ? 3 : 1;

  for (const m of messages) {
    if (m.streaming) continue;
    if (m.role === 'system') continue;
    if (!m.content) continue;
    ctx.push({ role: m.role, content: m.content });
  }

  return trimToContext(ctx, numCtx, pinnedCount);
}

/** 이 컨텍스트의 예상 프리필 대기시간(초). UI 경고에 쓴다. */
export function estimatePrefillSeconds(
  messages: ChatMessage[],
  prefillTokPerSec = 131,
): number {
  const tokens = messages.reduce((sum, m) => sum + costOf(m), 0);
  return Math.round((tokens / prefillTokPerSec) * 10) / 10;
}

/**
 * 이번 요청에서 실제로 프리필해야 할 부분만 센다.
 *
 * 직전 요청과 접두사가 겹치면 그만큼은 캐시에서 나온다. UI가 "약 15초"라고
 * 겁주는 대신 실제에 가까운 예상치를 보여주기 위한 계산이다.
 */
export function uncachedPrefillSeconds(
  prev: ChatMessage[] | null,
  next: ChatMessage[],
  prefillTokPerSec = 131,
): number {
  let shared = 0;
  if (prev) {
    const n = Math.min(prev.length, next.length);
    for (let i = 0; i < n; i++) {
      const a = prev[i]!;
      const b = next[i]!;
      if (a.role !== b.role || a.content !== b.content) break;
      shared += costOf(b);
    }
  }
  const total = next.reduce((s, m) => s + costOf(m), 0);
  return Math.round((Math.max(0, total - shared) / prefillTokPerSec) * 10) / 10;
}
