/**
 * 설정 화면. 계획서 §5 Phase 1-7
 *
 * 설계 의도: 성능에 영향을 주는 값(num_ctx, 본문 예산, thinking)은
 * **비용을 숨기지 않는다.** 슬라이더 옆에 실측 기반 예상 대기시간을
 * 실시간으로 보여주고, 사용자가 알고 늘리게 한다.
 */

import { useEffect, useState } from 'react';
import { checkHealth } from '@/lib/ollama/client';
import type { ModelInfo } from '@/types/ollama';
import {
  DEFAULT_SETTINGS,
  estimateTtfbSeconds,
  loadSettings,
  resetSettings,
  saveSettings,
  MEASURED_PREFILL_TOK_PER_SEC,
  type Settings,
  type ThemePref,
  type ThinkMode,
} from '@/lib/storage/settings';
import { SaideIcon } from '../sidepanel/components/BrandMark';
import { PresetEditor } from './PresetEditor';
import { PerfDashboard } from './PerfDashboard';
import {
  grantedOrigins,
  hasAllUrls,
  requestAllUrls,
  revokeAllSites,
  revokeOrigin,
} from '@/lib/permissions';

export default function OptionsApp() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [conn, setConn] = useState<{ ok: boolean; text: string } | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [allSites, setAllSites] = useState(false);

  useEffect(() => {
    loadSettings().then(setS);
    void reloadPermissions();
  }, []);

  const reloadPermissions = async () => {
    setOrigins(await grantedOrigins());
    setAllSites(await hasAllUrls());
  };

  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
  }, [s.theme]);

  /** 모델 목록을 /api/tags에서 동적으로 불러온다. 하드코딩하지 않는다. */
  const probe = async (settings: Settings) => {
    setConn(null);
    const h = await checkHealth(settings.endpoint, settings.model);
    setModels(h.models);
    setConn(
      h.state === 'down' || h.state === 'cors-blocked'
        ? { ok: false, text: h.error?.message ?? '연결 실패' }
        : {
            ok: true,
            text: `Ollama ${h.version} · 모델 ${h.models.length}개${
              h.resident ? ` · 상주 중 (${h.onGpu ? 'GPU' : 'CPU'})` : ''
            }`,
          },
    );
  };

  useEffect(() => {
    void probe(s);
    // 최초 1회만. 이후는 사용자가 '연결 확인'을 누른다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (p: Partial<Settings>) => setS(await saveSettings(p));

  const budgetTtfb = estimateTtfbSeconds(s.pageTokenBudget + 300);
  const ctxFullTtfb = estimateTtfbSeconds(s.numCtx);

  return (
    <div className="wrap">
      <header className="opt-header">
        <SaideIcon size={28} />
        <span className="wordmark">
          s<b>AI</b>de
        </span>
        <span className="sub">설정</span>
      </header>

      {/* ── 연결 ── */}
      <section>
        <h2>연결</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="endpoint">Ollama 엔드포인트</label>
            <input
              id="endpoint"
              type="text"
              value={s.endpoint}
              onChange={(e) => patch({ endpoint: e.target.value })}
            />
          </div>
          <p className="desc">이 컴퓨터의 Ollama 주소입니다. 외부로는 어떤 요청도 나가지 않습니다.</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="model">모델</label>
            <select id="model" value={s.model} onChange={(e) => patch({ model: e.target.value })}>
              {models.length === 0 && <option value={s.model}>{s.model}</option>}
              {models
                .filter((m) => !m.capabilities?.includes('embedding'))
                .map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void probe(s)}>
              연결 확인
            </button>
            {conn && <span className={`status ${conn.ok ? 'ok' : 'bad'}`}>{conn.text}</span>}
          </div>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="embed">임베딩 모델</label>
            <select
              id="embed"
              value={s.embedModel}
              onChange={(e) => patch({ embedModel: e.target.value })}
            >
              {models.length === 0 && <option value={s.embedModel}>{s.embedModel}</option>}
              {models
                .filter((m) => m.capabilities?.includes('embedding'))
                .map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
          <p className="desc">기억·검색 기능에서만 사용합니다. bge-m3는 한국어 검색 품질이 좋습니다.</p>
        </div>
      </section>

      {/* ── 성능 ── */}
      <section>
        <h2>성능</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="think">추론 과정(thinking)</label>
            <select
              id="think"
              value={s.thinkMode}
              onChange={(e) => patch({ thinkMode: e.target.value as ThinkMode })}
            >
              <option value="off">끄기 — 가장 빠름</option>
              <option value="agent-only">에이전트에서만 (권장)</option>
              <option value="always">항상 켜기</option>
            </select>
          </div>
          <p className="desc">
            모델이 답하기 전에 생각을 적는 기능입니다. 정확도가 조금 오르지만 이 컴퓨터에서는
            응답이 <strong>약 6배 느려집니다</strong>. 툴을 쓰는 작업에서만 켜는 편이 좋습니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="budget">페이지 본문 분량</label>
            <input
              id="budget"
              type="range"
              min={500}
              max={8000}
              step={250}
              value={s.pageTokenBudget}
              onChange={(e) => patch({ pageTokenBudget: Number(e.target.value) })}
            />
            <span className="val">{s.pageTokenBudget.toLocaleString()} 토큰</span>
          </div>
          {/* 비용을 숨기지 않는다 — 계획서 §5 Phase 3-2 */}
          <p className={budgetTtfb > 30 ? 'warn' : 'desc'}>
            한국어 약 {Math.round((s.pageTokenBudget * 2) / 100) * 100}자 · 답변 시작까지 약{' '}
            <strong>{budgetTtfb}초</strong>
            {budgetTtfb > 30 && ' — 실사용에는 너무 깁니다'}
          </p>
          <p className="desc">이 분량을 넘는 페이지는 앞부분만 읽고, 그 사실을 화면에 알립니다.</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="ctx">컨텍스트 길이 (num_ctx)</label>
            <select
              id="ctx"
              value={s.numCtx}
              onChange={(e) => patch({ numCtx: Number(e.target.value) })}
            >
              {[2048, 4096, 8192, 16384, 32768].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <p className="desc">
            대화 전체가 들어갈 수 있는 최대 크기입니다. 꽉 채우면 답변 시작까지 약{' '}
            {ctxFullTtfb}초 걸립니다. 값을 바꾸면 모델이 다시 로드되므로 잠시 느려집니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="keep">모델 유지 시간</label>
            <select
              id="keep"
              value={s.keepAlive}
              onChange={(e) => patch({ keepAlive: e.target.value })}
            >
              <option value="5m">5분</option>
              <option value="10m">10분 (권장)</option>
              <option value="30m">30분</option>
              <option value="-1">계속 유지</option>
            </select>
          </div>
          <p className="desc">
            길게 잡으면 응답이 빠르지만 메모리를 계속 차지합니다(약 7GB). 16GB 컴퓨터에서는
            10분이 적당합니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="warm">패널을 열 때 미리 준비</label>
            <input
              id="warm"
              type="checkbox"
              checked={s.warmupOnOpen}
              onChange={(e) => patch({ warmupOnOpen: e.target.checked })}
            />
          </div>
          <p className="desc">
            모델을 미리 메모리에 올려 첫 응답을 앞당깁니다. 끄면 첫 질문에서 약 20초를 기다리게
            됩니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="temp">temperature</label>
            <input
              id="temp"
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={s.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
            />
            <span className="val">{s.temperature.toFixed(1)}</span>
          </div>
          <p className="desc">낮을수록 일관되고, 높을수록 다양한 답을 냅니다.</p>
        </div>
      </section>

      {/* ── 에이전트 (Phase 5) ── */}
      <section>
        <h2>에이전트</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="agent">에이전트 모드 사용</label>
            <input
              id="agent"
              type="checkbox"
              checked={s.agentEnabled}
              onChange={(e) => patch({ agentEnabled: e.target.checked })}
            />
          </div>
          <p className="desc">
            입력창 옆의 <strong>에이전트</strong> 버튼이 보입니다. 켜면 sAIde가 페이지를 직접
            읽고 스크롤하며, 필요하면 클릭·입력·이동을 <strong>제안</strong>합니다.
          </p>
          {/*
            자동 승인 옵션은 제공하지 않는다. 계획서 §7 — 승인 게이트가
            프롬프트 인젝션의 실질적 방어선이고, 무르게 하는 순간 사라진다.
          */}
          <p className="desc">
            클릭·입력·주소 이동은 <strong>매번 승인을 거칩니다.</strong> 자동 승인이나 "다시 묻지
            않기"는 일부러 만들지 않았습니다 — 페이지에 숨겨진 지시문으로부터 지켜 주는 마지막
            장치이기 때문입니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="turns">최대 턴 수</label>
            <input
              id="turns"
              type="range"
              min={2}
              max={12}
              step={1}
              value={s.agentMaxTurns}
              onChange={(e) => patch({ agentMaxTurns: Number(e.target.value) })}
            />
            <span className="val">{s.agentMaxTurns}턴</span>
          </div>
          {/* 비용을 숨기지 않는다. 이 하드웨어에서 1턴이 약 25초다. */}
          <p className={s.agentMaxTurns * 25 > 240 ? 'warn' : 'desc'}>
            한 턴에 약 25초가 걸리므로 최악의 경우 약{' '}
            <strong>{Math.round((s.agentMaxTurns * 25) / 6) / 10}분</strong>까지 돌 수 있습니다.
            중간에 언제든 중단할 수 있습니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="idle">무응답 대기 한도</label>
            <select
              id="idle"
              value={s.agentIdleTimeoutMs}
              onChange={(e) => patch({ agentIdleTimeoutMs: Number(e.target.value) })}
            >
              <option value={20_000}>20초</option>
              <option value={30_000}>30초 (권장)</option>
              <option value={60_000}>60초</option>
              <option value={120_000}>120초</option>
            </select>
          </div>
          <p className="desc">
            한 턴이 이 시간 동안 아무것도 내놓지 못하면 멈춥니다. 글자가 나오는 동안에는 시간이
            다시 초기화되므로, 느리게라도 답하고 있으면 끊기지 않습니다.
          </p>
        </div>
      </section>

      <PerfDashboard />

      <PresetEditor />

      {/* ── 페이지 접근 권한 ── */}
      <section>
        <h2>페이지 접근</h2>

        <div className="field">
          <p className="desc">
            sAIde는 설치할 때 어떤 사이트 권한도 갖지 않습니다. "이 페이지 요약" 같은 기능을 처음
            쓸 때 그 사이트에 한해 권한을 요청합니다. 아래에서 한 번에 허용하거나 언제든 회수할 수
            있습니다.
          </p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="allsites">모든 사이트에서 허용</label>
            <input
              id="allsites"
              type="checkbox"
              checked={allSites}
              onChange={async (e) => {
                if (e.target.checked) await requestAllUrls();
                else await revokeAllSites();
                await reloadPermissions();
              }}
            />
          </div>
          <p className="desc">
            켜면 사이트마다 묻지 않습니다. 페이지 내용은 여전히 이 컴퓨터 밖으로 나가지 않습니다.
          </p>
          <p className="desc">
            <strong>화면 캡처 기능은 이 권한이 반드시 필요합니다.</strong> 크롬이 캡처에 한해
            사이트별 권한을 받아주지 않기 때문입니다. 본문 읽기는 사이트별 권한만으로 동작합니다.
          </p>
        </div>

        {!allSites && (
          <div className="field">
            <div className="row">
              <label>허용된 사이트</label>
              <span className="status">{origins.length}곳</span>
            </div>
            {origins.length === 0 ? (
              <p className="desc">아직 없습니다.</p>
            ) : (
              <ul className="origin-list">
                {origins.map((o) => (
                  <li key={o}>
                    <code>{o}</code>
                    <button
                      className="btn-sm"
                      onClick={async () => {
                        await revokeOrigin(o);
                        await reloadPermissions();
                      }}
                    >
                      회수
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── 표시 ── */}
      <section>
        <h2>표시</h2>
        <div className="field">
          <div className="row">
            <label htmlFor="theme">테마</label>
            <select
              id="theme"
              value={s.theme}
              onChange={(e) => patch({ theme: e.target.value as ThemePref })}
            >
              <option value="system">시스템 설정 따르기</option>
              <option value="light">밝게</option>
              <option value="dark">어둡게</option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <button
          className="btn"
          onClick={async () => {
            setS(await resetSettings());
          }}
        >
          기본값으로 되돌리기
        </button>
        <p className="desc" style={{ marginTop: 8 }}>
          기본값은 이 컴퓨터에서 실제로 측정한 성능(프리필 {MEASURED_PREFILL_TOK_PER_SEC} tok/s)에
          맞춰 정해져 있습니다.
        </p>
      </section>
    </div>
  );
}
