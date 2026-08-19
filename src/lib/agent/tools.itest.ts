/**
 * 툴 성공률 측정 — 계획서 §5 Phase 5-1 / 5-5 (완료 기준: 8종 × 10회, 80% 이상)
 *
 * 실제 Ollama와 `gemma4:e2b`를 대상으로 돈다. `npm run test:live`로만 실행되며
 * 기본 유닛 테스트에는 포함되지 않는다.
 *
 * ★ 무엇을 재는가: **도구 선택 정확도**다.
 *   사용자의 한 문장을 주고, 모델이 우리가 의도한 도구를 고르는지만 본다.
 *   실제 DOM 조작 성공률은 페이지마다 달라 자동화가 무의미하므로,
 *   그쪽은 수동 체크리스트(plan/phase5-tool-checklist.md)로 확인한다.
 *
 * ★ thinking은 기본으로 끈다.
 *   실사용 경로는 think:true지만(계획서 Phase 5), 80건을 thinking으로 돌리면
 *   30분 가까이 걸려 게이트로 쓰기 어렵다. 프로덕션과 동일 조건으로 재려면
 *   `SAIDE_AGENT_THINK=1 npm run test:live`로 실행한다.
 */

import { describe, expect, it } from 'vitest';
import { streamChat } from '@/lib/ollama/stream';
import { AGENT_GUIDE } from '@/lib/prompts/agent';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import type { ToolCall } from '@/types/ollama';
import { AGENT_TOOLS, parseToolCall, type ToolName } from './tools';

const EP = 'http://localhost:11434';
const MODEL = 'gemma4:e2b';
const THINK = process.env.SAIDE_AGENT_THINK === '1';

/** 계획서 5-5의 합격선. */
const PASS_RATE = 0.8;

/** 도구별 시나리오 10건씩. 사용자가 실제로 칠 법한 문장으로 쓴다. */
const SCENARIOS: Record<ToolName, string[]> = {
  read_page: [
    '이 페이지 내용 요약해줘',
    '지금 보고 있는 글이 무슨 내용이야?',
    '이 문서의 핵심만 세 줄로 알려줘',
    '이 기사에서 결론이 뭐야?',
    '페이지 본문을 읽고 설명해줘',
    '여기 쓰여 있는 내용 알려줘',
    '이 글쓴이가 주장하는 게 뭐야?',
    '이 페이지에 가격 정보가 있어?',
    '본문에서 날짜를 찾아줘',
    '이 문서 읽고 어려운 용어 정리해줘',
  ],
  find_element: [
    '이 페이지에 로그인 버튼이 있는지 찾아줘',
    '장바구니 담기 버튼이 어디 있어?',
    '검색창이 있는지 확인해줘',
    '구독 버튼 있어?',
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
    '지금 보이는 화면 그대로 확인해줘',
    '이 대시보드 화면 캡처해서 읽어줘',
    '화면에 뜬 그림이 뭔지 봐줘',
    '스크린샷 찍어서 설명해줘',
    '지금 보이는 표를 이미지로 확인해줘',
    '화면 캡처해서 오류 메시지 읽어줘',
    '눈에 보이는 화면 기준으로 설명해줘',
  ],
  scroll: [
    '페이지 아래로 좀 내려줘',
    '맨 아래까지 스크롤해줘',
    '위로 올려줘',
    '페이지 맨 위로 가줘',
    '조금만 더 내려봐',
    '화면 한 칸 내려줘',
    '아래쪽 내용을 보게 스크롤해',
    '스크롤 내려서 댓글 쪽으로 가줘',
    '맨 위로 돌아가줘',
    '페이지를 아래로 500픽셀 내려줘',
  ],
  click: [
    '로그인 버튼 눌러줘',
    '다음 버튼 클릭해',
    '"더 보기"를 눌러줘',
    '검색 버튼 클릭해줘',
    '#submit 요소를 클릭해',
    '동의 버튼 눌러줘',
    '첫 번째 검색 결과를 클릭해',
    '메뉴 버튼 눌러봐',
    '닫기 버튼 클릭해줘',
    '재생 버튼 눌러줘',
  ],
  type_text: [
    '검색창에 "사이드"라고 입력해줘',
    '아이디 칸에 test라고 써줘',
    '댓글창에 "감사합니다"라고 입력해',
    '검색어로 날씨를 넣어줘',
    '이메일 입력칸에 a@b.com 입력해줘',
    '메모칸에 회의록이라고 적어줘',
    '#q 에 hello 를 입력해',
    '입력칸에 서울이라고 타이핑해줘',
    '제목 칸에 테스트라고 넣어줘',
    '주소 입력란에 강남대로라고 써줘',
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

/** 한 문장을 주고 모델이 고른 첫 도구를 돌려준다. */
async function pickTool(prompt: string): Promise<{ name: string | null; ms: number }> {
  const calls: ToolCall[] = [];
  const t0 = Date.now();

  await streamChat(
    EP,
    {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: AGENT_GUIDE },
        { role: 'user', content: prompt },
      ],
      stream: true,
      think: THINK,
      keep_alive: '10m',
      tools: AGENT_TOOLS,
      options: { num_ctx: 4096, temperature: 0 },
    },
    { onToolCall: (c) => calls.push(c) },
  );

  const first = calls[0];
  if (!first) return { name: null, ms: Date.now() - t0 };

  // 인자 검증까지 통과해야 "성공"이다. 이름만 맞고 인자가 없으면 실행할 수 없다.
  const parsed = parseToolCall(first);
  return { name: parsed.ok ? parsed.action.kind : null, ms: Date.now() - t0 };
}

