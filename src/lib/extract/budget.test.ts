/**
 * 토큰 예산 테스트. 계획서 §9
 *
 * 이 모듈이 틀리면 사용자가 2분을 기다리거나(예산 초과), 모델이 본문을 거의
 * 못 보게 된다(과도한 절단). 실측 비율을 기준선으로 고정한다.
 */

import { describe, expect, it } from 'vitest';
import {
  estimateCharsPerToken,
  estimateTokens,
  fitToBudget,
  normalizeWhitespace,
  truncationNotice,
} from './budget';

const KO = '로컬에서 동작하는 대규모 언어 모델은 사용자의 데이터를 외부로 보내지 않는다. ';
const EN = 'Local language models keep user data on the machine and never send it out. ';
const NAV = ['정치', '경제', '사회', '생활/문화', 'IT/과학', '세계', '랭킹', '신문보기', '오피니언', 'TV', '팩트체크'];
/** Readability가 뉴스 페이지에서 돌려주는 모양 — 빈 줄·탭·날짜가 본문 앞에 몰려 있다. */
const MESSY = Array.from({ length: 30 }, (_, i) =>
  `\n \n \n\t${NAV[i % NAV.length]}\n \n\t\t입력 2026.10.${String(i % 28 + 1).padStart(2, '0')}. 오후 4:21\n \n`,
).join('') + KO.repeat(20);

describe('estimateTokens', () => {
  /**
   * gemma4:e2b 실측값(2026-10-14, Ollama prompt_eval_count).
   *
   * ★ 과소추정이 치명적이다. 넘친 요청에서 Ollama는 본문 메시지를 오류 없이 버리고,
   *   모델은 "페이지 내용이 제공되지 않았다"고 답한다. 그래서 하한은 빡빡하게,
   *   상한은 너그럽게 둔다 — 넘치게 재면 본문이 조금 더 잘릴 뿐이다.
   */
  it.each([
    ['한국어 산문', KO.repeat(40), 801],
    ['영문 산문', EN.repeat(40), 601],
    ['빈 줄·날짜가 섞인 기사 추출본', MESSY, 1428],
  ])('%s: 실측보다 작게 재지 않는다', (_label, text, real) => {
    const est = estimateTokens(text);
    expect(est).toBeGreaterThanOrEqual(real * 0.95);
    expect(est).toBeLessThan(real * 1.7);
  });

  it('공백·숫자를 한글보다 싸게 치지 않는다', () => {
    // 예전 추정은 한글이 아닌 글자를 모두 4자/토큰으로 쳐서 기사 하나를 2.5배 작게 쟀다.
    expect(estimateTokens('\n \n \n \n')).toBeGreaterThanOrEqual(estimateTokens('가나다라마바사'));
    expect(estimateTokens('2026.10.12')).toBeGreaterThan(5);
  });

  it('빈 문자열에서 터지지 않는다', () => {
    expect(estimateCharsPerToken('')).toBe(4.0);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('normalizeWhitespace', () => {
  it('빈 줄과 탭 들여쓰기를 걷어내고 내용은 남긴다', () => {
    const out = normalizeWhitespace('언론사별\n \n \n\t정치\n \n\t\t입력 2026.10.12.  오후 4:21\r\n\n\n본문');
    expect(out).toBe('언론사별\n\n정치\n\n입력 2026.10.12. 오후 4:21\n\n본문');
  });

  it('토큰을 실제로 줄인다', () => {
    expect(estimateTokens(normalizeWhitespace(MESSY))).toBeLessThan(estimateTokens(MESSY) * 0.85);
  });
});

describe('fitToBudget', () => {
  it('예산 안에 드는 본문은 건드리지 않는다', () => {
    const r = fitToBudget(KO, 2000);
    expect(r.truncated).toBe(false);
    expect(r.keptRatio).toBe(1);
    expect(r.text).toBe(KO.trim());
  });

  it('예산을 넘으면 자르고 절단을 표시한다', () => {
    const r = fitToBudget(KO.repeat(200), 2000);
    expect(r.truncated).toBe(true);
    expect(r.keptRatio).toBeLessThan(1);
    expect(r.estimatedTokens).toBeLessThanOrEqual(2000);
  });

  it('절단 결과가 실제로 예산을 지킨다', () => {
    // 예산을 못 지키면 사용자가 예고 없이 오래 기다리게 된다.
    for (const budget of [200, 500, 1000, 2000, 4000]) {
      const r = fitToBudget(KO.repeat(500), budget);
      expect(r.estimatedTokens).toBeLessThanOrEqual(budget);
    }
  });

  it('앞쪽이 촘촘한 글도 예산을 지킨다', () => {
    // 평균 비율로 한 번에 자르면 날짜·메뉴가 몰린 머리 부분에서 넘친다.
    const text = '2026.10.12. 4:21 · '.repeat(300) + KO.repeat(300);
    for (const budget of [200, 500, 2000]) {
      expect(fitToBudget(text, budget).estimatedTokens).toBeLessThanOrEqual(budget);
    }
  });

  it('문장 경계에서 자른다', () => {
    const r = fitToBudget(KO.repeat(200), 500);
    // 한국어 문장은 '다.'로 끝난다. 중간에 뚝 끊기면 요약 품질이 나빠진다.
    expect(r.text.trimEnd().endsWith('다.')).toBe(true);
  });

  it('경계가 너무 앞이면 문자 단위로 자른다 (과도한 손실 방지)', () => {
    // 문장 부호가 전혀 없는 본문
    const noBoundary = '가'.repeat(10000);
    const r = fitToBudget(noBoundary, 100);
    expect(r.truncated).toBe(true);
    // 경계가 없다고 빈 문자열이 되면 안 된다
    expect(r.text.length).toBeGreaterThan(100);
  });

  it('빈 입력을 안전하게 처리한다', () => {
    const r = fitToBudget('   ', 2000);
    expect(r.text).toBe('');
    expect(r.truncated).toBe(false);
    expect(r.estimatedTokens).toBe(0);
  });
});

describe('truncationNotice', () => {
  it('절단되지 않았으면 아무것도 알리지 않는다', () => {
    expect(truncationNotice(fitToBudget(KO, 2000))).toBeNull();
  });

  it('절단되었으면 비율을 알린다', () => {
    // 계획서 §6 완료 기준: "절단 발생 시 사용자에게 항상 고지"
    const notice = truncationNotice(fitToBudget(KO.repeat(200), 500));
    expect(notice).toMatch(/앞부분 \d+%/);
  });
});
