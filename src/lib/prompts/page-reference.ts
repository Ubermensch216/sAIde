/**
 * 자유 입력이 "지금 보고 있는 페이지"를 가리키는지 가린다.
 *
 * ★ 이 확장은 페이지를 상시로 읽지 않는다(설계 결정 ②). 본문은 사용자가 버튼·슬래시
 *   커맨드로 붙인 뒤에만 모델에게 간다. 그런데 사용자는 "이 페이지의 내용을 설명해줘"를
 *   그냥 입력창에 친다. 첨부가 없으면 모델은 어느 페이지인지 알 길이 없어 "어떤 페이지를
 *   말씀하시는지 알려주세요"라고 되묻는다 — 읽기 실패처럼 보이지만 실제로는 읽지 않은 것이다.
 *   이 판정이 참이면 전송 전에 본문을 붙인다.
 *
 * ★ 보수적으로 잡는다. 오탐은 15초짜리 프리필과 권한 요청을 공연히 물리므로,
 *   "이/현재/지금/해당 + 페이지·글·기사…"처럼 지시어와 대상이 함께 있을 때만 참이다.
 */

const KO_DEMONSTRATIVE = '(?:이|현재|지금\\s*(?:보고\\s*있는|열려\\s*있는)?|해당|열려\\s*있는|보고\\s*있는)';
const KO_NOUN =
  '(?:웹\\s*페이지|페이지|웹\\s*사이트|사이트|기사|뉴스|게시물|게시글|포스트|블로그\\s*글|문서|논문|본문|글|화면)';
// 명사 뒤에는 조사만 허용한다. "이 글자", "이 문서화" 같은 다른 낱말은 걸러진다.
const KO_PARTICLE = '(?:을|를|은|는|이|가|의|에서|에|으로|로|도|과|와|만|좀)?';

const KO = new RegExp(`${KO_DEMONSTRATIVE}\\s*${KO_NOUN}${KO_PARTICLE}(?![가-힣])`);

const EN = /\b(?:this|the\s+current|current|the\s+open)\s+(?:web\s*)?(?:page|article|site|website|post|document|tab)\b/i;

/** 입력이 현재 탭의 페이지를 가리키면 true. */
export function refersToCurrentPage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // 슬래시·@ 명령은 자기 경로가 첨부를 처리한다.
  if (/^[/@]/.test(t)) return false;
  return KO.test(t) || EN.test(t);
}
