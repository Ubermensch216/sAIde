/**
 * 자유 입력의 페이지 지칭 판정 테스트.
 *
 * 거짓 음성이면 모델이 "어떤 페이지인지 알려주세요"라고 되묻고, 거짓 양성이면
 * 필요 없는 본문 읽기(수 초~수십 초)와 권한 요청이 붙는다. 양쪽 경계를 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { refersToCurrentPage } from './page-reference';

describe('refersToCurrentPage', () => {
  it.each([
    '이 페이지의 내용을 이해한 다음, 중학생 수준에 맞춰 알기 쉽고 자세하게 설명해줘.',
    '이 페이지 요약해줘',
    '현재 페이지에서 날짜만 뽑아줘',
    '이 기사를 세 줄로',
    '이 글 번역해줘',
    '해당 문서에 결론이 뭐야?',
    '지금 보고 있는 페이지가 뭐에 대한 거야',
    'Summarize this page',
    'what does this article say?',
    'Translate the current page into Korean',
  ])('페이지를 가리킨다: %s', (text) => {
    expect(refersToCurrentPage(text)).toBe(true);
  });

  it.each([
    '',
    '   ',
    '안녕',
    '파이썬으로 파일 읽는 법 알려줘',
    '이 글자는 무슨 뜻이야',
    '문서화 방법을 알려줘',
    '페이지네이션 구현해줘',
    'how do I write a page object in selenium',
  ])('가리키지 않는다: %s', (text) => {
    expect(refersToCurrentPage(text)).toBe(false);
  });

  it('슬래시·@ 명령은 자기 경로가 처리한다', () => {
    expect(refersToCurrentPage('/summary 이 페이지')).toBe(false);
    expect(refersToCurrentPage('@일정 이 페이지에서')).toBe(false);
  });
});
