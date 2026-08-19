/**
 * 오류 코드 → 사용자 화면 문구. 계획서 §5 Phase 7-2 (완료 기준: ErrorCode 전 종류 UI 확인)
 *
 * ★ 왜 한곳에 모으는가.
 *   오류 문구가 발생 지점마다 흩어져 있으면 어떤 코드가 화면에 어떻게 보이는지
 *   아무도 전수 확인할 수 없다. 실제로 `ACTION_DENIED`와 `OOM`은 Phase 5까지
 *   화면 문구가 아예 없었다 — 배너에 원문 메시지가 그대로 떨어졌다.
 *
 * ★ 세 가지를 반드시 채운다.
 *   ① 무슨 일이 일어났는지 (title)
 *   ② 왜 그런지 (body) — 사용자가 자기 잘못인지 판단할 수 있어야 한다
 *   ③ 무엇을 하면 되는지 (fix / command / retry) — 없으면 넣지 않는다.
 *      "다시 시도하세요"만 적는 것은 도움이 아니라 소음이다.
 *
 * ★ 이 파일의 switch는 **빠짐없이** 다뤄야 한다. 새 ErrorCode를 추가하면
 *   never 검사에서 컴파일이 깨진다 — 문구를 잊고 배포하는 경로를 막는다.
 */

import type { AppError, ErrorCode } from '@/lib/messaging/protocol';
import { CORS_COMMAND, DOWN_HINT, pullCommand } from '@/lib/ollama/errors';

export type Severity =
  /** 사용자가 뭔가 해야 풀린다 */
  | 'blocked'
  /** 이번 요청만 실패했다. 다시 하면 될 수도 있다 */
  | 'failed'
  /** 오류가 아니라 정상 흐름 */
  | 'info';

export interface ErrorPresentation {
  code: ErrorCode;
  severity: Severity;
  title: string;
  body: string;
  /** 복사 버튼과 함께 보여줄 명령. */
  command?: string;
  /** 버튼으로 걸 동작의 종류. UI가 실제 핸들러를 붙인다. */
  action?: 'retry' | 'grant-host' | 'grant-all' | 'open-settings';
  actionLabel?: string;
  /** 배너를 아예 띄우지 않는다(중단 등). */
  silent?: boolean;
}

export function presentError(e: AppError, model = ''): ErrorPresentation {
  const base = { code: e.code };

  switch (e.code) {
    case 'OLLAMA_DOWN':
      return {
        ...base,
        severity: 'blocked',
        title: 'Ollama가 실행 중이 아닙니다',
        body: `${DOWN_HINT} sAIde는 인터넷이 아니라 이 컴퓨터의 Ollama에 연결합니다.`,
        action: 'retry',
        actionLabel: '다시 확인',
      };

    case 'CORS_BLOCKED':
      return {
        ...base,
        severity: 'blocked',
        title: 'Ollama가 확장의 요청을 거부하고 있습니다',
        body: '아래 명령을 PowerShell에서 실행한 뒤, 트레이의 Ollama를 완전히 종료했다가 다시 시작하세요.',
        command: CORS_COMMAND,
        action: 'retry',
        actionLabel: '다시 확인',
      };

    case 'MODEL_MISSING':
      return {
        ...base,
        severity: 'blocked',
        title: model ? `모델 '${model}'이 설치되어 있지 않습니다` : '모델이 설치되어 있지 않습니다',
        body: '아래 명령으로 내려받은 뒤 다시 확인하세요.',
        command: pullCommand(model || 'gemma4:e2b'),
        action: 'retry',
        actionLabel: '다시 확인',
      };

    case 'OOM':
      return {
        ...base,
        severity: 'blocked',
        title: '모델을 올릴 메모리가 부족합니다',
        // 16GB에 6.9GB 상주가 전제다. 무엇을 줄여야 하는지까지 알려준다.
        body: '설정에서 컨텍스트 길이(num_ctx)를 줄이거나, 메모리를 많이 쓰는 다른 프로그램을 종료한 뒤 다시 시도하세요.',
        action: 'open-settings',
        actionLabel: '설정 열기',
      };

    case 'TIMEOUT':
      return {
        ...base,
        severity: 'failed',
        title: '응답이 오지 않아 중단했습니다',
        body: '이 컴퓨터는 CPU로 추론하기 때문에 긴 페이지에서 느려질 수 있습니다. 페이지 분량을 줄이거나 질문을 짧게 나눠 보세요.',
        action: 'open-settings',
        actionLabel: '설정 열기',
      };

    case 'ABORTED':
      // 사용자가 스스로 멈춘 것이다. 오류로 보여주면 자기가 뭘 잘못한 줄 안다.
      return {
        ...base,
        severity: 'info',
        title: '중단했습니다',
        body: '',
        silent: true,
      };

    case 'TAB_RESTRICTED':
      return {
        ...base,
        severity: 'failed',
        title: '이 페이지에서는 내용을 읽을 수 없습니다',
        body: 'chrome:// 페이지와 크롬 웹스토어에서는 브라우저가 확장 스크립트 실행을 금지합니다. 일반 웹페이지에서 다시 시도하세요.',
      };

    case 'HOST_PERMISSION_REQUIRED':
      return {
        ...base,
        severity: 'blocked',
        title: '이 사이트에 접근할 권한이 없습니다',
        body: '설치할 때는 아무 사이트 권한도 받지 않기 때문에, 필요한 순간에만 요청합니다. 허용하면 이 사이트에서만 동작합니다.',
        action: 'grant-host',
        actionLabel: '권한 허용',
      };

    case 'ACTION_DENIED':
      return {
        ...base,
        severity: 'info',
        title: '동작을 실행하지 않았습니다',
        body: e.message || '승인되지 않아 페이지를 건드리지 않았습니다.',
      };

    case 'UNKNOWN':
      return {
        ...base,
        severity: 'failed',
        title: '문제가 발생했습니다',
        // 원문을 감추지 않는다. 우리가 분류하지 못한 오류라 이게 유일한 단서다.
        body: e.hint ? `${e.message} ${e.hint}` : e.message || '알 수 없는 오류입니다.',
      };
  }

  // 새 ErrorCode를 추가하고 문구를 빠뜨리면 여기서 컴파일이 깨진다.
  return assertNever(e.code);
}

function assertNever(code: never): never {
  throw new Error(`문구가 정의되지 않은 오류 코드: ${String(code)}`);
}

/** 화면 문구가 정해져 있는 전체 코드 목록. 테스트와 설정 화면 점검에 쓴다. */
export const ALL_ERROR_CODES: ErrorCode[] = [
  'OLLAMA_DOWN',
  'MODEL_MISSING',
  'CORS_BLOCKED',
  'OOM',
  'TIMEOUT',
  'ABORTED',
  'TAB_RESTRICTED',
  'HOST_PERMISSION_REQUIRED',
  'ACTION_DENIED',
  'UNKNOWN',
];
