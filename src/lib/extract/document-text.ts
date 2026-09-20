/**
 * 화면에 보이는 글자를 프레임까지 훑어 모은다. 리더 모드가 실패했을 때의 폴백이다.
 *
 * ★ `body.innerText`만으로는 모자라다. 본문을 **같은 출처 iframe**에 담거나 읽기 전용
 *   편집기(textarea)에 넣어 두는 화면이 흔한데, 둘 다 innerText에 나타나지 않는다.
 *   리더 모드가 이미 실패한 자리라 여기서도 비면 사용자는 "읽을 내용이 없다"만 본다.
 *
 * ★ 다른 출처 프레임은 여기서 읽지 못한다(브라우저가 막는다). 그 안이 PDF 뷰어라면
 *   lib/extract/pdf-source.ts가 원본을 받아 따로 합친다.
 *
 * ★ 무엇이 본문인지 고르지 않는다. 빠짐없이 모으고, 추리는 일은 모델이 한다.
 */
const MAX_FRAME_DEPTH = 4;

export function collectDocumentText(doc: Document = document, depth = 0): string {
  const parts = [visibleText(doc)];
  if (depth < MAX_FRAME_DEPTH) {
    for (const frame of doc.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>('iframe, frame')) {
      let child: Document | null = null;
      try {
        child = frame.contentDocument;
      } catch {
        child = null;
      }
      if (child?.body) parts.push(collectDocumentText(child, depth + 1));
    }
  }
  return parts.map(part => part.trim()).filter(Boolean).join('\n\n');
}

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body || body.tagName === 'FRAMESET') return '';
  // jsdom 등 innerText를 구현하지 않은 환경에서는 textContent로 대신한다.
  const text = typeof body.innerText === 'string' ? body.innerText : body.textContent ?? '';
  // 읽기 전용 편집기에 본문을 넣어 두는 화면이 있다. innerText에는 값이 들어가지 않는다.
  const fields = [...doc.querySelectorAll<HTMLTextAreaElement>('textarea')]
    .map(field => field.value.trim())
    .filter(value => value.length >= 20 && !text.includes(value));
  return [text, ...fields].join('\n\n');
}
