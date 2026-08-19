/**
 * 붙어 있는 화면 캡처 표시. 계획서 §5 Phase 4-1
 *
 * 무엇을 모델에 보내는지 사용자가 눈으로 확인할 수 있어야 한다 —
 * 화면 캡처는 페이지 본문보다 훨씬 사적인 내용(열린 탭 제목, 알림, 개인정보)을
 * 담기 쉬우므로, 붙여 놓고 잊게 두면 안 된다.
 */

interface Props {
  /** base64 PNG (data: 프리픽스 제외) */
  data: string;
  onDetach: () => void;
}

export function ScreenshotChip({ data, onDetach }: Props) {
  // 실측: 해상도와 무관하게 약 262토큰 / 프리필 4.5초
  const kb = Math.round((data.length * 3) / 4 / 1024);

  return (
    <div className="pagechip screenshot">
      <img className="shot-thumb" src={`data:image/png;base64,${data}`} alt="붙인 화면 캡처" />
      <div className="pagechip-main">
        <div className="pagechip-title">화면 캡처</div>
        <div className="pagechip-meta">약 262토큰 · {kb.toLocaleString()}KB</div>
      </div>
      <button
        className="pagechip-x"
        onClick={onDetach}
        title="화면 캡처 떼어내기"
        aria-label="화면 캡처 떼어내기"
      >
        ×
      </button>
    </div>
  );
}
