/**
 * 사용자가 페이지에서 직접 드래그해 고른 텍스트를 읽는다.
 *
 * ★ 페이지 전체(2,000토큰 ≈ 15초)를 붙이는 대신 고른 부분만 붙이기 위한 경로다.
 *   프리필 131 tok/s에서 300토큰짜리 문단은 약 2.3초다. 이 기능은 편의가 아니라
 *   대기시간을 한 자릿수 초로 끌어내리는 수단이다.
 *
 * ★ 사이드패널을 눌러도 선택은 남는다. 포커스가 패널로 넘어가면 브라우저는 페이지의
 *   선택을 회색으로 바꿀 뿐 Range는 그대로 두므로, 드래그한 뒤 패널 버튼을 누르는
 *   순서가 성립한다. 우클릭 메뉴와 패널 버튼 두 진입점이 같은 코드를 쓰는 이유다.
 *
 * ★ 프레임까지 훑는다. 본문을 같은 출처 iframe에 담는 화면에서 선택은 그 안쪽
 *   문서에 생기고, 최상위 document.getSelection()은 비어 있다.
 *   (다른 출처 프레임은 브라우저가 막는다 — document-text.ts와 같은 한계다.)
 *
 * ★ 입력 요소 안의 선택은 getSelection()에 잡히지 않는다. 읽기 전용 편집기에
 *   본문을 넣어 두는 화면이 있어, textarea·input은 따로 본다.
 */

const MAX_FRAME_DEPTH = 4;

/** 선택된 텍스트. 없으면 빈 문자열. */
export function readSelection(doc: Document = document, depth = 0): string {
  const own = ownSelection(doc);
  if (own) return own;

  if (depth >= MAX_FRAME_DEPTH) return '';
  for (const frame of doc.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>(
    'iframe, frame',
  )) {
    let child: Document | null = null;
    try {
      child = frame.contentDocument;
    } catch {
      // 다른 출처 프레임. 읽을 수 없다.
      child = null;
    }
    if (!child) continue;
    const text = readSelection(child, depth + 1);
    if (text) return text;
  }
  return '';
}

function ownSelection(doc: Document): string {
  const field = textField(doc.activeElement);
  if (field) {
    const { selectionStart: start, selectionEnd: end } = field;
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      return normalize(field.value.slice(start, end));
    }
  }

  let raw = '';
  try {
    raw = doc.getSelection()?.toString() ?? '';
  } catch {
    raw = '';
  }
  return normalize(raw);
}

function textField(el: Element | null): HTMLTextAreaElement | HTMLInputElement | null {
  if (!el) return null;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return el as HTMLTextAreaElement;
  // 값이 문자열인 입력만. 체크박스·파일 입력에는 selectionStart가 없다.
  if (tag === 'INPUT' && typeof (el as HTMLInputElement).selectionStart === 'number') {
    return el as HTMLInputElement;
  }
  return null;
}

/** 본문 추출과 같은 정규화. 모델에 들어가는 형태를 한 가지로 맞춘다. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
