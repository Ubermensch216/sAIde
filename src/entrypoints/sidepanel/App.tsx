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
import { listMessages, type Conversation } from '@/lib/storage/db';
import { sendToSW } from '@/lib/messaging/protocol';
import type { SWToPanel, TabSummary } from '@/lib/messaging/protocol';
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
  const warmedFor = useRef('');

  const chat = useChat();

  /* ── 설정 ── */
  useEffect(() => {
    loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
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

  /* ── 탭별 세션 (Phase 2-5) ── */
  useEffect(() => {
    let alive = true;

    const open = (tab: TabSummary | null) => {
      if (!alive || !tab || tab.tabId < 0) return;
      void chat.openForTab(tab.tabId, tab.url);
    };

    sendToSW({ type: 'GET_ACTIVE_TAB' }).then((res) => {
      if (res.type === 'ACTIVE_TAB') open(res.tab);
    });

    const listener = (msg: SWToPanel) => {
      if (msg.type === 'TAB_CHANGED') open(msg.tab);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
    // chat은 zustand 스토어라 참조가 안정적이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const blocked = health.state === 'down' || health.state === 'cors-blocked' || health.state === 'model-missing';

  const pickConversation = async (c: Conversation) => {
    const msgs = await listMessages(c.id);
    useChat.setState({ conversation: c, messages: msgs, error: null });
    setMenuOpen(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <SaideIcon size={20} />
          <Wordmark />
        </div>
        {chat.conversation && <span className="conv-chip">{chat.conversation.title}</span>}
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
            <div className="title">생성에 실패했습니다</div>
            <div className="hint">{chat.error}</div>
          </div>
          <button className="btn-sm" onClick={chat.clearError}>
            닫기
          </button>
        </div>
      )}

      <main className="app-main">
        {chat.messages.length === 0 ? (
          <EmptyState health={health} settings={settings} />
        ) : (
          <MessageList
            messages={chat.messages}
            dark={dark}
            showThinking={settings.thinkMode !== 'off'}
          />
        )}
      </main>

      {chat.streaming && <StreamingBar startedAt={chat.startedAt} onStop={chat.stop} />}

      <div className="footer-bar">
        {!chat.streaming && chat.messages.some((m) => m.role === 'assistant') && (
          <button className="btn-sm regen" onClick={() => chat.regenerate(settings)}>
            다시 생성
          </button>
        )}
        <Composer
          streaming={chat.streaming}
          disabled={blocked}
          onSend={(t) => chat.send(t, settings)}
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
              useChat.setState({ conversation: null, messages: [] });
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
 */
function StreamingBar({ startedAt, onStop }: { startedAt: number | null; onStop: () => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const sec = startedAt ? (now - startedAt) / 1000 : 0;

  return (
    <div className="progress" role="status" aria-live="polite">
      <span>생성 중</span>
      <div className="track">
        <div className="fill indeterminate" />
      </div>
      <span className="eta">{sec.toFixed(1)}초</span>
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

function EmptyState({ health, settings }: { health: HealthReport; settings: Settings }) {
  return (
    <div className="empty">
      <SaideIcon size={48} />
      <h2>{health.state === 'ok' ? '무엇을 도와드릴까요?' : 'sAIde'}</h2>
      <p>
        {health.state === 'ok'
          ? '이 컴퓨터 안에서만 도는 AI 조력자입니다. 대화 내용은 밖으로 나가지 않습니다.'
          : '내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.'}
      </p>
      <div className="meta">
        {settings.model} · num_ctx {settings.numCtx.toLocaleString()}
        {health.resident && ` · ${health.onGpu ? 'GPU' : 'CPU'}`}
      </div>
    </div>
  );
}

/* ── 아이콘 ────────────────────────────────────────────── */

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
