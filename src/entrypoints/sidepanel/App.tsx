/**
 * Side Panel 루트. 계획서 §3 설계 결정 ①
 *
 * ★ LLM 호출의 주체는 이 문서다. Service Worker가 아니다.
 *   패널은 열려 있는 동안 살아 있는 실제 document이므로 장시간 스트리밍에
 *   안정적이다. (MV3 서비스 워커는 약 30초 유휴 시 죽는다.)
 *
 * Phase 1 범위: 헬스체크 · 워밍업 · 테마. 채팅은 Phase 2에서 붙인다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkHealth, warmup, type HealthReport } from '@/lib/ollama/client';
import {
  loadSettings,
  onSettingsChanged,
  DEFAULT_SETTINGS,
  MEASURED_COLD_LOAD_SEC,
  type Settings,
} from '@/lib/storage/settings';
import { SaideIcon, Wordmark } from './components/BrandMark';
import { HealthBanner } from './components/HealthBanner';

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<HealthReport>({
    state: 'checking',
    models: [],
    resident: false,
    onGpu: false,
  });
  const [warming, setWarming] = useState(false);
  const warmedFor = useRef<string>('');

  /* ── 설정 로드 및 구독 ── */
  useEffect(() => {
    loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);

  /* ── 테마 적용 ── */
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  /* ── 헬스체크 ── */
  const refresh = useCallback(async () => {
    setHealth((h) => ({ ...h, state: 'checking' }));
    setHealth(await checkHealth(settings.endpoint, settings.model));
  }, [settings.endpoint, settings.model]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── 워밍업 ──
   * 콜드 스타트 21.5초를 사용자가 체감하지 않게 만드는 유일한 수단이다.
   * ★ numCtx는 이후 실제 대화와 동일해야 한다 — 다르면 모델이 리로드되어
   *   워밍업이 통째로 무의미해진다.
   */
  useEffect(() => {
    if (!settings.warmupOnOpen) return;
    if (health.state !== 'cold') return;

    // 같은 (모델, num_ctx) 조합으로 두 번 워밍업하지 않는다.
    const key = `${settings.model}@${settings.numCtx}`;
    if (warmedFor.current === key) return;
    warmedFor.current = key;

    const ac = new AbortController();
    setWarming(true);
    warmup(settings.endpoint, settings.model, settings.numCtx, settings.keepAlive, ac.signal)
      .then(() => refresh())
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

  const openOptions = () => chrome.runtime.openOptionsPage();

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <SaideIcon size={20} />
          <Wordmark />
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={openOptions} title="설정" aria-label="설정">
          <GearIcon />
        </button>
      </header>

      <HealthBanner health={health} model={settings.model} onRetry={refresh} />

      {warming && <WarmupProgress seconds={MEASURED_COLD_LOAD_SEC} />}

      <main className="app-main">
        <Placeholder health={health} settings={settings} />
      </main>
    </div>
  );
}

/**
 * 워밍업 진행 표시.
 * 계획서 §6: 5초 이상 걸리는 작업은 예상 시간을 반드시 보여준다.
 * 무반응 스피너는 고장으로 오인된다.
 */
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

function Placeholder({ health, settings }: { health: HealthReport; settings: Settings }) {
  const ready = health.state === 'ok';

  return (
    <div className="empty">
      <SaideIcon size={48} />
      <h2>{ready ? '준비되었습니다' : 'sAIde'}</h2>
      <p>
        {ready
          ? '이 컴퓨터 안에서만 도는 AI 조력자입니다. 대화 기능은 Phase 2에서 연결됩니다.'
          : '내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.'}
      </p>
      <div className="meta">
        {settings.model} · num_ctx {settings.numCtx}
        {health.resident && ` · ${health.onGpu ? 'GPU' : 'CPU'}`}
        {health.version && ` · Ollama ${health.version}`}
      </div>
    </div>
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
