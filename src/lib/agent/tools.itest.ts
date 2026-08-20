/**
 * 툴 성공률 측정 — 계획서 §5 Phase 5-1 / 5-5 (완료 기준: 8종 × 10회, 80% 이상)
 *
 * 실제 Ollama와 `gemma4:e2b`를 대상으로 돈다. `npm run test:live`로만 실행되며
 * 기본 유닛 테스트에는 포함되지 않는다.
 *
 * ★ 측정 조건이 실사용과 같아야 한다. 1차 측정(2026-08-19)에서 18.75%가 나왔고,
 *   원인은 모델이 아니라 **측정 방법**이었다.
 *
 *   ① 현재 탭 정보를 주지 않았다 → 모델이 "어떤 페이지를 말씀하시는 건가요?"라고
 *      되묻고 도구를 부르지 않았다. 정당한 반응이다. 그래서 실제 구현에도
 *      `currentTabNote`를 넣었고(prompts/agent.ts), 측정도 같은 컨텍스트로 한다.
 *   ② 한 턴만 보고 채점했다 → "로그인 버튼 눌러줘"에 모델이 `read_page`부터 부르는
 *      것은 AGENT_GUIDE 3번이 시킨 **올바른** 순서다. 그래서 루프를 실제로 돌리고
 *      **여러 턴 안에 의도한 도구에 도달했는가**로 채점한다.
 *
 * ★ thinking은 기본으로 끈다. 실사용 경로는 think:true지만(계획서 Phase 5)
 *   80건을 thinking으로 돌리면 30분을 넘겨 게이트로 쓰기 어렵다. 프로덕션과
 *   동일 조건으로 재려면 `SAIDE_AGENT_THINK=1 npm run test:live`로 실행한다.
 */

import { describe, expect, it } from 'vitest';
import { buildContext } from '@/lib/chat/context';
import { streamChat } from '@/lib/ollama/stream';
import { buildAgentSystem } from '@/lib/prompts/agent';
import type { ToolCall } from '@/types/ollama';
import { runAgentLoop, type ToolOutcome, type TurnResult } from './loop';
import { AGENT_TOOLS, type AgentAction, type ToolName } from './tools';

const EP = 'http://localhost:11434';
const MODEL = 'gemma4:e2b';
const THINK = process.env.SAIDE_AGENT_THINK === '1';
const NUM_CTX = 4096;

/** 계획서 5-5의 합격선. */
const PASS_RATE = 0.8;

/** 측정용 가상 탭. 실제 패널이 넘기는 것과 같은 형태다. */
const TAB = { title: '사이드 데모 상점 — 무선 이어폰', url: 'https://shop.example.com/item/42' };

/** read_page가 돌려줄 가상 본문. 클릭·입력 대상이 실제로 존재하도록 써 둔다. */
const PAGE_TEXT = `사이드 데모 상점 — 무선 이어폰 (89,000원)
재고 있음. 무료 배송.
화면에는 다음 요소가 있다: [검색창], [로그인] 버튼, [장바구니 담기] 버튼,
[구매하기] 버튼, [댓글 입력칸], [다음 페이지] 링크.
아래쪽에는 사용자 리뷰 120건이 있다.`;

