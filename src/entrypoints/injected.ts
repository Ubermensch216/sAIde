/**
 * 주입 스크립트 — 본문 추출과 DOM 조작. 계획서 §5 Phase 3-1 / 5
 *
 * 온디맨드로만 주입된다(background.ts의 executeScript). 상시 주입하지 않는 이유는
 * 성능·프라이버시·심사 셋 다 불리하기 때문이다. 계획서 §3 설계 결정 ②.
 *
 * ★ defineContentScript가 아니라 defineUnlistedScript다.
 *
 * defineContentScript는 `matches`를 manifest의 host_permissions로 승격시키는데,
 * `<all_urls>`가 박히면 설계 결정 ②(상시 주입 금지)가 무의미해지고 심사·프라이버시
 * 모두 불리해진다. unlisted script는 번들만 만들고 manifest에 등록하지 않으므로,
 * background가 activeTab 권한으로 executeScript 할 때만 실제로 주입된다.
 */

import { Readability } from '@mozilla/readability';
import { fitToBudget } from '@/lib/extract/budget';
import {
  extractYouTubeCaption,
  isYouTubeWatch,
  youTubeMeta,
} from '@/lib/extract/youtube';
import type {
  ContentToSW,
  ExtractedPage,
  ExtractMethod,
  PageAction,
  SWToContent,
} from '@/lib/messaging/protocol';

/** 재주입 가드용 전역 플래그. */
declare global {
  interface Window {
    __saideInjected?: true;
  }
}

export default defineUnlistedScript(() => {
  // background는 요청마다 executeScript를 호출한다(이미 주입됐는지 알 수 없으므로).
  // 가드가 없으면 리스너가 중첩되어 같은 요청에 여러 번 응답하게 된다.
  if (window.__saideInjected) return;
  window.__saideInjected = true;

  chrome.runtime.onMessage.addListener((msg: SWToContent, _sender, sendResponse) => {
    // 자막 추출이 비동기라 handler 전체를 Promise로 감싼다.
    (async () => {
      try {
        if (msg.type === 'EXTRACT') {
          sendResponse({
            type: 'EXTRACTED',
            payload: await extractPage(msg.budgetTokens),
          } satisfies ContentToSW);
        } else if (msg.type === 'ACT') {
          const { ok, detail } = await performAction(msg.action);
          sendResponse({ type: 'ACTED', ok, detail } satisfies ContentToSW);
        }
      } catch (e) {
        sendResponse({
          type: 'FAILED',
          error: { code: 'UNKNOWN', message: String(e) },
        } satisfies ContentToSW);
      }
    })();
    return true; // 비동기 응답을 쓰겠다는 신호
  });
});

/* ── 추출 ──────────────────────────────────────────────── */

async function extractPage(budgetTokens: number): Promise<ExtractedPage> {
  let raw = '';
  let method: ExtractMethod = 'readability';

  // ① 유튜브는 Readability로 아무것도 못 건진다. 자막을 먼저 시도한다.
  if (isYouTubeWatch(location.href)) {
    const caption = await extractYouTubeCaption();
    if (caption) {
      raw = `${youTubeMeta()}\n\n${caption}`;
      method = 'youtube-caption';
    }
  }

  // ② 리더 모드
  if (!raw) {
    try {
      // Readability는 문서를 파괴적으로 수정하므로 반드시 복제본에 돌린다.
      const clone = document.cloneNode(true) as Document;
      const article = new Readability(clone).parse();
      raw = article?.textContent?.trim() ?? '';
    } catch {
      raw = '';
    }
  }

  // ③ 폴백 — 리더 모드가 실패하는 페이지(SPA, 대시보드 등)가 흔하다.
  if (raw.length < 200) {
    raw = document.body?.innerText?.trim() ?? '';
    method = 'innerText';
  }

  const normalized = raw.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  const budgeted = fitToBudget(normalized, budgetTokens);

  return {
    url: location.href,
    title: document.title,
    text: budgeted.text,
    charCount: normalized.length,
    truncated: budgeted.truncated,
    keptRatio: budgeted.keptRatio,
    estimatedTokens: budgeted.estimatedTokens,
    method,
    extractedAt: Date.now(),
  };
}

/* ── 액션 (Phase 5) ────────────────────────────────────── */

async function performAction(action: PageAction): Promise<{ ok: boolean; detail: string }> {
  switch (action.kind) {
    case 'read_page': {
      const p = await extractPage(2000);
      return { ok: true, detail: p.text };
    }

    case 'find_element': {
      const el = findByText(action.query);
      return el
        ? { ok: true, detail: `찾음: ${describe(el)}` }
        : { ok: false, detail: `'${action.query}'에 해당하는 요소를 찾지 못했습니다.` };
    }

    case 'scroll': {
      const amount = action.amount ?? window.innerHeight * 0.8;
      if (action.direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (action.direction === 'bottom')
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else
        window.scrollBy({
          top: action.direction === 'down' ? amount : -amount,
          behavior: 'smooth',
        });
      return { ok: true, detail: `${action.direction} 방향으로 스크롤했습니다.` };
    }

    case 'click': {
      const el = document.querySelector<HTMLElement>(action.selector);
      if (!el) return { ok: false, detail: `선택자에 맞는 요소가 없습니다: ${action.selector}` };
      el.click();
      return { ok: true, detail: `클릭했습니다: ${describe(el)}` };
    }

    case 'type_text': {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        action.selector,
      );
      if (!el) return { ok: false, detail: `입력 요소가 없습니다: ${action.selector}` };
      el.focus();
      el.value = action.text;
      // React 등 프레임워크가 상태를 갱신하도록 실제 이벤트를 발생시킨다.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, detail: `입력했습니다: ${describe(el)}` };
    }

    case 'navigate':
      // background에서 처리한다. 여기 오면 라우팅 버그다.
      return { ok: false, detail: 'navigate는 주입 스크립트에서 처리하지 않습니다.' };
  }
}

/** 사람이 쓰는 말로 요소를 찾는다. 소형 모델이 CSS 선택자를 잘 못 만들기 때문. */
function findByText(query: string): HTMLElement | null {
  const q = query.trim().toLowerCase();
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, a, input, textarea, select, [role="button"], [role="link"]',
  );
  for (const el of candidates) {
    const label = (
      el.innerText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      ''
    )
      .trim()
      .toLowerCase();
    if (label && label.includes(q)) return el;
  }
  return null;
}

/** 승인 카드에 보여줄 사람이 읽는 요소 설명. */
function describe(el: HTMLElement): string {
  const label = (
    el.innerText ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('name') ||
    ''
  ).trim();
  const tag = el.tagName.toLowerCase();
  return label ? `<${tag}> "${label.slice(0, 60)}"` : `<${tag}>`;
}
