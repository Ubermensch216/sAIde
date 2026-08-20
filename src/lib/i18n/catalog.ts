/**
 * UI 문자열 카탈로그. 계획서 §5 Phase 7-4
 *
 * ★ 여기 없는 문자열이 화면에 직접 박히면 안 된다.
 *   완결성은 catalog.test.ts가 지킨다 — ko와 en의 키 집합이 다르면 실패한다.
 *
 * ★ 모델에게 보내는 프롬프트는 여기 넣지 않는다.
 *   prompts/ 쪽 문자열은 KV 캐시 접두사를 이루므로 성격이 다르다. 응답 언어를
 *   정하는 한 줄만 로케일을 따르고, 나머지는 prompts/system.ts가 관리한다.
 *
 * 자리표시자는 `{name}` 형식이다. 예: '앞부분 {pct}%만 읽음'
 */

const ko = {
  /* ── 공통 ── */
  'ui.retry': '다시 확인',
  'ui.close': '닫기',
  'ui.copy': '복사',
  'ui.copied': '복사됨',
  'ui.delete': '삭제',
  'ui.settings': '설정',
  'ui.openSettings': '설정 열기',
  'ui.grantPermission': '권한 허용',
  'ui.resolve': '해결',
  'ui.unknown': '(알 수 없음)',

  /* ── 오류 (lib/errors/describe.ts) ── */
  'err.down.title': 'Ollama가 실행 중이 아닙니다',
  'err.down.body':
    'Ollama를 시작한 뒤 다시 시도하세요. sAIde는 인터넷이 아니라 이 컴퓨터의 Ollama에 연결합니다.',
  'err.cors.title': 'Ollama가 확장의 요청을 거부하고 있습니다',
  'err.cors.body':
    '아래 명령을 PowerShell에서 실행한 뒤, 트레이의 Ollama를 완전히 종료했다가 다시 시작하세요.',
  'err.model.title': "모델 '{model}'이 설치되어 있지 않습니다",
  'err.model.titleGeneric': '모델이 설치되어 있지 않습니다',
  'err.model.body': '아래 명령으로 내려받은 뒤 다시 확인하세요.',
  'err.oom.title': '모델을 올릴 메모리가 부족합니다',
  'err.oom.body':
    '설정에서 컨텍스트 길이(num_ctx)를 줄이거나, 메모리를 많이 쓰는 다른 프로그램을 종료한 뒤 다시 시도하세요.',
  'err.timeout.title': '응답이 오지 않아 중단했습니다',
  'err.timeout.body':
    '이 컴퓨터는 CPU로 추론하기 때문에 긴 페이지에서 느려질 수 있습니다. 페이지 분량을 줄이거나 질문을 짧게 나눠 보세요.',
  'err.aborted.title': '중단했습니다',
  'err.restricted.title': '이 페이지에서는 내용을 읽을 수 없습니다',
  'err.restricted.body':
    'chrome:// 페이지와 크롬 웹스토어에서는 브라우저가 확장 스크립트 실행을 금지합니다. 일반 웹페이지에서 다시 시도하세요.',
  'err.hostPerm.title': '이 사이트에 접근할 권한이 없습니다',
  'err.hostPerm.body':
    '설치할 때는 아무 사이트 권한도 받지 않기 때문에, 필요한 순간에만 요청합니다. 허용하면 이 사이트에서만 동작합니다.',
  'err.denied.title': '동작을 실행하지 않았습니다',
  'err.denied.body': '승인되지 않아 페이지를 건드리지 않았습니다.',
  'err.unknown.title': '문제가 발생했습니다',
  'err.unknown.body': '알 수 없는 오류입니다.',
  'err.close': '오류 닫기',

  /* ── 권한 요청 (App) ── */
  'perm.page.denied': '이 사이트의 내용을 읽으려면 접근 권한이 필요합니다.',
  'perm.capture.denied':
    '화면 캡처는 모든 사이트에 대한 접근 권한이 필요합니다. 크롬이 캡처 기능에 한해 사이트별 권한을 받아주지 않기 때문입니다. 허용하지 않으시려면 대신 "이 페이지 요약"으로 본문을 읽을 수 있습니다.',

  /* ── 헬스 배너 ── */
  'health.cold.title': '모델을 메모리에 올리는 중입니다',
  'health.cold.gpu': '첫 응답까지 잠시 걸립니다.',
  'health.cold.cpu': '첫 응답까지 약 20초 걸립니다. 이후에는 빨라집니다.',
  'health.model.size': '약 7.2GB입니다.',
  'health.warming': '모델 준비 중',
  'health.aboutSec': '약 {sec}초',

  /* ── 패널 ── */
  'panel.conversations': '대화 목록',
  'panel.empty.ready': '무엇을 도와드릴까요?',
  'panel.empty.readyBody':
    '이 컴퓨터 안에서만 도는 AI 조력자입니다. 대화 내용은 밖으로 나가지 않습니다.',
  'panel.empty.body': '내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.',
  'panel.generating': '생성 중',
  'panel.readingPage': '페이지 읽는 중',
  'panel.elapsedSec': '{sec}초',
  'panel.regenerate': '다시 생성',
  'panel.regenerateHint': '마지막 답변을 다시 생성합니다',
  'panel.attachPage': '페이지 붙이기',
  'panel.attachPageHint': '현재 페이지 본문을 대화에 붙입니다 (약 {sec}초)',
  'panel.attachScreen': '화면 붙이기',
  'panel.attachScreenHint': '현재 화면을 캡처해 대화에 붙입니다 (약 5초)',
  'panel.reading': '읽는 중…',
  'panel.secShort': '{sec}초',

  /* ── 에이전트 ── */
  'agent.toggleOn': '에이전트 모드 — 페이지를 직접 읽고 조작합니다. 클릭·입력·이동은 승인을 거칩니다.',
  'agent.toggleOff': '에이전트 모드 끄기',
  'agent.turn': '에이전트 {turn}/{max}턴',
  'agent.label': '에이전트',
  'agent.on': '켜짐',
  'agent.approval.title': '동작 승인 요청',
  'agent.steps.show': '결과 보기',
  'agent.approval.ask': '이 동작을 실행할까요?',
  'agent.approval.target': '대상',
  'agent.approval.page': '페이지',
  'agent.approval.deny': '거부',
  'agent.approval.allow': '승인하고 실행',
  'agent.steps.choosing': '다음 동작을 고르는 중…',
  'agent.steps.approved': '승인됨',
  'agent.steps.denied': '거부됨',
  'agent.steps.sec': '{sec}초',
  'conv.title': '대화',
  'msg.charCount': '{n}자',

  /* ── 메시지 ── */
  'msg.thinking': '생각하는 중…',
  'msg.thoughts': '생각 과정',
  'msg.generating': '응답 생성 중',
  'msg.coldStart': ' · 콜드 스타트',
  'msg.aborted': '여기서 중단했습니다.',

  /* ── 페이지 첨부 ── */
  'page.method.readability': '본문',
  'page.method.innerText': '화면 텍스트',
  'page.method.youtube': '자막',
  'page.detach': '페이지 떼어내기',
  'page.truncated': '앞부분 {pct}%만 읽음',
  'page.tokens': '{n}토큰',
  'page.screenshot': '화면 캡처',
  'page.screenshotAlt': '붙인 화면 캡처',
  'page.screenshotDetach': '화면 캡처 떼어내기',
  'page.attached': '이 페이지에 대해 계속 물어볼 수 있습니다. 후속 질문은 빠릅니다.',
  'page.costHint': '본문을 읽는 데 약 {sec}초, 화면 캡처는 약 5초 걸립니다.',
  'page.reading': '페이지를 읽는 중…',
  'page.restricted':
    '이 페이지에서는 내용을 읽을 수 없습니다. 일반 웹페이지에서 다시 시도하세요.',
  'page.truncateNotice': '본문이 길어 앞부분 {pct}%만 참조했습니다.',
  'page.staleNotice':
    '페이지가 바뀌어 이전 본문을 떼어냈습니다. 현재 페이지 내용은 참조하지 않았습니다.',

  /* ── 대화 목록 ── */
  'conv.empty': '저장된 대화가 없습니다.',
  'conv.deleteOne': '{title} 삭제',
  'conv.localHost': '로컬',
  'conv.unknownHost': '알 수 없음',
  'conv.justNow': '방금',
  'conv.minAgo': '{n}분 전',
  'conv.hourAgo': '{n}시간 전',
  'conv.dayAgo': '{n}일 전',
  'conv.newChat': '새 대화',

  /* ── 입력창 ── */
  'composer.blocked': 'Ollama 연결을 먼저 확인하세요',
  'composer.agent': '무엇을 해 드릴까요?  (페이지를 직접 조작합니다)',
  'composer.normal': '무엇이든 물어보세요  ( / 로 명령 )',
  'composer.label': '메시지 입력',
  'composer.stop': '생성 중단',
  'composer.stopShort': '중단',
  'composer.send': '보내기',
  'composer.sendHint': '보내기 (Enter)',
  'composer.commands': '명령 목록',
  'composer.needsPage': '페이지',
  'composer.needsScreen': '화면',
} as const;

