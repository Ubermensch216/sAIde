// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blockText, extractArticle } from './article';

/** 메뉴·관련 기사 목록이 본문보다 훨씬 긴 짧은 기사. 네이버 뉴스 구조를 본떴다. */
function shortNewsPage(): Document {
  const links = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `<li><a href="/a/${prefix}${i}">${prefix} 관련 기사 제목 ${i}번, 오늘 오후 발표된 소식을 정리했다</a></li>`).join('');
  const html = `<!doctype html><html><head><title>시험 기사</title>
    <meta name="twitter:creator" content="가상일보"></head><body>
    <header><ul class="nav">${['정치', '경제', '사회', '생활/문화', 'IT/과학', '세계'].map((s) => `<li><a href="/${s}">${s}</a></li>`).join('')}</ul></header>
    <div id="ct">
      <div class="media_end_head">
        <h2 id="title_area"><span>마을 도서관, 주말 그림책 낭독회 열어</span></h2>
        <div class="media_end_head_info_datestamp_bunch"><em class="media_end_head_info_datestamp_term">입력</em>
          <span class="media_end_head_info_datestamp_time">2026.10.12. 오후 4:21</span></div>
        <em class="media_end_head_journalist_name">홍길동 기자</em>
        <p class="tts">이동 통신망을 이용하여 음성을 재생하면 별도의 데이터 통화료가 부과될 수 있습니다.</p>
      </div>
      <div id="newsct_article"><article id="dic_area">
        <div style="text-align:center"><span class="end_photo_org"><em class="img_desc">▲ 낭독회에 참여한 어린이들.</em></span></div>마을 도서관이 주말 오전 그림책 낭독회를 열었다. 자원봉사자 열 명이 돌아가며 그림책을 읽었다.<br><br>참여한 어린이들은 직접 고른 책의 한 장면을 그림으로 그려 전시했다.<br><br>도서관은 다음 달에도 같은 행사를 열 계획이다.<br><br>홍길동 기자
      </article></div>
      <section class="related"><h3>언론사 많이 본 뉴스</h3><ul>${links('많이 본', 20)}</ul></section>
      <section class="more"><h3>함께 볼만한 뉴스</h3><ul>${links('함께 볼', 20)}</ul></section>
    </div></body></html>`;
  return new DOMParser().parseFromString(html, 'text/html');
}

const NAVER = 'https://n.news.naver.com/mnews/article/000/0000000001?sid=103';

describe('네이버 뉴스', () => {
  it('본문 요소만 읽고 메뉴·안내·관련 기사 목록은 버린다', () => {
    const out = extractArticle(shortNewsPage(), NAVER)!;
    expect(out.method).toBe('site');
    expect(out.text).toContain('마을 도서관이 주말 오전 그림책 낭독회를 열었다.');
    expect(out.text).toContain('다음 달에도 같은 행사를 열 계획이다.');
    for (const noise of ['IT/과학', '데이터 통화료', '많이 본 관련 기사', '함께 볼 관련 기사']) {
      expect(out.text).not.toContain(noise);
    }
  });

  it('제목·언론사·입력 시각·기자를 앞에 붙인다', () => {
    const lines = extractArticle(shortNewsPage(), NAVER)!.text.split('\n').filter(Boolean);
    expect(lines[0]).toBe('마을 도서관, 주말 그림책 낭독회 열어');
    expect(lines[1]).toBe('가상일보 · 입력 2026.10.12. 오후 4:21 · 홍길동 기자');
  });

  it('<br>로 나눈 문단을 붙이지 않는다', () => {
    // textContent로 읽으면 "열었다.참여한"처럼 문단이 이어 붙는다.
    const text = extractArticle(shortNewsPage(), NAVER)!.text;
    expect(text).not.toMatch(/읽었다\.참여한/);
    expect(text).toMatch(/읽었다\.\s*\n\s*\n?\s*참여한/);
    expect(text).toMatch(/어린이들\.\s*\n/);
  });

  it('본문 요소가 비어 있으면 리더 모드로 넘어간다', () => {
    const doc = shortNewsPage();
    doc.querySelector('#dic_area')!.innerHTML = '';
    doc.querySelector('#newsct_article')!.innerHTML = '';
    expect(extractArticle(doc, NAVER)?.method).not.toBe('site');
  });
});

describe('리더 모드', () => {
  it('규칙이 없는 사이트의 짧은 기사도 페이지 전체로 물러나지 않는다', () => {
    // Readability 기본 문턱(500자)에서는 짧은 본문을 버리고 페이지 전체를 돌려줬다.
    const out = extractArticle(shortNewsPage(), 'https://news.example.com/article/1')!;
    expect(out.method).toBe('readability');
    expect(out.text).toContain('마을 도서관이 주말 오전 그림책 낭독회를 열었다.');
    expect(out.text).not.toContain('많이 본 관련 기사');
    expect(out.text).not.toContain('함께 볼 관련 기사');
  });

  it('긴 기사는 전부 읽는다', () => {
    const para = (i: number) =>
      `<p>${i}번째 문단이다. 지역 도서관들은 올해 들어 주말 프로그램을 크게 늘렸고, 참여 인원도 지난해보다 두 배 가까이 늘었다고 밝혔다.</p>`;
    const html = `<html><body><nav><a href="/">홈</a><a href="/news">뉴스</a></nav>
      <article>${Array.from({ length: 20 }, (_, i) => para(i + 1)).join('')}</article>
      <footer><a href="/terms">약관</a></footer></body></html>`;
    const out = extractArticle(new DOMParser().parseFromString(html, 'text/html'), 'https://blog.example.com/p/1')!;
    expect(out.text).toContain('1번째 문단이다.');
    expect(out.text).toContain('20번째 문단이다.');
    expect(out.text).not.toContain('약관');
  });
});

describe('blockText', () => {
  it('줄바꿈과 문단 경계를 살리고 스크립트는 읽지 않는다', () => {
    const div = document.createElement('div');
    div.innerHTML = '첫 줄<br>둘째 줄<p>문단</p><script>var x = 1;</script><span>이어짐</span>';
    const text = blockText(div);
    expect(text).toContain('첫 줄\n둘째 줄');
    expect(text).toMatch(/\n\n문단\n\n/);
    expect(text).not.toContain('var x');
  });
});
