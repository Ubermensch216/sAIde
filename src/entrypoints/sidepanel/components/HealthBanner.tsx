/**
 * 헬스체크 배너. 계획서 §5 Phase 1-8
 *
 * 상태별로 **다른** 해결 방법을 보여주는 것이 핵심이다. "연결 실패"
 * 한 줄로 뭉뚱그리면 사용자는 무엇을 고쳐야 할지 알 수 없다.
 *
 * 특히 CORS_BLOCKED와 OLLAMA_DOWN은 증상이 같지만 해결법이 완전히 다르다.
 * (errors.ts의 no-cors 프로브가 이 둘을 갈라낸다.)
 */

import { useState } from 'react';
import type { HealthReport } from '@/lib/ollama/client';
import { CORS_COMMAND, pullCommand } from '@/lib/ollama/errors';

interface Props {
  health: HealthReport;
  model: string;
  onRetry: () => void;
}

export function HealthBanner({ health, model, onRetry }: Props) {
  // 정상이거나 확인 중이면 배너를 띄우지 않는다. 조용한 성공이 옳다.
  if (health.state === 'ok' || health.state === 'checking') return null;

  switch (health.state) {
    case 'down':
      return (
        <Banner
          kind="down"
          title="Ollama가 실행 중이 아닙니다"
          hint="Ollama를 시작한 뒤 다시 시도하세요. sAIde는 인터넷이 아니라 이 컴퓨터의 Ollama에 연결합니다."
          action={{ label: '다시 확인', onClick: onRetry }}
        />
      );

    case 'cors-blocked':
      return (
        <Banner
          kind="cors"
          title="Ollama가 확장의 요청을 거부하고 있습니다"
          hint="아래 명령을 PowerShell에서 실행한 뒤, 트레이의 Ollama를 완전히 종료했다가 다시 시작하세요."
          command={CORS_COMMAND}
          action={{ label: '다시 확인', onClick: onRetry }}
        />
      );

    case 'model-missing':
      return (
        <Banner
          kind="model-missing"
          title={`모델 '${model}'이 설치되어 있지 않습니다`}
          hint="아래 명령으로 내려받은 뒤 다시 확인하세요. 약 7.2GB입니다."
          command={pullCommand(model)}
          action={{ label: '다시 확인', onClick: onRetry }}
        />
      );

    case 'cold':
      return (
        <Banner
          kind="cold"
          title="모델을 메모리에 올리는 중입니다"
          hint={
            health.onGpu
              ? '첫 응답까지 잠시 걸립니다.'
              : '첫 응답까지 약 20초 걸립니다. 이후에는 빨라집니다.'
          }
        />
      );

    default:
      return null;
  }
}

interface BannerProps {
  kind: 'down' | 'cors' | 'model-missing' | 'cold';
  title: string;
  hint: string;
  command?: string;
  action?: { label: string; onClick: () => void };
}

function Banner({ kind, title, hint, command, action }: BannerProps) {
  return (
    <div className={`banner banner-${kind}`} role="status">
      <div className="body">
        <div className="title">{title}</div>
        <div className="hint">{hint}</div>
        {command && <CopyableCommand command={command} />}
      </div>
      {action && (
        <button className="btn-sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="cmd">
      <code>{command}</code>
      <button className="btn-sm" onClick={copy}>
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}
