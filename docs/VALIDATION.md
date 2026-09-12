# 검증 기록

검증일: **2026-09-12 (Asia/Seoul)** · 프로젝트 0.1.0. 문서 갱신과 분석을 위한 검증이며 출시 인증이나 종합 보안 감사가 아니다.

## 환경

| 항목 | 확인값 |
|---|---|
| 작업 폴더 | `D:\Dev\sAIde` |
| OS / 셸 | Windows / PowerShell |
| Node / npm | 24.18.0 / 11.16.0 |
| WXT / Vite / Vitest | 0.21.4 / 8.2.1 / 4.1.11 |
| Ollama endpoint / version | `http://localhost:11434` / 0.32.5 |
| 설치 모델 | `gemma4:e2b`, `bge-m3:latest` |
| 설치 모델 크기(API) | 7,162,405,886 / 1,157,672,605 bytes |

## 실행 결과

| 명령 / 검사 | 결과 | 범위 |
|---|---|---|
| `npm test` | **18파일, 299개 통과** | `src/**/*.test.ts`, 보고된 suite 시간 15.23초 |
| `npm run compile` | **통과** | TypeScript. 문서 하니스 추가 후에도 재확인 |
| `npm run build` | **통과** | Chrome MV3, WXT 보고 8.855초, 총 약 1.75 MB |
| `/api/version`, `/api/tags` | **응답 확인** | 위 서버 버전과 설치 모델 |
| `npm run test:live -- src/lib/ollama/live.itest.ts` | **1파일, 4개 통과** | suite 시간 170.15초 |
| 문서 UI 캡처 | **5장 생성, 육안 확인** | 실제 UI 컴포넌트 + 샘플 데이터, 브라우저 E2E 아님 |
| 문서 링크 검사 | **10개 Markdown 문서, 로컬 링크 72개 통과** | 파일 존재, 문서 제목 앵커·소스 행 번호 범위 |
| `git diff --check` | **통과** | 변경 파일 공백 오류 검사 |

live 4개는 실제 서버 health, 없는 모델 분류, show capabilities, 짧은 스트리밍과 지표를 검사했다. 출력 텍스트 정확성·전체 도구 성공률·이미지 이해·RAG 품질을 평가한 결과는 아니다.

기존 node_modules를 이용했다. **clean clone의 `npm ci`는 이번에 실행하지 않았다.** 특히 node_modules 4,100파일이 Git 추적 대상이라 clean install 재현성 점검이 별도로 필요하다. 새 패키지 설치나 의존성 버전 변경은 하지 않았다.

생성 manifest에서 sidePanel/activeTab/scripting/storage/contextMenus/tabs, localhost/127.0.0.1 호스트와 optional all_urls, options.html·sidepanel.html을 확인했다. minimum_chrome_version은 선언되어 있지 않다.

## 미실행 또는 제한된 검사

- 실제 Chrome 확장 설치·업데이트·사이트 권한 팝업·다중 창·도구 8종 E2E.
- 전체 `npm run test:live` (5개 통합 파일), 모델 선택 정확도·문맥 캐시·이미지·RAG 전체 실험.
- `npm run zip` 결과 검증과 스토어 제출. build 결과를 ZIP 제출 검증으로 대체하지 않음.
- 의존성 취약점 감사(`npm audit` 등), 실제 외부 통신 전체 기록, 침투 테스트.
- macOS/Linux, Firefox/Edge, 저사양/다른 GPU, 다양한 Ollama 버전 검증.
- 스크린리더·키보드 전용·확대·좁은 패널을 포함한 종합 접근성 점검.

Browser 스킬에 따라 연결을 시도했지만 도구의 app-server 경로 오류로 탭 조회가 실패했다. 기존 Chrome 사용자 세션 대신 분리된 문서 프로필에서 headless Chrome을 실행했다. 최초 샌드박스 내 GPU 프로세스 실패 후 허용된 별도 프로세스 실행으로 캡처했다. 샘플 화면에 연결 성공이 보여도 실제 확장 CORS 검증을 뜻하지 않는다.

## 분석 결과 해석

[프로젝트 분석](PROJECT_REVIEW.md)의 R01~R12는 코드 근거 중심이다. 전체 브라우저 재현을 수행하지 않았으므로 “실제 공격 성공” 또는 “운영 중 데이터 손상 발생”으로 읽지 않는다. 이미 확보한 단위 테스트가 포착하지 못하는 경합·취소·권한 경계를 중심으로 후속 재현 조건과 완료 기준을 제안했다.

과거 계획서의 93.8% 도구 정확도, 21.5초 로드, 131 tok/s 등은 이번 재측정 값이 아니다. 현재 보고서의 테스트 시간과 과거 모델 성능을 섞지 않는다.
