// @vitest-environment jsdom
/**
 * 선택 영역 읽기 테스트.
 *
 * ★ 여기가 비면 증상이 조용하다 — 사용자는 문단을 골라 놓고 "선택한 부분"을
 *   물었는데, 모델은 아무것도 못 받은 채 페이지 전체나 빈 문맥으로 답한다.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readSelection } from './selection';

function select(node: Node, doc: Document = document) {
  const range = doc.createRange();
  range.selectNodeContents(node);
  const sel = doc.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.getSelection()?.removeAllRanges();
});

describe('readSelection', () => {
  it('선택이 없으면 빈 문자열이다', () => {
    document.body.innerHTML = '<p>본문 전체</p>';
    // 페이지 본문으로 슬쩍 갈아타지 않는다 — 고른 적 없는 토큰을 물릴 수 없다.
    expect(readSelection()).toBe('');
  });

  it('드래그한 문단만 돌려준다', () => {
    document.body.innerHTML = '<p id="a">첫 문단</p><p id="b">둘째 문단</p>';
    select(document.getElementById('b')!);
    expect(readSelection()).toBe('둘째 문단');
  });

  it('공백과 빈 줄을 정리한다', () => {
    document.body.innerHTML = '<p id="a">앞   뒤</p>';
    select(document.getElementById('a')!);
    expect(readSelection()).toBe('앞 뒤');
  });

  it('읽기 전용 편집기(textarea) 안의 선택도 읽는다', () => {
    // 본문을 textarea에 넣어 두는 화면이 있다. 여기 선택은 getSelection()에 잡히지 않는다.
    document.body.innerHTML = '<textarea id="t">앞부분 고른부분 뒷부분</textarea>';
    const field = document.getElementById('t') as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(4, 8);
    expect(readSelection()).toBe('고른부분');
  });

  it('같은 출처 iframe 안의 선택을 찾아낸다', () => {
    document.body.innerHTML = '<iframe id="f"></iframe>';
    const frame = document.getElementById('f') as HTMLIFrameElement;
    const inner = frame.contentDocument!;
    inner.body.innerHTML = '<p id="p">프레임 안 문단</p>';
    select(inner.getElementById('p')!, inner);

    expect(readSelection()).toBe('프레임 안 문단');
  });

  it('다른 출처 프레임에서 막혀도 예외를 던지지 않는다', () => {
    document.body.innerHTML = '<iframe id="f"></iframe>';
    const frame = document.getElementById('f') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentDocument', {
      get() {
        throw new Error('cross-origin');
      },
    });

    expect(() => readSelection()).not.toThrow();
    expect(readSelection()).toBe('');
  });
});