const SCENARIOS: Record<ToolName, string[]> = {
  read_page: [
    '이 페이지 내용 요약해줘',
    '지금 보고 있는 글이 무슨 내용이야?',
    '이 문서의 핵심만 세 줄로 알려줘',
    '이 페이지에서 결론이 뭐야?',
    '페이지 본문을 읽고 설명해줘',
    '여기 쓰여 있는 내용 알려줘',
    '이 페이지에 가격 정보가 있어?',
    '본문에서 배송 조건을 찾아줘',
    '이 페이지 읽고 어려운 용어 정리해줘',
    '지금 페이지에 뭐라고 적혀 있어?',
  ],
  find_element: [
    '이 페이지에 로그인 버튼이 있는지 찾아줘',
    '장바구니 담기 버튼이 어디 있어?',
    '검색창이 있는지 확인해줘',
    '구매하기 버튼 있어?',
    '다음 페이지로 가는 링크를 찾아줘',
    '댓글 입력칸이 있는지 봐줘',
    '설정 메뉴가 있는지 찾아봐',
    '"동의합니다" 체크박스 있는지 확인해',
    '회원가입 링크 찾아줘',
    '파일 업로드 버튼이 있어?',
  ],
  list_tabs: [
    '지금 열려 있는 탭들 알려줘',
    '내가 몇 개의 탭을 열어놨어?',
    '열린 탭 목록 보여줘',
    '탭 중에 유튜브 있어?',
    '다른 탭에는 뭐가 열려 있어?',
    '창에 열린 페이지들 정리해줘',
    '탭 제목들 나열해줘',
    '지금 브라우저에 뭐뭐 열려 있는지 확인해줘',
    '열려 있는 탭 주소들 알려줘',
    '탭이 너무 많은데 목록 좀 뽑아줘',
  ],
  screenshot: [
    '지금 화면 캡처해서 뭐가 보이는지 알려줘',
    '이 화면에 보이는 그래프를 설명해줘',
    '화면을 보고 이 차트가 무슨 뜻인지 말해줘',
    '화면 캡처해서 확인해줘',
    '이 대시보드 화면을 이미지로 봐줘',
    '화면에 뜬 그림이 뭔지 봐줘',
    '스크린샷 찍어서 설명해줘',
    '지금 보이는 표를 이미지로 확인해줘',
    '화면 캡처해서 오류 메시지 읽어줘',
    '눈에 보이는 화면을 캡처해서 알려줘',
  ],
  scroll: [
    '페이지 아래로 좀 내려줘',
    '맨 아래까지 스크롤해줘',
    '위로 올려줘',
    '페이지 맨 위로 가줘',
    '조금만 더 내려봐',
    '화면 한 칸 내려줘',
    '아래쪽 내용을 보게 스크롤해',
    '스크롤 내려서 리뷰 쪽으로 가줘',
    '맨 위로 돌아가줘',
    '페이지를 아래로 500픽셀 내려줘',
  ],
  click: [
    '로그인 버튼 눌러줘',
    '장바구니 담기 버튼 클릭해',
    '"구매하기"를 눌러줘',
    '검색 버튼 클릭해줘',
    '#submit 요소를 클릭해',
    '다음 페이지 링크 눌러줘',
    '첫 번째 리뷰를 클릭해',
    '메뉴 버튼 눌러봐',
    '닫기 버튼 클릭해줘',
    '로그인을 클릭해',
  ],
  type_text: [
    '검색창에 "사이드"라고 입력해줘',
    '검색창에 이어폰이라고 써줘',
    '댓글 입력칸에 "감사합니다"라고 입력해',
    '검색어로 날씨를 넣어줘',
    '댓글칸에 잘 받았습니다 라고 적어줘',
    '#q 에 hello 를 입력해',
    '검색창에 서울이라고 타이핑해줘',
    '댓글 입력칸에 테스트라고 넣어줘',
    '검색창을 비우고 무선이어폰이라고 써줘',
    '입력칸에 강남대로라고 써줘',
  ],
  navigate: [
    'https://example.com 으로 이동해줘',
    '구글 홈페이지로 가줘 (https://www.google.com)',
    'https://news.ycombinator.com 열어줘',
    '이 주소로 이동: https://ollama.com',
    'https://github.com 으로 옮겨줘',
    '네이버(https://www.naver.com)로 가줘',
    'https://example.org/docs 페이지를 열어줘',
    '주소창에 https://wikipedia.org 넣고 이동해',
    'https://developer.mozilla.org 로 이동',
    '이 탭에서 https://vitest.dev 를 열어줘',
  ],
};

/** 실제 실행 대신 그럴듯한 결과를 돌려주는 스텁. 모델의 다음 판단을 위한 재료다. */
async function stubExecute(action: AgentAction): Promise<ToolOutcome> {
  switch (action.kind) {
    case 'read_page':
      return { ok: true, detail: PAGE_TEXT };
    case 'find_element':
      return { ok: true, detail: `찾음: <button> "${action.query}"` };
    case 'list_tabs':
      return { ok: true, detail: '1. 사이드 데모 상점 (현재 탭) — https://shop.example.com/item/42' };
    case 'screenshot':
      return { ok: true, detail: '화면을 캡처했다.' }; // 이미지는 붙이지 않는다(측정 비용)
    case 'scroll':
      return { ok: true, detail: `${action.direction} 방향으로 스크롤했습니다.` };
    case 'click':
      return { ok: true, detail: `클릭했습니다: ${action.selector}` };
    case 'type_text':
      return { ok: true, detail: `입력했습니다: ${action.text}` };
    case 'navigate':
      return { ok: true, detail: `${action.url} 로 이동했습니다.` };
  }
}

