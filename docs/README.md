# 문서 안내

갱신일: **2026-09-12**. 사용자 안내의 시작점은 [루트 README](../README.md)다.

| 대상 | 문서 |
|---|---|
| 사용자 | [설치·사용 매뉴얼](../README.md) |
| 설계 검토자 | [현재 아키텍처](ARCHITECTURE.md), [프로젝트 분석](PROJECT_REVIEW.md) |
| 개발자 | [구현 계획](../plan/saide-implementation-plan.md), [검증 기록](VALIDATION.md) |
| 제품 담당자 | [제품 계획](../plan/saideplan.md) |
| 시스템 보완 검토 | [실행 결과·잔여 작업](../plan/system-hardening.md) |
| 수동 QA | [도구 점검표](../plan/phase5-tool-checklist.md) |
| 문서 유지보수 | [스크린샷 재현](screenshots/README.md), `preview/` |
| 디자인·배포 | [브랜드 시트](../brand/saide-brand-sheet.html), [스토어 자산 안내](../brand/store/README.md) |

## 기준과 갱신 규칙

- 현재 동작은 소스와 이번 검증 결과를 기준으로 기술한다. 과거 장비 실측을 현재 결과나 성능 보장으로 사용하지 않는다.
- 모델/설정 기본값은 `src/lib/storage/settings.ts`, 도구는 `agent/tools.ts`, 권한은 `wxt.config.ts`와 실제 호출부를 함께 확인한다.
- 기능 변경 시 사용자 안내, 아키텍처, 개선 항목 상태, 수동 QA, 관련 캡처를 함께 갱신한다.
- 검사 이름과 날짜·환경·범위를 기록한다. 단위 테스트 통과를 브라우저 E2E 또는 보안 감사 통과로 표현하지 않는다.
- 샘플 데이터를 쓰는 캡처는 예시로 표시하고 실제 확장 캡처와 구분한다.
- 기존 계획서의 과거 내용은 Git 이력에 남는다. 현재 문서에는 구현·미완료·이번 검증 여부를 분리한다.

문서 갱신 후 시스템 코드 보완도 수행했다. 현재 구현은 개선 보고서·실행 계획·검증 기록을 함께 확인한다. 외부 패키지 문서와 생성 산출물은 제품 문서 갱신 대상에서 제외한다. node_modules의 Git 추적은 R11 보완으로 해제했다.
