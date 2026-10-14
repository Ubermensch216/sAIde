/**
 * 기사 본문 고르기. 리더 모드(Readability) 앞뒤에 두 겹을 덧댄다.
 *
 * ★ 실측(2026-10-14, 네이버 뉴스 강원도민일보 기사): 본문은 356자인데 추출 결과는
 *   8,207자였다. 메뉴·"음성 재생 시 데이터 통화료" 안내·언론사 많이 본 뉴스 목록이
 *   본문보다 20배 많았고, 그 탓에 실측 3,616토큰이 되어 컨텍스트를 넘겼다.
 *
 *   원인은 Readability의 charThreshold(기본 500자)다. 가장 엄격한 첫 시도가 짧은
 *   본문을 정확히 찾아도 500자에 못 미치면 버리고, 조건을 풀어 가며 다시 찾다가
 *   끝내 **가장 긴 시도 — 사실상 페이지 전체**를 돌려준다. 짧은 기사(단신·보도자료)는
 *   어느 사이트에서나 이 경로를 탄다.
 *
 * 그래서 ① 구조를 아는 사이트는 본문 요소를 직접 읽고, ② 나머지는 문턱을 낮춰
 * 짧은 본문도 받되, 기본 문턱의 결과가 링크 목록 덩어리가 아닐 때는 그쪽을 쓴다.
 */

import { Readability } from '@mozilla/readability';

export interface ArticleText {
  text: string;
  method: 'site' | 'readability';
}

/* ── ① 사이트별 규칙 ─────────────────────────────────── */

interface SiteRule {
  hosts: RegExp;
  /** 앞에서부터 처음 찾은 요소를 본문으로 쓴다. */
  body: string[];
  title?: string[];
  /** 제목 아래 한 줄로 붙일 정보(언론사·입력 시각·기자). */
  meta?: (doc: Document) => string[];
  /** 본문 안에서도 읽지 않을 요소. */
  drop?: string[];
}

const SITE_RULES: SiteRule[] = [
  {
    // n.news.naver.com/mnews/article/…, news.naver.com/main/read…, m.news.naver.com
    hosts: /(^|\.)news\.naver\.com$/,
    body: ['#dic_area', '#newsct_article', '#articleBodyContents'],
    title: ['#title_area', '.media_end_head_headline'],
    meta: (doc) => [
      attr(doc, 'meta[name="twitter:creator"]', 'content'),
      ...[...doc.querySelectorAll('.media_end_head_info_datestamp_bunch')].map((el) =>
        squash(el.querySelector('.media_end_head_info_datestamp_term')?.textContent) +
        ' ' + squash(el.querySelector('.media_end_head_info_datestamp_time')?.textContent),
      ),
      squash(doc.querySelector('.media_end_head_journalist_name')?.textContent),
    ],
    drop: ['script', 'style', '.vod_player_wrap'],
  },
];

/** 이보다 짧으면 규칙이 엉뚱한 요소를 잡은 것으로 보고 리더 모드에 넘긴다. */
const MIN_SITE_BODY = 50;

function siteArticle(doc: Document, url: string): string | null {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const rule = SITE_RULES.find((r) => r.hosts.test(host));
  if (!rule) return null;

  const found = first(doc, rule.body);
  if (!found) return null;
  // 살아 있는 문서를 건드리지 않는다. 지울 것은 복제본에서 지운다.
  const body = found.cloneNode(true) as Element;
  for (const sel of rule.drop ?? []) body.querySelectorAll(sel).forEach((el) => el.remove());
  const text = blockText(body);
  if (text.replace(/\s/g, '').length < MIN_SITE_BODY) return null;

  const title = rule.title ? squash(first(doc, rule.title)?.textContent) : '';
  const meta = (rule.meta?.(doc) ?? []).map((s) => s.trim()).filter(Boolean).join(' · ');
  return [title, meta, text].filter(Boolean).join('\n\n');
}

/* ── ② 리더 모드 ─────────────────────────────────────── */

