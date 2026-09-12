# sAIde — 현행 구현 및 개선 계획

갱신: **2026-09-12**. 현재 계약은 [아키텍처](../docs/ARCHITECTURE.md), 문제 근거는 [프로젝트 분석](../docs/PROJECT_REVIEW.md), 실행 기록은 [검증](../docs/VALIDATION.md)이 기준이다. 과거 v3의 장비 실험과 구현 이력은 Git 이력으로 보존한다.

## 1. 기술 스택과 구조

React 19 / TypeScript 7 / WXT 0.21 / Vite 8 / Tailwind 4 / Zustand 5 / Dexie 4 / Readability / DOMPurify / marked / Shiki. 버전 해석은 package-lock.json을 기준으로 한다.

```text
src/entrypoints/
  background.ts       브라우저 이벤트·주입·탭 액션
  injected.ts         본문 추출·DOM 동작
  sidepanel/          채팅 UI·권한 진입점
  options/            연결·성능·기억·프리셋·권한 설정
src/lib/
  agent/              스키마·루프·실행기
  browser/            요청·캡처 보호·문서별 승인·브라우저 fixture 테스트
  chat/               상태·컨텍스트
  ollama/             HTTP·스트림·오류
  storage/            설정·프리셋·DB
  memory/             임베딩 큐·검색·보관
  extract/            본문 예산·페이지 종류·자막
  i18n/ brand/ perf/  번역·시각 토큰·성능 집계
public/               아이콘·Chrome 언어 리소스
brand/                디자인 및 스토어 자산
plan/                 현재 계획·수동 점검
scripts/ docs/        문서·UI 예시 캡처 환경
```

## 2. 유지해야 할 계약

1. 모델 호출은 패널 문서에서 진행하고 워커에 장시간 스트리밍 수명을 의존하지 않는다.
2. 페이지 주입은 필요 시 수행한다. 사이트 권한 요청은 사용자의 클릭 경로에서 한다.
3. 페이지·도구·기억 본문은 신뢰하지 않는 데이터다. 프롬프트 태그만으로 안전을 보장하지 않는다.
4. 클릭·입력·이동의 승인 절차를 생략하는 옵션을 만들지 않는다.
5. 설정 schema·메시지 envelope·저장 migration을 함께 검토하고 기존 데이터 처리 기준을 정의한다.
6. 초기 시스템/첨부 접두사를 안정적으로 유지하되 전체 입력 예산을 우선 보장한다.
7. 샘플/모의 브라우저 검증과 실제 확장 검증을 명확히 구분한다.

## 3. 1차 개선 — 행동·데이터 안전성

아래 코드 보완과 결정적 회귀 테스트를 구현했다. 실제 확장 브라우저 QA는 별도 미완료다. [이번 실행 결과](system-hardening.md)에 항목별 상태를 기록한다.

| 항목 | 작업 | 회귀 검증 / 완료 조건 |
|---|---|---|
| R01 | 캡처 tab/window/document 검증 | A 요청 후 B 전환, 다중 창, 닫힌 탭에서 잘못된 화면을 반환하지 않음 |
| R02 | requestId·deadline·취소 전달 | 무응답 워커의 대기 종료, 늦은 결과 무시, 중단 후 추가 행동 방지 |
| R03 | 승인 시 대상 고정·재확인 | 승인 중 DOM 교체·주소 변경 시 실행 거부 또는 재승인 |
| R04 | memory epoch·삭제 barrier·도메인 공통 판정 | 지연 임베딩 중 제외/끄기/전체 삭제, 하위 도메인 삭제 후 재생성 없음 |
| R05 | 대화별/요청별 작업 소유권 | 늦은 A 응답이 B의 메시지/abort/streaming을 수정하지 않음 |

Chrome API mock과 실제 content listener/React 폼 fixture로 경합을 검사한다. signal을 무시하는 도구와 주입 중 취소도 검증했다. 실제 Chrome 이벤트 순서와 권한 처리는 E2E로 추가 확인한다.

## 4. 2차 개선 — 입력·설정·프로토콜

