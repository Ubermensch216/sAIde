/**
 * 붙어 있는 선택 영역 표시.
 *
 * ★ 첫 줄을 그대로 보여준다. 무엇을 붙였는지 눈으로 확인할 수 없으면, 사용자는
 *   자기가 고른 곳이 아닌 문단에 대한 답을 읽고도 알아채지 못한다.
 *
 * ★ 절단 고지는 페이지 칩과 같은 규칙으로 **항상** 띄운다. 고른 부분이 반만
 *   갔다는 사실은 페이지가 잘린 것보다 크게 어긋난다 — 질문이 가리키는 대상
 *   자체가 반쪽이기 때문이다.
 */

import { useT } from '@/lib/i18n';
import type { ExtractedPage } from '@/lib/messaging/protocol';

interface Props {
  selection: ExtractedPage;
  onDetach: () => void;
}

/** 칩 한 줄에 들어가는 길이. 넘으면 말줄임한다. */
const PREVIEW_CHARS = 60;

export function SelectionChip({ selection, onDetach }: Props) {
  const t = useT();
  const pct = Math.round(selection.keptRatio * 100);
  const preview = previewOf(selection.text);

  return (
    <div className={`pagechip selection ${selection.truncated ? 'truncated' : ''}`}>
      <div className="pagechip-main">
        <div className="pagechip-title" title={selection.text.slice(0, 500)}>
          <span className="sel-quote">{preview}</span>
        </div>
        <div className="pagechip-meta">
          {t('page.method.selection')} ·{' '}
          {t('page.tokens', { n: selection.estimatedTokens.toLocaleString() })}
          {selection.truncated && (
            <span className="pagechip-warn"> · {t('page.truncated', { pct })}</span>
          )}
        </div>
      </div>
      <button
        className="pagechip-x"
        onClick={onDetach}
        title={t('page.selectionDetach')}
        aria-label={t('page.selectionDetach')}
      >
        ×
      </button>
    </div>
  );
}

function previewOf(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS)}…` : oneLine;
}
