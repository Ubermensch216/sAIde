/**
 * 입력창. 계획서 Phase 2-3
 *
 * 생성 중에는 전송 버튼이 중단 버튼으로 바뀐다. 별도 버튼을 두면
 * 좁은 사이드패널에서 자리를 낭비하고, 무엇을 눌러야 할지도 모호해진다.
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ streaming, disabled, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // 입력 길이에 따라 높이를 늘린다(최대 6줄).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming || disabled) return;
    onSend(t);
    setText('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter 전송, Shift+Enter 줄바꿈. 한글 조합 중에는 전송하지 않는다.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={disabled ? 'Ollama 연결을 먼저 확인하세요' : '무엇이든 물어보세요'}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="메시지 입력"
      />
      {streaming ? (
        <button className="send stop" onClick={onStop} aria-label="생성 중단" title="중단">
          <StopIcon />
        </button>
      ) : (
        <button
          className="send"
          onClick={submit}
          disabled={!text.trim() || disabled}
          aria-label="보내기"
          title="보내기 (Enter)"
        >
          <SendIcon />
        </button>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}