export type MessageKey = keyof typeof ko;

const en = {
  'ui.retry': 'Check again',
  'ui.close': 'Close',
  'ui.copy': 'Copy',
  'ui.copied': 'Copied',
  'ui.delete': 'Delete',
  'ui.settings': 'Settings',
  'ui.openSettings': 'Open settings',
  'ui.grantPermission': 'Grant access',
  'ui.resolve': 'Fix',
  'ui.unknown': '(unknown)',

  'err.down.title': 'Ollama is not running',
  'err.down.body':
    'Start Ollama and try again. sAIde connects to Ollama on this computer, not to the internet.',
  'err.cors.title': 'Ollama is refusing requests from this extension',
  'err.cors.body':
    'Run the command below in PowerShell, then quit Ollama from the tray and start it again.',
  'err.model.title': "The model '{model}' is not installed",
  'err.model.titleGeneric': 'The model is not installed',
  'err.model.body': 'Download it with the command below, then check again.',
  'err.oom.title': 'Not enough memory to load the model',
  'err.oom.body':
    'Reduce the context length (num_ctx) in settings, or close other memory-heavy programs and try again.',
  'err.timeout.title': 'Stopped — no response came back',
  'err.timeout.body':
    'This computer runs inference on the CPU, so long pages can be slow. Try a smaller page budget or shorter questions.',
  'err.aborted.title': 'Stopped',
  'err.restricted.title': "This page's contents can't be read",
  'err.restricted.body':
    'Chrome blocks extension scripts on chrome:// pages and the Web Store. Try again on a regular web page.',
  'err.hostPerm.title': 'No permission to access this site',
  'err.hostPerm.body':
    'sAIde takes no site permissions at install time, so it asks only when needed. Granting applies to this site only.',
  'err.denied.title': 'The action was not performed',
  'err.denied.body': 'It was not approved, so the page was left untouched.',
  'err.unknown.title': 'Something went wrong',
  'err.unknown.body': 'An unknown error occurred.',
  'err.close': 'Dismiss error',

  'perm.page.denied': 'Reading this site requires access permission.',
  'perm.capture.denied':
    'Screen capture requires access to all sites, because Chrome does not accept per-site permission for capture. If you prefer not to grant it, use "Summarize this page" to read the text instead.',

  'health.cold.title': 'Loading the model into memory',
  'health.cold.gpu': 'The first response will take a moment.',
  'health.cold.cpu': 'The first response takes about 20 seconds. It gets faster after that.',
  'health.model.size': 'About 7.2 GB.',
  'health.warming': 'Preparing the model',
  'health.aboutSec': 'about {sec}s',

  'panel.conversations': 'Conversations',
  'panel.empty.ready': 'How can I help?',
  'panel.empty.readyBody':
    'An AI aide that runs entirely on this computer. Your conversations never leave it.',
  'panel.empty.body': 'An AI browser aide that runs on your machine. Works without internet.',
  'panel.generating': 'Generating',
  'panel.readingPage': 'Reading the page',
  'panel.elapsedSec': '{sec}s',
  'panel.regenerate': 'Regenerate',
  'panel.regenerateHint': 'Generate the last answer again',
  'panel.attachPage': 'Attach page',
  'panel.attachPageHint': "Attach this page's text to the conversation (about {sec}s)",
  'panel.attachScreen': 'Attach screen',
  'panel.attachScreenHint': 'Capture the current screen and attach it (about 5s)',
  'panel.reading': 'Reading…',
  'panel.secShort': '{sec}s',

  'agent.toggleOn':
    'Agent mode — reads and operates the page directly. Clicks, typing and navigation need your approval.',
  'agent.toggleOff': 'Turn off agent mode',
  'agent.turn': 'Agent turn {turn}/{max}',
  'agent.label': 'Agent',
  'agent.on': 'on',
  'agent.approval.title': 'Approval required',
  'agent.steps.show': 'Show result',
  'agent.approval.ask': 'Run this action?',
  'agent.approval.target': 'Target',
  'agent.approval.page': 'Page',
  'agent.approval.deny': 'Deny',
  'agent.approval.allow': 'Approve and run',
  'agent.steps.choosing': 'Choosing the next action…',
  'agent.steps.approved': 'approved',
  'agent.steps.denied': 'denied',
  'agent.steps.sec': '{sec}s',
  'conv.title': 'Chats',
  'msg.charCount': '{n} chars',

  'msg.thinking': 'Thinking…',
  'msg.thoughts': 'Thoughts',
  'msg.generating': 'Generating response',
  'msg.coldStart': ' · cold start',
  'msg.aborted': 'Stopped here.',

  'page.method.readability': 'Article',
  'page.method.innerText': 'Screen text',
  'page.method.youtube': 'Captions',
  'page.detach': 'Detach page',
  'page.truncated': 'first {pct}% only',
  'page.tokens': '{n} tokens',
  'page.screenshot': 'Screen capture',
  'page.screenshotAlt': 'Attached screen capture',
  'page.screenshotDetach': 'Detach screen capture',
  'page.attached': 'You can keep asking about this page. Follow-up questions are fast.',
  'page.costHint': 'Reading the text takes about {sec}s; a screen capture about 5s.',
  'page.reading': 'Reading the page…',
  'page.restricted': "This page's contents can't be read. Try a regular web page.",
  'page.truncateNotice': 'The page was long, so only the first {pct}% was used.',
  'page.staleNotice':
    'The page changed, so the previous text was detached. The current page was not used.',

  'conv.empty': 'No saved conversations.',
  'conv.deleteOne': 'Delete {title}',
  'conv.localHost': 'local',
  'conv.unknownHost': 'unknown',
  'conv.justNow': 'just now',
  'conv.minAgo': '{n} min ago',
  'conv.hourAgo': '{n} h ago',
  'conv.dayAgo': '{n} d ago',
  'conv.newChat': 'New chat',

  'composer.blocked': 'Check the Ollama connection first',
  'composer.agent': 'What should I do?  (operates the page directly)',
  'composer.normal': 'Ask me anything  ( / for commands )',
  'composer.label': 'Message input',
  'composer.stop': 'Stop generating',
  'composer.stopShort': 'Stop',
  'composer.send': 'Send',
  'composer.sendHint': 'Send (Enter)',
  'composer.commands': 'Command list',
  'composer.needsPage': 'page',
  'composer.needsScreen': 'screen',
} satisfies Record<MessageKey, string>;

export const MESSAGES = { ko, en } as const;
