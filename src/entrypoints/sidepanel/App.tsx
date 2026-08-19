/**
 * Side Panel 루트. 계획서 §3 설계 결정 ①
 *
 * ★ LLM 호출의 주체는 이 문서다. Service Worker가 아니다.
 *   패널은 열려 있는 동안 살아 있는 실제 document이므로 장시간 스트리밍에
 *   안정적이다. (MV3 서비스 워커는 약 30초 유휴 시 죽는다.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkHealth, warmup, type HealthReport } from '@/lib/ollama/client';
import { useChat } from '@/lib/chat/store';
import { listMessages, pruneEmptyConversations, type Conversation } from '@/lib/storage/db';
import { isRestrictedUrl, sameDocument, sendToSW } from '@/lib/messaging/protocol';
import type { SWToPanel, TabSummary } from '@/lib/messaging/protocol';
import {
  builtinCommands,
  customCommands,
  expandCommand,
  findPreset,
  PAGE_PRESETS,
  type CustomPreset,
  type SlashCommand,
} from '@/lib/prompts/presets';
import { loadCustomPresets, onCustomPresetsChanged } from '@/lib/storage/presets';
import { detectPageKind, kindHint, suggestedOrder } from '@/lib/extract/pagetype';
import { requestCaptureAccess, requestHostAccess } from '@/lib/permissions';
import { estimateTtfbSeconds } from '@/lib/storage/settings';
import {
  loadSettings,
  onSettingsChanged,
  DEFAULT_SETTINGS,
  MEASURED_COLD_LOAD_SEC,
  type Settings,
} from '@/lib/storage/settings';
import { canRunAgent as agentAllowed } from '@/lib/agent/executor';
import { SaideIcon, Wordmark } from './components/BrandMark';
import { ApprovalCard } from './components/ApprovalCard';
import { HealthBanner } from './components/HealthBanner';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { ConversationMenu } from './components/ConversationMenu';
import { PageContextChip } from './components/PageContextChip';
import { PageActions } from './components/PageActions';
import { ScreenshotChip } from './components/ScreenshotChip';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<HealthReport>({
    state: 'checking',
    models: [],
    resident: false,
    onGpu: false,
  });
  const [warming, setWarming] = useState(false);
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<TabSummary | null>(null);
  const [draft, setDraft] = useState('');
  const [customs, setCustoms] = useState<CustomPreset[]>([]);
  /**
   * 에이전트 모드 (Phase 5). 켠 동안에만 툴 스키마가 붙는다.
   * 기본 꺼짐인 이유는 비용이다 — 툴 8종 설명이 매 턴 프리필에 들어간다.
   */
  const [agentMode, setAgentMode] = useState(false);
  const warmedFor = useRef('');

  const chat = useChat();

  /* ── 설정 ── */
  useEffect(() => {
    loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);

  /* ── 빈 대화 청소 ──
   * 이전 버전이 탭을 열 때마다 빈 대화를 만들어 두었다. 그 잔재를 걷어낸다.
   * 지금은 첫 메시지를 보낼 때만 생성하므로 새로 쌓이지는 않는다.
   */
  useEffect(() => {
    void pruneEmptyConversations();
  }, []);

  /* ── 사용자 정의 프리셋 (Phase 4-4) ── */
  useEffect(() => {
    loadCustomPresets().then(setCustoms);
    return onCustomPresetsChanged(setCustoms);
  }, []);

  /* ── 테마 ──
   * shiki가 라이트/다크 중 어느 테마로 코드를 칠할지 알아야 하므로,
   * data-theme 속성만이 아니라 실제 적용된 값도 state로 들고 있어야 한다.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = () =>
      setDark(settings.theme === 'dark' || (settings.theme === 'system' && mq.matches));
    resolve();
    mq.addEventListener('change', resolve);
    return () => mq.removeEventListener('change', resolve);
  }, [settings.theme]);

  /* ── 헬스체크 ── */
  const refresh = useCallback(async () => {
    setHealth((h) => ({ ...h, state: 'checking' }));
    setHealth(await checkHealth(settings.endpoint, settings.model));
  }, [settings.endpoint, settings.model]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── 탭별 세션 + 컨텍스트 메뉴 (Phase 2-5 / 3-6) ── */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 지금 패널이 붙들고 있는 탭. 중복 이벤트를 걸러내는 기준이다.
  const currentTab = useRef<TabSummary | null>(null);

  useEffect(() => {
    let alive = true;

    /**
     * ★ 같은 문서로 다시 들어오면 세션을 갈아끼우지 않는다.
     *
     *   onUpdated / onActivated는 새로고침이나 탭 왕복만으로도 여러 번 온다.
     *   그때마다 openForTab을 부르면 붙여 둔 페이지가 떨어져, 사용자는
     *   "방금 붙였는데 왜 없어졌지" 상태가 된다.
     *   반대로 문서가 실제로 바뀌었으면 반드시 갈아끼워야 한다.
     */
    const open = (t: TabSummary | null) => {
      if (!alive || !t || t.tabId < 0) return;

      const prev = currentTab.current;
      const same = prev && prev.tabId === t.tabId && sameDocument(prev.url, t.url);

      currentTab.current = t;
      setTab(t);
      if (same) return;

      void chat.openForTab(t.tabId, t.url);
    };

    sendToSW({ type: 'GET_ACTIVE_TAB' }).then((res) => {
      if (res.type === 'ACTIVE_TAB') open(res.tab);
    });

    const listener = (msg: SWToPanel) => {
      if (msg.type === 'TAB_CHANGED') {
        open(msg.tab);
      } else if (msg.type === 'CONTEXT_MENU') {
        handleContextMenu(msg.preset, msg.selectionText);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
    // chat은 zustand 스토어라 참조가 안정적이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 컨텍스트 메뉴에서 온 선택 텍스트 처리.
   *
   * 'send'는 사용자가 무엇을 물을지 정해야 하므로 입력창에 넣기만 한다.
   * 나머지는 바로 보낸다 — 선택 텍스트는 짧아 프리필이 싸다.
   */
  const handleContextMenu = (presetId: string, selection: string) => {
    const preset = findPreset(presetId);
    if (!preset || !selection) return;

    const text = preset.build(selection);
    if (presetId === 'send') setDraft(text);
    else void chat.send(text, settingsRef.current);
  };

  /* ── 워밍업 ──
   * 콜드 스타트 21.5초를 사용자가 체감하지 않게 만드는 유일한 수단.
   * ★ numCtx는 실제 대화와 동일해야 한다 — 다르면 모델이 리로드된다.
   */
  useEffect(() => {
    if (!settings.warmupOnOpen || health.state !== 'cold') return;

    const key = `${settings.model}@${settings.numCtx}`;
    if (warmedFor.current === key) return;
    warmedFor.current = key;

    const ac = new AbortController();
    setWarming(true);
    warmup(settings.endpoint, settings.model, settings.numCtx, settings.keepAlive, ac.signal)
      .then(refresh)
      .catch(() => undefined)
      .finally(() => setWarming(false));

    return () => ac.abort();
  }, [
    health.state,
    settings.warmupOnOpen,
    settings.endpoint,
    settings.model,
    settings.numCtx,
    settings.keepAlive,
    refresh,
  ]);

  const blocked =
    health.state === 'down' ||
    health.state === 'cors-blocked' ||
    health.state === 'model-missing';

  const canReadPage = Boolean(tab && !isRestrictedUrl(tab.url));

  /**
   * 페이지 접근 권한을 확보한다.
   *
   * ★ 클릭 핸들러의 첫 동작이어야 한다. 앞에 await가 끼면 사용자 제스처가
   *   소실돼 chrome.permissions.request가 거부된다. 이미 허용된 사이트면
   *   대화상자 없이 즉시 true가 돌아온다.
   */
  const ensureAccess = async (url: string): Promise<boolean> => {
    const ok = await requestHostAccess(url);
    if (!ok) {
      chat.setError(
        '이 사이트의 내용을 읽으려면 접근 권한이 필요합니다. ' +
          '권한 요청을 허용하거나, 설정에서 모든 사이트를 한 번에 허용할 수 있습니다.',
      );
    }
    return ok;
  };

  /**
   * 화면 캡처 권한을 확보한다.
   *
   * ★ 본문 읽기와 요구 권한이 다르다.
   *   chrome.tabs.captureVisibleTab은 사이트별 권한을 받아주지 않고
   *   `<all_urls>` 또는 activeTab만 인정한다. activeTab은 상주 사이드패널에서
   *   신뢰할 수 없으므로(§0.7), 캡처에서만 권한을 한 단계 올린다.
   */
  const ensureCapture = async (): Promise<boolean> => {
    const ok = await requestCaptureAccess();
    if (!ok) {
      chat.setError(
        '화면 캡처는 모든 사이트에 대한 접근 권한이 필요합니다. ' +
          '크롬이 캡처 기능에 한해 사이트별 권한을 받아주지 않기 때문입니다. ' +
          '허용하지 않으시려면 대신 "이 페이지 요약"으로 본문을 읽을 수 있습니다.',
      );
    }
    return ok;
  };

  /**
   * 페이지 빠른 작업 실행 — 권한 확보 → 첨부 → 프리셋 문구 전송.
   *
   * needs가 'screen'이면 본문 대신 화면을 캡처한다. 실측 262토큰/4.5초로
   * 본문(2,000토큰/15초)보다 싸므로, 글로 안 읽히는 화면에서는 이쪽이 낫다.
   */
  const runPageAction = async (presetId: string) => {
    if (!tab || chat.streaming) return;
    const preset = PAGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    // 캡처와 본문 읽기는 요구 권한이 다르다.
    const granted =
      preset.needs === 'screen' ? await ensureCapture() : await ensureAccess(tab.url);
    if (!granted) return;

    const attached =
      preset.needs === 'screen'
        ? await chat.attachScreenshot(tab.tabId)
        : await chat.attachPage(tab.tabId, settings);
    if (!attached) return; // 실패 사유는 store가 error에 넣는다

    const text = preset.build();
    if (text) void chat.send(text, settings);
  };

  /**
   * 에이전트 모드 전송 (Phase 5).
   *
   * ★ 권한 요청이 이 함수의 **첫 동작**이어야 한다. 루프가 돌기 시작하면
   *   사용자 제스처가 사라져 chrome.permissions.request가 거부된다.
   *   여기서 한 번 받아 두면 루프 안의 모든 액션이 그 권한으로 동작한다.
   */
  const startAgent = async (text: string) => {
    if (!tab || chat.streaming) return;
    if (!(await ensureAccess(tab.url))) return;
    await chat.sendAgent(text, settings, tab.tabId);
  };

  /** 대화 도중 페이지 붙이기 */
  const attachCurrentPage = async () => {
    if (!tab) return;
    if (!(await ensureAccess(tab.url))) return;
    await chat.attachPage(tab.tabId, settings);
  };

  /** 대화 도중 화면 캡처 붙이기 */
  const attachCurrentScreen = async () => {
    if (!tab) return;
    if (!(await ensureCapture())) return;
    await chat.attachScreenshot(tab.tabId);
  };

  /* ── 슬래시 커맨드 (Phase 4-3) ── */
  const commands = useMemo(
    () => [...builtinCommands(), ...customCommands(customs)],
    [customs],
  );

  const runSlash = async (cmd: SlashCommand, rest: string) => {
    setDraft('');

    // 페이지·화면이 필요한 커맨드는 먼저 첨부를 확보한다.
    if (cmd.needs === 'page' || cmd.needs === 'screen') {
      if (!tab) return;
      const granted =
        cmd.needs === 'screen' ? await ensureCapture() : await ensureAccess(tab.url);
      if (!granted) return;

      const ok =
        cmd.needs === 'screen'
          ? await chat.attachScreenshot(tab.tabId)
          : await chat.attachPage(tab.tabId, settings);
      if (!ok) return;
    }

    const text = expandCommand(cmd, rest, customs);
    if (text.trim()) void chat.send(text, settings);
  };

  const pickConversation = async (c: Conversation) => {
    // 진행 중인 생성·승인 대기를 먼저 정리한다. 남겨 두면 다른 대화에
    // 토큰이 흘러 들어가고, 승인 대기 Promise는 영원히 안 풀린다.
    chat.stop();

    const msgs = await listMessages(c.id);
    useChat.setState({
      conversation: c,
      pending: null, // 저장된 대화를 열었으므로 대기 상태를 비운다
      messages: msgs,
      error: null,
      page: null,
      screenshot: null,
      lastContext: null,
      agentSteps: [],
      agentTurn: 0,
    });
    setMenuOpen(false);
  };

  const attachEstimate = estimateTtfbSeconds(settings.pageTokenBudget + 300);
  const attachSec = Math.max(1, Math.round(attachEstimate));

  // 페이지 유형별 제안 (Phase 4-5). URL만으로 판단한다 —
  // 본문을 읽어야 아는 분류는 그 자체로 프리필 15초를 물게 된다.
  const pageKind = detectPageKind(tab?.url ?? '');
  const presetOrder = suggestedOrder(pageKind);
  const hint = kindHint(pageKind);

  // 대화가 시작된 뒤에도 페이지를 붙일 수 있어야 한다.
  const showAttach = !chat.page && canReadPage && chat.messages.length > 0;
  const showScreen = !chat.screenshot && canReadPage && chat.messages.length > 0;
  const showRegen = chat.messages.some((m) => m.role === 'assistant');

  // 에이전트는 조작할 페이지가 있어야 의미가 있다. chrome:// 에서는 숨긴다.
  const canRunAgent = settings.agentEnabled && agentAllowed(tab);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <SaideIcon size={20} />
          <Wordmark />
        </div>
        {chat.conversation && chat.messages.length > 0 && (
          <span className="conv-chip">{chat.conversation.title}</span>
        )}
        <div className="spacer" />
        <button className="icon-btn" onClick={() => setMenuOpen(true)} title="대화 목록" aria-label="대화 목록">
          <ListIcon />
        </button>
        <button className="icon-btn" onClick={() => chrome.runtime.openOptionsPage()} title="설정" aria-label="설정">
          <GearIcon />
        </button>
      </header>

      <HealthBanner health={health} model={settings.model} onRetry={refresh} />
      {warming && <WarmupProgress seconds={MEASURED_COLD_LOAD_SEC} />}

      {chat.error && (
        <div className="banner banner-down" role="alert">
          <div className="body">
            <div className="title">문제가 발생했습니다</div>
            <div className="hint">{chat.error}</div>
          </div>
          <button className="btn-sm" onClick={chat.clearError}>
            닫기
          </button>
        </div>
      )}

      <main className="app-main">
        {chat.messages.length === 0 ? (
          <EmptyState
            health={health}
            settings={settings}
            canReadPage={canReadPage}
            tab={tab}
            extracting={chat.extracting}
            attached={Boolean(chat.page || chat.screenshot)}
            estimatedSec={attachEstimate}
            blocked={blocked}
            order={presetOrder}
            kindHint={hint}
            onRun={runPageAction}
          />
        ) : (
          <MessageList
            messages={chat.messages}
            dark={dark}
            showThinking={settings.thinkMode !== 'off'}
          />
        )}
      </main>

      {/* 승인 대기 중에는 진행 표시를 내린다 — 지금 기다리는 것은 모델이 아니라 사용자다. */}
      {chat.streaming && !chat.pendingApproval && (
        <StreamingBar
          startedAt={chat.startedAt}
          expectedSec={chat.expectedPrefillSec}
          agentTurn={chat.agentTurn}
          maxTurns={settings.agentMaxTurns}
          onStop={chat.stop}
        />
      )}

      <div className="footer-bar">
        {chat.page && <PageContextChip page={chat.page} onDetach={chat.detachPage} />}
        {chat.screenshot && (
          <ScreenshotChip data={chat.screenshot} onDetach={chat.detachScreenshot} />
        )}

        {/*
          보조 동작은 한 줄에 모은다. 세로로 쌓으면 좁은 사이드패널에서
          입력창이 밀려 올라가고 대화가 보이는 높이가 줄어든다.
        */}
        {!chat.streaming && (showAttach || showScreen || showRegen) && (
          <div className="footer-actions">
            {showAttach && (
              <button
                className="minibtn"
                disabled={blocked || chat.extracting}
                onClick={attachCurrentPage}
                title={`현재 페이지 본문을 대화에 붙입니다 (약 ${attachSec}초)`}
              >
                <PageIcon />
                {chat.extracting ? '읽는 중…' : '페이지 붙이기'}
                {!chat.extracting && <span className="cost">{attachSec}초</span>}
              </button>
            )}
            {showScreen && (
              <button
                className="minibtn"
                disabled={blocked || chat.extracting}
                onClick={attachCurrentScreen}
                title="현재 화면을 캡처해 대화에 붙입니다 (약 5초)"
              >
                <CameraIcon />
                화면 붙이기<span className="cost">5초</span>
              </button>
            )}
            {showRegen && (
              <button className="minibtn" onClick={() => chat.regenerate(settings)} title="마지막 답변을 다시 생성합니다">
                <RetryIcon />
                다시 생성
              </button>
            )}
            {canRunAgent && (
              <button
                className={`minibtn agent-toggle ${agentMode ? 'on' : ''}`}
                aria-pressed={agentMode}
                disabled={blocked}
                onClick={() => setAgentMode((v) => !v)}
                title={
                  agentMode
                    ? '에이전트 모드 끄기'
                    : '에이전트 모드 — 페이지를 직접 읽고 조작합니다. 클릭·입력·이동은 승인을 거칩니다.'
                }
              >
                <AgentIcon />
                에이전트
                {agentMode && <span className="cost">켜짐</span>}
              </button>
            )}
          </div>
        )}

        {/*
          승인 카드는 입력창 바로 위에 둔다. 화면을 덮는 대화상자로 만들면
          사용자가 무엇에 대한 승인인지(직전 대화 맥락) 볼 수 없게 된다.
        */}
        {chat.pendingApproval && (
          <ApprovalCard
            request={chat.pendingApproval.request}
            onDecide={chat.resolveApproval}
          />
        )}

        <Composer
          streaming={chat.streaming}
          disabled={blocked}
          value={draft}
          commands={commands}
          agentMode={agentMode}
          onChange={setDraft}
          onSend={(t) => {
            setDraft('');
            if (agentMode) void startAgent(t);
            else void chat.send(t, settings);
          }}
          onSlash={runSlash}
          onStop={chat.stop}
        />
      </div>

      {menuOpen && (
        <ConversationMenu
          currentId={chat.conversation?.id ?? null}
          onPick={pickConversation}
          onClose={() => setMenuOpen(false)}
          onDeleted={(id) => {
            if (chat.conversation?.id === id) {
              chat.stop();
              // 현재 탭으로 다시 대기 상태에 들어간다 — 다음 메시지에서 새로 만든다.
              useChat.setState({
                conversation: null,
                pending: tab ? { tabId: tab.tabId, url: tab.url } : null,
                messages: [],
                page: null,
                screenshot: null,
                lastContext: null,
                agentSteps: [],
                agentTurn: 0,
              });
            }
          }}
        />
      )}
    </div>
  );
}

/* ── 진행 표시 ─────────────────────────────────────────── */

/**
 * 계획서 §6: 5초 이상 걸리는 작업은 경과와 예상 시간을 반드시 보여준다.
 * CPU 추론에서 무반응 스피너는 고장으로 오인된다.
 *
 * expectedSec은 접두사 캐시 적중분을 뺀 값이라, 페이지를 붙인 후속 질문에서는
 * 0에 가깝게 나온다 — 실제로도 빠르므로 정직한 표시다.
 */
function StreamingBar({
  startedAt,
  expectedSec,
  agentTurn,
  maxTurns,
  onStop,
}: {
  startedAt: number | null;
  expectedSec: number;
  /** 0이면 일반 생성. 1 이상이면 에이전트 루프의 현재 턴. */
  agentTurn: number;
  maxTurns: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const sec = startedAt ? (now - startedAt) / 1000 : 0;
  const showEta = expectedSec >= 3 && sec < expectedSec;

  // 에이전트는 몇 턴째인지 알려준다. 1턴 25초라 진행감이 없으면 고장으로 보인다.
  const label = agentTurn > 0
    ? `에이전트 ${agentTurn}/${maxTurns}턴`
    : showEta
      ? '페이지 읽는 중'
      : '생성 중';

  return (
    <div className="progress" role="status" aria-live="polite">
      <span>{label}</span>
      <div className="track">
        {showEta ? (
          <div className="fill" style={{ width: `${Math.min(97, (sec / expectedSec) * 100)}%` }} />
        ) : (
          <div className="fill indeterminate" />
        )}
      </div>
      <span className="eta">
        {showEta ? `약 ${Math.max(1, Math.ceil(expectedSec - sec))}초` : `${sec.toFixed(1)}초`}
      </span>
      <button className="btn-sm" onClick={onStop}>
        중단
      </button>
    </div>
  );
}

function WarmupProgress({ seconds }: { seconds: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 0.25), 250);
    return () => clearInterval(t);
  }, []);

  const pct = Math.min(97, (elapsed / seconds) * 100);
  const left = Math.max(0, Math.ceil(seconds - elapsed));

  return (
    <div className="progress" role="status" aria-live="polite">
      <span>모델 준비 중</span>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="eta">약 {left}초</span>
    </div>
  );
}

function EmptyState({
  health,
  settings,
  canReadPage,
  tab,
  extracting,
  attached,
  estimatedSec,
  blocked,
  order,
  kindHint,
  onRun,
}: {
  health: HealthReport;
  settings: Settings;
  canReadPage: boolean;
  tab: TabSummary | null;
  extracting: boolean;
  attached: boolean;
  estimatedSec: number;
  blocked: boolean;
  order: string[];
  kindHint: string | null;
  onRun: (id: string) => void;
}) {
  return (
    <div className="empty">
      <SaideIcon size={48} />
      <h2>{health.state === 'ok' ? '무엇을 도와드릴까요?' : 'sAIde'}</h2>
      <p>
        {health.state === 'ok'
          ? '이 컴퓨터 안에서만 도는 AI 조력자입니다. 대화 내용은 밖으로 나가지 않습니다.'
          : '내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.'}
      </p>

      {canReadPage ? (
        <PageActions
          disabled={blocked}
          extracting={extracting}
          attached={attached}
          estimatedSec={estimatedSec}
          order={order}
          kindHint={kindHint}
          onRun={onRun}
        />
      ) : (
        tab && (
          <div className="pageactions-hint restricted">
            이 페이지에서는 내용을 읽을 수 없습니다. 일반 웹페이지에서 다시 시도하세요.
          </div>
        )
      )}

      <div className="meta">
        {settings.model} · num_ctx {settings.numCtx.toLocaleString()}
        {health.resident && ` · ${health.onGpu ? 'GPU' : 'CPU'}`}
      </div>
    </div>
  );
}

/* ── 아이콘 ────────────────────────────────────────────── */

function CameraIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M9 14h.01M15 14h.01" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85.3.19.65.29 1 .29H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
