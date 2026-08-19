/**
 * 액션 실행기 — 루프와 브라우저 사이의 다리. 계획서 §5 Phase 5-2
 *
 * loop.ts는 chrome API를 모른다(테스트 가능해야 하므로). 실제 수행은 전부
 * 여기서 서비스 워커에 위임한다. 사이드패널 문서에서만 동작한다.
 *
 * ★ 권한은 여기서 요청하지 않는다.
 *   chrome.permissions.request는 사용자 제스처를 요구하는데, 루프 3번째 턴은
 *   제스처가 아니다(§0.7, permissions.ts 참조). 그래서 에이전트를 시작하는
 *   버튼 핸들러에서 미리 확보하고, 여기서는 없으면 실패로 되돌린다.
 */

import { isRestrictedUrl, sendToSW } from '@/lib/messaging/protocol';
import type { AppError, TabSummary } from '@/lib/messaging/protocol';
import type { ToolOutcome } from './loop';
import { isPageAction, type AgentAction } from './tools';

/** 모델에게 돌려줄 탭 목록의 상한. 20개를 넘기면 프리필만 비싸진다. */
const MAX_TABS = 20;

export function createExecutor(getTabId: () => number) {
  return async function execute(action: AgentAction): Promise<ToolOutcome> {
    const tabId = getTabId();
    if (tabId < 0) {
      return { ok: false, detail: '지금 조작할 수 있는 탭이 없다.' };
    }

    switch (action.kind) {
      case 'list_tabs': {
        const res = await sendToSW({ type: 'LIST_TABS' });
        if (res.type === 'ERROR') return fail(res.error);
        if (res.type !== 'TABS') return { ok: false, detail: '탭 목록을 가져오지 못했다.' };
        return { ok: true, detail: formatTabs(res.tabs) };
      }

      case 'screenshot': {
        const res = await sendToSW({ type: 'CAPTURE_SCREENSHOT', tabId });
        if (res.type === 'ERROR') return fail(res.error);
        if (res.type !== 'SCREENSHOT') return { ok: false, detail: '화면을 캡처하지 못했다.' };
        return {
          ok: true,
          detail: '화면을 캡처했다.',
          // Ollama의 images는 순수 base64만 받는다.
          image: res.dataUrl.replace(/^data:image\/\w+;base64,/, ''),
        };
      }

      default: {
        if (!isPageAction(action)) return { ok: false, detail: '알 수 없는 동작이다.' };
        const res = await sendToSW({ type: 'EXEC_ACTION', tabId, action });
        if (res.type === 'ERROR') return fail(res.error);
        if (res.type !== 'ACTION_RESULT') return { ok: false, detail: '동작을 수행하지 못했다.' };
        return { ok: res.ok, detail: res.detail };
      }
    }
  };
}

/**
 * 승인 카드에 넣을 대상 요소 설명을 미리 확인한다.
 *
 * ★ 부작용이 없는 조회다. 승인 **전에** 부르는 유일한 페이지 접근이며,
 *   사용자가 "무엇을 클릭하는지" 보고 판단할 수 있게 하는 근거다(§7).
 */
export function createTargetDescriber(getTabId: () => number) {
  return async function describeTarget(action: AgentAction): Promise<string | undefined> {
    if (action.kind !== 'click' && action.kind !== 'type_text') return undefined;
    const tabId = getTabId();
    if (tabId < 0) return undefined;

    const res = await sendToSW({
      type: 'EXEC_ACTION',
      tabId,
      action: { kind: 'describe_target', selector: action.selector },
    });
    if (res.type === 'ACTION_RESULT' && res.ok) return res.detail;
    return undefined;
  };
}

/** 에이전트를 시작할 수 있는 탭인지. chrome:// 등에서는 아무것도 못 한다. */
export function canRunAgent(tab: TabSummary | null): boolean {
  return Boolean(tab && tab.tabId >= 0 && !isRestrictedUrl(tab.url));
}

function fail(error: AppError): ToolOutcome {
  // 힌트까지 붙여야 모델이 "권한이 없다"와 "요소가 없다"를 구분해 다르게 시도한다.
  return { ok: false, detail: error.hint ? `${error.message} ${error.hint}` : error.message };
}

function formatTabs(tabs: TabSummary[]): string {
  const lines = tabs
    .slice(0, MAX_TABS)
    .map((t, i) => `${i + 1}. ${t.title}${t.active ? ' (현재 탭)' : ''} — ${t.url}`);
  if (tabs.length > MAX_TABS) lines.push(`… 외 ${tabs.length - MAX_TABS}개`);
  return lines.join('\n');
}
