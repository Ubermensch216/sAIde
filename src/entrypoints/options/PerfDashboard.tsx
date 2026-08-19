/**
 * 성능 계측 대시보드. 계획서 §5 Phase 7-1 / §6
 *
 * ★ 목표와 실측을 **나란히** 보여주는 것이 요점이다.
 *   숫자만 늘어놓으면 빠른 건지 느린 건지 알 수 없다. §6이 정한 목표를 옆에
 *   두어야 사용자가 "이 정도면 정상"인지 판단할 수 있고, 하드웨어를 바꿨을 때
 *   무엇이 좋아졌는지도 보인다.
 *
 * ★ 별도 계측을 돌리지 않는다. 실사용 중 이미 쌓인 기록만 읽는다 —
 *   측정하겠다고 CPU를 20초씩 더 쓰는 것은 이 하드웨어에서 사치다.
 */

import { useCallback, useEffect, useState } from 'react';
import { listPerfSamples } from '@/lib/storage/db';
import { summarize, type PerfSummary } from '@/lib/perf/stats';
import {
  MEASURED_DECODE_TOK_PER_SEC,
  MEASURED_PREFILL_TOK_PER_SEC,
} from '@/lib/storage/settings';

export function PerfDashboard() {
  const [summary, setSummary] = useState<PerfSummary | null>(null);

  const load = useCallback(async () => {
    setSummary(summarize(await listPerfSamples()));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary) return null;

  if (summary.total === 0) {
    return (
      <section>
        <h2>성능 기록</h2>
        <p className="desc">
          아직 기록이 없습니다. 대화를 몇 번 나누면 이곳에 실제 응답 속도가 쌓이고, 계획서가 정한
          목표와 나란히 비교됩니다.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>성능 기록</h2>

      <p className="desc">
        최근 {summary.total.toLocaleString()}건의 실제 응답에서 잰 값입니다. 콜드 스타트{' '}
        {summary.coldCount}건은 목표 대조에서 제외했습니다(모델을 처음 올리는 시간이라 매번 겪는
        지연이 아닙니다).
      </p>

      <table className="perf-table">
        <thead>
          <tr>
            <th>작업 구간</th>
            <th>건수</th>
            <th>첫 토큰(중앙값)</th>
            <th>목표</th>
          </tr>
        </thead>
        <tbody>
          {summary.buckets.map((b) => (
            <tr key={b.id}>
              <td>{b.label}</td>
              <td className="num">{b.count}</td>
              <td className="num">
                {b.count === 0 ? '—' : `${b.medianTtfbSec}초`}
                {b.meetsTarget === false && <span className="miss"> 초과</span>}
                {b.meetsTarget === true && <span className="meet"> 달성</span>}
              </td>
              <td className="num">{b.targetTtfbSec}초</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="perf-grid">
        <div>
          <dt>프리필</dt>
          <dd>
            {summary.medianPrefillTokPerSec} tok/s
            <span className="base"> 기준 {MEASURED_PREFILL_TOK_PER_SEC}</span>
          </dd>
        </div>
        <div>
          <dt>생성</dt>
          <dd>
            {summary.medianDecodeTokPerSec} tok/s
            <span className="base"> 기준 {MEASURED_DECODE_TOK_PER_SEC}</span>
          </dd>
        </div>
        <div>
          <dt>읽은 토큰</dt>
          <dd>{summary.totalPromptTokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>생성한 토큰</dt>
          <dd>{summary.totalOutputTokens.toLocaleString()}</dd>
        </div>
      </dl>

      {/*
        하드웨어가 바뀌면 기본값을 되돌릴 수 있다는 사실을 여기서 알린다.
        계획서 §11 리스크 6′ — 예산·think·num_ctx를 전부 설정으로 뺀 이유가 이것이다.
      */}
      {summary.looksFasterThanBaseline && (
        <p className="desc ok-note">
          프리필이 기준선의 3배를 넘습니다. GPU가 붙은 것으로 보입니다 — 페이지 본문 분량과
          컨텍스트 길이를 늘려도 실용 범위에 들어옵니다.
        </p>
      )}

      <button className="btn" onClick={load}>
        새로고침
      </button>
    </section>
  );
}