/**
 * 짧은 본문을 받아들일 문턱. 두세 문장짜리 단신도 대개 100자는 넘는다.
 *
 * ★ 문턱만 낮춘다고 긴 기사가 손해 보지 않는다. Readability는 가장 엄격한 첫
 *   시도가 문턱을 넘으면 바로 돌려주므로, 500자 이상인 기사는 두 문턱의 결과가 같다.
 */
export const LOOSE_CHAR_THRESHOLD = 100;
const DEFAULT_CHAR_THRESHOLD = 500;

/**
 * 기본 문턱의 결과가 이보다 링크 비중이 높으면 페이지 전체로 물러난 것으로 본다.
 * 실측: 페이지 전체로 물러난 결과 0.82, 실제 본문 0.00.
 */
const FALLBACK_LINK_DENSITY = 0.5;

function readabilityArticle(doc: Document): string | null {
  const loose = parse(doc, LOOSE_CHAR_THRESHOLD);
  if (loose && loose.length >= DEFAULT_CHAR_THRESHOLD) return blockText(loose.root);

  // 짧다. 엄격한 시도가 본문 일부만 남겼을 수도 있으니 기본 문턱의 결과도 본다.
  const strict = parse(doc, DEFAULT_CHAR_THRESHOLD);
  if (!loose) return strict ? blockText(strict.root) : null;
  if (!strict || linkDensity(strict.root) > FALLBACK_LINK_DENSITY) return blockText(loose.root);
  return blockText(strict.root);
}

/** Readability 결과를 요소로 돌려받는다. 문서를 파괴적으로 고치므로 복제본에 돌린다. */
function parse(doc: Document, charThreshold: number): { root: Element; length: number } | null {
  try {
    const clone = doc.cloneNode(true) as Document;
    const article = new Readability(clone, { charThreshold }).parse();
    if (!article?.content) return null;
    // ★ DOMParser 문서는 비활성이다 — 스크립트가 돌지 않고 이미지도 받지 않는다.
    const parsed = new DOMParser().parseFromString(article.content, 'text/html');
    return { root: parsed.body, length: (article.textContent ?? '').trim().length };
  } catch {
    return null;
  }
}

function linkDensity(root: Element): number {
  const all = (root.textContent ?? '').replace(/\s/g, '').length;
  if (!all) return 0;
  let links = 0;
  for (const a of root.querySelectorAll('a')) links += (a.textContent ?? '').replace(/\s/g, '').length;
  return links / all;
}

/* ── 공용 ─────────────────────────────────────────────── */

/**
 * 구조화 사이트 → 리더 모드 순서로 본문을 고른다. 둘 다 못 찾으면 null.
 * 호출자가 화면 글자 전체(collectDocumentText)로 물러난다.
 */
export function extractArticle(doc: Document, url: string): ArticleText | null {
  const site = siteArticle(doc, url);
  if (site) return { text: site, method: 'site' };
  const reader = readabilityArticle(doc);
  return reader ? { text: reader, method: 'readability' } : null;
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG', 'BUTTON']);

/**
 * 요소의 글자를 줄 구조째 읽는다.
 *
 * ★ textContent는 <br>과 문단 경계를 버린다. 네이버 기사는 문단을 <br><br>로만
 *   나누는데, textContent로 읽으면 "열었다.춘천시"처럼 문장이 붙어 모델이 문단을
 *   구분하지 못한다. innerText는 레이아웃이 있는 요소에서만 동작해 복제본·파싱한
 *   문서에는 쓸 수 없다.
 */
export function blockText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP.has(el.tagName.toUpperCase())) return;
    if (el.tagName === 'BR') {
      out.push('\n');
      return;
    }
    const block = BLOCK.has(el.tagName.toUpperCase());
    if (block) out.push('\n\n');
    for (const child of el.childNodes) walk(child);
    if (block) out.push('\n\n');
  };
  walk(root);
  return out.join('');
}

function first(doc: Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function attr(doc: Document, selector: string, name: string): string {
  return squash(doc.querySelector(selector)?.getAttribute(name));
}

function squash(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}