/** 실사용과 같은 컨텍스트로 루프를 돌리고, 사용한 도구 목록을 돌려준다. */
async function runScenario(prompt: string, maxTurns: number) {
  const seed = buildContext(
    [{ role: 'user', content: prompt }],
    NUM_CTX,
    null,
    buildAgentSystem(TAB),
  );

  const t0 = Date.now();
  const outcome = await runAgentLoop(
    seed,
    {
      chat: async (messages, handlers, signal): Promise<TurnResult> => {
        let content = '';
        let thinking = '';
        const toolCalls: ToolCall[] = [];
        const perf = await streamChat(
          EP,
          {
            model: MODEL,
            messages,
            stream: true,
            think: THINK,
            keep_alive: '10m',
            tools: AGENT_TOOLS,
            options: { num_ctx: NUM_CTX, temperature: 0 },
          },
          {
            onToken: (t) => {
              content += t;
              handlers.onToken?.(t);
            },
            onThinking: (t) => {
              thinking += t;
              handlers.onThinking?.(t);
            },
            onToolCall: (c) => toolCalls.push(c),
          },
          signal,
        );
        return { content, thinking, toolCalls, perf };
      },
      execute: stubExecute,
      // ★ 승인 게이트 자체는 loop.test.ts에서 검증한다. 여기서 재는 것은
      //   "의도한 도구에 도달하는가"이므로 승인은 통과시킨다.
      approve: async () => true,
      currentPage: () => TAB,
    },
    { maxTurns },
  );

  return {
    tools: outcome.steps.map((s) => s.tool),
    stopReason: outcome.stopReason,
    ms: Date.now() - t0,
  };
}

describe('에이전트 툴 (실서버)', () => {
  it('5-1: /api/chat이 툴 스키마 8종을 거부 없이 수락한다', async () => {
    const calls: ToolCall[] = [];
    const perf = await streamChat(
      EP,
      {
        model: MODEL,
        messages: buildContext(
          [{ role: 'user', content: '이 페이지 내용을 읽어줘' }],
          NUM_CTX,
          null,
          buildAgentSystem(TAB),
        ),
        stream: true,
        think: false,
        tools: AGENT_TOOLS,
        options: { num_ctx: NUM_CTX, temperature: 0 },
      },
      { onToolCall: (c) => calls.push(c) },
    );

    console.log('  스키마 포함 프리필:', perf?.promptTokens, '토큰 | 도구 호출:', calls.length);
    expect(perf).not.toBeNull();
    // 스키마를 거부하면 400이 떨어져 streamChat이 던진다. 여기 도달하면 수락된 것.
    expect(perf!.promptTokens).toBeGreaterThan(0);
  }, 180_000);

  it(
    '5-5: 도구 선택 정확도가 80% 이상이다',
    async () => {
      const maxTurns = 3;
      const rows: Array<{
        want: ToolName;
        used: string[];
        hit: boolean;
        first: boolean;
        ms: number;
        prompt: string;
      }> = [];

      for (const [want, prompts] of Object.entries(SCENARIOS) as Array<[ToolName, string[]]>) {
        for (const prompt of prompts) {
          const r = await runScenario(prompt, maxTurns);
          rows.push({
            want,
            used: r.tools,
            hit: r.tools.includes(want),
            first: r.tools[0] === want,
            ms: r.ms,
            prompt,
          });
        }
        const group = rows.filter((x) => x.want === want);
        const hit = group.filter((x) => x.hit).length;
        const first = group.filter((x) => x.first).length;
        console.log(`  ${want.padEnd(13)} 도달 ${hit}/10 · 첫 턴 ${first}/10`);
      }

      const hits = rows.filter((r) => r.hit);
      const rate = hits.length / rows.length;
      const firstRate = rows.filter((r) => r.first).length / rows.length;
      const avgMs = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length);

      console.log(`\n  도달률 ${hits.length}/${rows.length} = ${(rate * 100).toFixed(1)}%`);
      console.log(`  첫 턴 정확도 ${(firstRate * 100).toFixed(1)}%`);
      console.log(`  시나리오당 평균 ${(avgMs / 1000).toFixed(1)}초 · thinking ${THINK ? 'ON' : 'OFF'}`);
      console.log('\n  실패한 시나리오:');
      for (const r of rows.filter((x) => !x.hit)) {
        console.log(`   ${r.want} → [${r.used.join(', ') || '도구 없음'}] : ${r.prompt}`);
      }

      expect(rate).toBeGreaterThanOrEqual(PASS_RATE);
    },
    // 80건 × (최대 3턴). thinking ON이면 훨씬 오래 걸린다.
    3_600_000,
  );
});
