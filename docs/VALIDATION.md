# 검증 기록

검증일: **2026-09-12 (Asia/Seoul)** · sAIde 0.1.0. 분석 후 시스템 보완을 반영한 기록이다. 출시 인증이나 종합 보안 감사는 아니다.

## 환경

| 항목 | 확인값 |
|---|---|
| 폴더 | D:\Dev\sAIde |
| OS / 셸 | Windows / PowerShell |
| Node / npm | 24.18.0 / 11.16.0 |
| WXT / Vite / Vitest | 0.21.4 / 8.2.1 / 4.1.11 |
| Ollama | http://localhost:11434 / 0.32.5 |
| 모델 | gemma4:e2b, bge-m3:latest |

## 실행 결과

| 명령 / 검사 | 결과 | 범위 |
|---|---|---|
| `npm run compile` | 통과 | TypeScript 전체 |
| `npm test` | **28파일 / 346개 통과** | 기존 299개 + 회귀 47개 |
| `npm run build` | 통과 | Chrome MV3, 약 1.86 MB |
| `node scripts/verify-build.mjs` | 통과 | MV3·Chrome 116·호스트·온디맨드 주입·참조 파일 |
| 격리 `npm ci --offline --no-audit --fund=false` | 통과 | 263패키지, 기존 설치 파일 없는 검증 폴더 |
| 격리 compile/test/build/manifest | 모두 통과 | 같은 346개, Windows npm 캐시 설치 환경 |
| `npm run test:live -- src/lib/ollama/live.itest.ts` | **1파일 / 4개 통과** | 약 44.18초, 실제 Ollama 연결·모델·짧은 생성 |
| 문서 UI | 5장 재생성·육안 확인 | 실제 React 컴포넌트 + 샘플 데이터 |
| 문서 링크 검사 | 통과 | 11개 Markdown, 로컬 링크/앵커 87개 |
| `git diff --check` / `--cached --check` | 통과 | 작업 폴더·인덱스 공백 검사 |

새 설치 검증은 `.output/clean-install-validation`에 소스/lockfile을 복사해 수행했다. 최초 샌드박스 실행은 npm 캐시 접근 EPERM으로 실패했고 동일 격리 폴더에서 허용된 캐시 접근으로 재실행해 통과했다. 기존 프로젝트 node_modules를 복사하거나 공유하지 않았다. **clean clone 또는 빈 캐시 네트워크 설치 검증은 아니다.** 의존성 버전 변경 없이 루트 engines 메타데이터만 lockfile에 반영했다.

Git 추적 node_modules는 4,100개에서 0개가 되었고 로컬 설치 파일은 보존했다. 추적 해제는 staged 상태이며 코드·문서는 작업 폴더 변경이다. 커밋/push는 수행하지 않았다. Windows/Linux CI workflow를 추가했으나 GitHub 원격 실행은 아직 하지 않았다.

## 추가 회귀 검증

- 요청 탭의 창을 사용한 캡처, 다른 활성 탭 거부, URL 변경과 A→B→A 전환 중 캡처 폐기.
- sender·payload·deadline·승인 없는 요청 거부; 브라우저 응답 지연 시 취소 통지와 대기 종료.
- 승인 토큰 일회성, 동일 모양의 노드 교체, 폼 목적지/인자 변경 거부.
- 워커 주입 대기 중 취소 후 ACT 미전송, content에서 취소된 요청의 클릭 미실행.
- signal을 무시하는 도구와 대상 설명의 대기 종료, 실패 시 승인/실행 차단.
- 임베딩 지연 중 전체 삭제·제외·끄기·큐 종료 후 저장 차단, 부모/하위 도메인 삭제.
- 만료/제외/다른 차원 기억 검색 배제, 비정상 벡터 저장 거부.
- 대화 A/B 역순 완료, 동시 전송, 중단 후 늦은 스트림, 이전 캡처 반영 차단, 고아 메시지 방지.
- v1 DB의 기존 대화·메시지·벡터를 보존하는 v2 migration.
- 설정 타입/범위/주소 정규화, 동시 read-merge-write, Web Locks 경로, 변경 구독 해제.
- HTTP 403/404/500, 무응답 JSON/스트림, error·깨진 JSON·done 없는 EOF, done 뒤 열린 연결, 전송 예산·모델 기능 거부.
- 실제 React controlled input의 상태 반영, 중복/숨김 대상 거부, 승인 기본 거부·Tab 순환·Escape·포커스 복구.

이 검사는 모의 Chrome API, fake-indexeddb, jsdom, 실제 앱 모듈을 사용한다. 다중 브라우저 문서의 모든 스케줄링과 실제 Chrome 권한을 대신하지 않는다.

## 제한과 남은 검사

- 실제 확장 설치/업데이트·권한 팝업/철회·다중 창·도구 8종 E2E.
- 전체 live 5파일, 모델 선택 정확도·캐시·이미지·RAG 품질 평가. 기본 live 4개만 통과했다.
- 실제 GitHub CI, Linux/macOS·다른 브라우저/장비·Ollama 버전.
- ZIP·스토어 제출, 라이선스·공개 개인정보 고지.
- npm audit 등 의존성 감사, 전체 외부 통신 기록, 침투 테스트.
- 스크린리더·320px·200% 확대·고대비 종합 접근성.

Browser 연결 도구의 app-server 경로 오류로 실제 확장 캡처는 완료하지 못했다. 문서 화면은 별도 headless Chrome 프로필과 샘플 데이터로 생성했다. 화면의 연결 성공 표시는 실제 확장 CORS 검증 증거가 아니다. [캡처 재현](screenshots/README.md)을 참고한다.

## 해석과 재현

[개선 보고서](PROJECT_REVIEW.md)는 구현된 방어와 잔여 제한을 구분한다. 테스트 개수 증가 자체보다 취소·경합·잘못된 입력 시 동작이 확인된 점을 근거로 삼는다. 이전 계획의 93.8% 정확도·21.5초 로드·131 tok/s는 이번 재측정 값이 아니다.

```powershell
npm ci
npm run compile
npm test
npm run build
node scripts/verify-build.mjs
npm run test:live -- src/lib/ollama/live.itest.ts
```

마지막 live 명령은 Ollama와 모델이 설치된 경우에 실행한다. CI는 외부 모델 없이 앞의 설치·타입·단위·빌드·manifest 단계만 수행한다.
