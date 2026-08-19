/**
 * 에이전트가 무엇을 했는지 보여주는 실행 기록. 계획서 §5 Phase 5
 *
 * ★ 기본으로 펼쳐 둔다. 생각 과정(thinking)은 접어 두지만 이건 다르다 —
 *   실제로 페이지를 건드린 기록이므로, 사용자가 보지 않고 지나칠 수 있게
 *   숨기면 안 된다. 특히 승인해서 클릭·입력이 일어난 경우가 그렇다.
 */

import { useState } from 'react';
import type { AgentStep } from '@/lib/agent/loop';

export function AgentSteps({ steps, live }: { steps: AgentStep[]; live?: boolean }) {
  if (steps.length === 0) return null;

  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <Step key={`${s.turn}-${i}`} step={s} />
      ))}
      {live && (
        <li className="step running">
          <span className="dot" />
          <span className="step-label">다음 동작을 고르는 중…</span>
        </li>
      )}
    </ol>
  );
}

function Step({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const denied = step.approved === false;
  const state = denied ? 'denied' : step.ok ? 'ok' : 'fail';

  return (
    <li className={`step ${state}`}>
      <span className="dot" />
      <button className="step-label" onClick={() => setOpen((o) => !o)} title="결과 보기">
        {step.label}
        {step.approved === true && <span className="badge">승인됨</span>}
        {denied && <span className="badge deny">거부됨</span>}
        <span className="ms">{(step.ms / 1000).toFixed(1)}초</span>
      </button>
      {open && <div className="step-detail">{step.detail}</div>}
    </li>
  );
}