describe('에이전트 툴 (실서버)', () => {
  it('5-1: /api/chat이 툴 스키마 8종을 거부 없이 수락한다', async () => {
    const calls: ToolCall[] = [];
    const perf = await streamChat(
      EP,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'system', content: AGENT_GUIDE },
          { role: 'user', content: '이 페이지 내용을 읽어줘' },
        ],
        stream: true,
        think: false,
        tools: AGENT_TOOLS,
        options: { num_ctx: 4096, temperature: 0 },
      },
      { onToolCall: (c) => calls.push(c) },
    );

    console.log('  스키마 프리필 토큰:', perf?.promptTokens, '| 도구 호출:', calls.length);
    expect(perf).not.toBeNull();
  }, 180_000);

  /**
   * 계획서 5-5 완료 기준. 80건이라 오래 걸린다(think:false 기준 약 6~10분).
   * 실패해도 어떤 시나리오가 어떤 도구로 새는지 로그로 남긴다 — 스키마 설명을
   * 고칠 근거가 되기 때문이다.
   */
  it(
    '5-5: 도구 선택 정확도가 80% 이상이다',
    async () => {
      const rows: Array<{ want: string; got: string | null; ms: number; prompt: string }> = [];

      for (const [want, prompts] of Object.entries(SCENARIOS) as Array<[ToolName, string[]]>) {
        for (const prompt of prompts) {
          const { name, ms } = await pickTool(prompt);
          rows.push({ want, got: name, ms, prompt });
        }
        const hit = rows.filter((r) => r.want === want && r.got === want).length;
        console.log(`  ${want.padEnd(13)} ${hit}/10`);
      }

      const ok = rows.filter((r) => r.want === r.got);
      const rate = ok.length / rows.length;
      const avgMs = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length);

      console.log(`\n  전체 ${ok.length}/${rows.length} = ${(rate * 100).toFixed(1)}%`);
      console.log(`  턴당 평균 ${(avgMs / 1000).toFixed(1)}초 · thinking ${THINK ? 'ON' : 'OFF'}`);
      console.log('\n  빗나간 경우:');
      for (const r of rows.filter((x) => x.want !== x.got)) {
        console.log(`   ${r.want} → ${r.got ?? '(도구 없음)'} : ${r.prompt}`);
      }

      expect(rate).toBeGreaterThanOrEqual(PASS_RATE);
    },
    // 80건 × 최악 20초 + thinking 여유
    2_400_000,
  );
});