| 항목 | 작업 | 완료 조건 |
|---|---|---|
| R06 | 시스템/도구/첨부/출력 합산 예산 | 모든 설정 조합에서 초과 입력을 줄이거나 명시 거부, 에이전트 매 턴 상한 |
| R07 | 공통 settings hook·검증·저장 직렬화 | 저장 endpoint로 최초 probe, ko/en 즉시 반영, 여러 설정 페이지 변경 일관 |
| R08 | show capability·network timeout·stream error | tags capability 없는 fixture, 403/404/OOM/done 없는 EOF를 올바르게 안내 |

전송 예산 거부, 설정 정규화·Web Locks·변경 구독, show 조회·tools/vision gate·HTTP 시간 제한·NDJSON 검증을 적용했다. pinned 자동 축약, 서버 버전별 계약, 프리셋 저장 직렬화와 원격 endpoint 전용 권한 UX는 남아 있다. 진행 중 모델 호출에는 전송 당시 settings snapshot을 사용한다.

## 5. 3차 개선 — 데이터와 사용자 경험

- 완료: 개별 대화 삭제 확인, 검색 보관 기간·제외 도메인·차원·유사도 하한 검사.
- 잔여: 대화 검색/페이지 이동/전체 삭제/내보내기·복원/undo, 모델 digest 검증·재임베딩.
- 첨부 근거 보존 여부와 저장 용량 정책. 캡처 이미지를 자동 영구 보존할 경우 opt-in과 삭제 UI부터 설계.
- 완료: React controlled input, 중복·숨김·disabled 거부, 대화 선택 버튼·승인 포커스 순환/복구. 잔여: 가려진 요소·SPA·iframe·Shadow DOM 실제 사이트 검증.
- 잔여: 좁은 패널·200% 확대·스크린리더·고대비 종합 QA.
- 실패한 임베딩·저장 작업의 사용자 알림과 재시도 경로.

## 6. 배포 관문

| 항목 | 현황 | 완료 조건 |
|---|---|---|
| README/개발 문서 | 이번 갱신 | 기능 변경 때 코드와 함께 갱신 |
| UI 예시 캡처 | 문서용 harness 제공 | 실제 확장 캡처를 추가하고 샘플과 구분 |
| 의존성 추적 정리 | 4,100파일 추적 해제, 설치 보존 | 격리 offline npm ci 통과; 빈 캐시 네트워크 설치 잔여 |
| 런타임 명시 | Node 24/npm 11, .nvmrc, packageManager, Chrome 116 선언 | 다른 OS의 동일 버전 실행 확인 |
| CI | Windows/Linux workflow와 artifact 검사 추가 | 로컬 새 설치 pipeline 통과; 원격 CI 실행 잔여 |
| 보안 감사 | 이번 미실행 | lockfile 의존성 감사·위험 검토 기록 |
| 라이선스 | 없음 | 소유자의 배포/사용 조건 결정과 LICENSE |
| 개인정보 고지 | 사용자 안내 보강 | 스토어용 공개 URL·데이터 흐름 일치 검토 |
| 스토어 제출 | 미수행 | 실확장 이미지·ZIP·문구·권한 사유·정책 확인 |

## 7. 테스트 운영

기본 `npm test`는 `src/**/*.test.ts`만 실행한다. `npm run test:live`는 5개 `*.itest.ts` 파일을 대상으로 하며 일부는 모델 정확도·성능 실험이다. 실제 브라우저 DOM 실행 테스트와 같은 의미가 아니다.

```powershell
npm run compile
npm test
npm run build
node scripts/verify-build.mjs
npm run test:live -- src/lib/ollama/live.itest.ts
```

전체 live 실험은 모델을 장시간 점유하므로 전용 환경에서 수행한다. 도구 선택 평가에는 `SAIDE_TOOLS`와 `SAIDE_AGENT_THINK` 옵션이 있으나 전체 suite의 설정을 대체하지 않는다. 다음 리팩터링에서 endpoint/model/context를 환경 변수로 통합하고 smoke·정확도·성능 테스트를 분리한다.

성과 기준은 단위 테스트 개수 증가가 아닌 재현 가능한 실패 시나리오 해결이다. [수동 점검표](phase5-tool-checklist.md)의 실제 페이지 테스트와 함께 완료 판정한다.
