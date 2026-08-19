/**
 * Side Panel 루트. 계획서 §3 설계 결정 ①
 *
 * ★ LLM 호출의 주체는 이 문서다. Service Worker가 아니다.
 *   패널은 열려 있는 동안 살아 있는 실제 document이므로 장시간 스트리밍에
 *   안정적이다. (MV3 서비스 워커는 약 30초 유휴 시 죽는다.)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkHealth, warmup, type HealthReport } from '@/lib/ollama/client';
import { useChat } from '@/lib/chat/store';
import { listMessages, pruneEmptyConversations, type Conversation } from '@/lib/storage/db';
import { isRestrictedUrl, sendToSW } from '@/lib/messaging/protocol';
import type { SWToPanel, TabSummary } from '@/lib/messaging/protocol';
import { findPreset, PAGE_PRESETS } from '@/lib/prompts/presets';
import { requestHostAccess } from '@/lib/permissions';
import { estimateTtfbSeconds } from '@/lib/storage/settings';
import {
  loadSettings,
  onSettingsChanged,
  DEFAULT_SETTINGS,
  MEASURED_COLD_LOAD_SEC,
  type Settings,
} from '@/lib/storage/settings';
import { SaideIcon, Wordmark } from './components/BrandMark';
import { HealthBanner } from './components/HealthBanner';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { ConversationMenu } from './components/ConversationMenu';
import { PageContextChip } from './components/PageContextChip';
import { PageActions } from './components/PageActions';

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

  useEffect(() => {
    let alive = true;

    const open = (t: TabSummary | null) => {
      if (!alive || !t || t.tabId < 0) return;
      setTab(t);
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

  /** 페이지 빠른 작업 실행 — 권한 확보 → 추출 → 프리셋 문구 전송. */
  const runPageAction = async (presetId: string) => {
    if (!tab || chat.streaming) return;
    const preset = PAGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    if (!(await ensureAccess(tab.url))) return;

    const page = await chat.attachPage(tab.tabId, settings);
    if (!page) return; // 실패 사유는 store가 error에 넣는다

    const text = preset.build();
    if (text) void chat.send(text, settings);
  };

  /** 대화 도중 페이지 붙이기 */
  const attachCurrentPage = async () => {
    if (!tab) return;
    if (!(await ensureAccess(tab.url))) return;
    await chat.attachPage(tab.tabId, settings);
  };

  const pickConversation = async (c: Conversation) => {
    const msgs = await listMessages(c.id);
    useChat.setState({
      conversation: c,
      pending: null, // 저장된 대화를 열었으므로 대기 상태를 비운다
      messages: msgs,
      error: null,
      page: null,
      lastContext: null,
    });
    setMenuOpen(false);
  };

  const attachEstimate = estimateTtfbSeconds(settings.pageTokenBudget + 300);
  const attachSec = Math.max(1, Math.round(attachEstimate));

  // 대화가 시작된 뒤에도 페이지를 붙일 수 있어야 한다.
  const showAttach = !chat.page && canReadPage && chat.messages.length > 0;
  const showRegen = chat.messages.some((m) => m.role === 'assistant');

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
            attached={Boolean(chat.page)}
            estimatedSec={attachEstimate}
            blocked={blocked}
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

      {chat.streaming && (
        <StreamingBar
          startedAt={chat.startedAt}
          expectedSec={chat.expectedPrefillSec}
          onStop={chat.stop}
        />
      )}

      <div className="footer-bar">
        {chat.page && <PageContextChip page={chat.page} onDetach={chat.detachPage} />}

        {/*
          보조 동작은 한 줄에 모은다. 세로로 쌓으면 좁은 사이드패널에서
          입력창이 밀려 올라가고 대화가 보이는 높이가 줄어든다.
        */}
        {!chat.streaming && (showAttach || showRegen) && (
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
            {showRegen && (
              <button className="minibtn" onClick={() => chat.regenerate(settings)} title="마지막 답변을 다시 생성합니다">
                <RetryIcon />
                다시 생성
              </button>
            )}
          </div>
        )}

        <Composer
          streaming={chat.streaming}
          disabled={blocked}
          value={draft}
          onChange={setDraft}
          onSend={(t) => {
            setDraft('');
            void chat.send(t, settings);
          }}
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
              // 현재 탭으로 다시 대기 상태에 들어간다 — 다음 메시지에서 새로 만든다.
              useChat.setState({
                conversation: null,
                pending: tab ? { tabId: tab.tabId, url: tab.url } : null,
                messages: [],
                page: null,
                lastContext: null,
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
  onStop,
}: {
  startedAt: number | null;
  expectedSec: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const sec = startedAt ? (now - startedAt) / 1000 : 0;
  const showEta = expectedSec >= 3 && sec < expectedSec;

  return (
    <div className="progress" role="status" aria-live="polite">
      <span>{showEta ? '페이지 읽는 중' : '생성 중'}</span>
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
