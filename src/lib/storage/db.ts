/**
 * 대화 영속화 — Dexie(IndexedDB). 계획서 §4.3 / Phase 2-4
 *
 * 설정은 chrome.storage.local(settings.ts), 대화는 여기다. 대화는 양이
 * 커지고 인덱스 조회가 필요하므로 IndexedDB가 맞다.
 */

import Dexie, { type EntityTable } from 'dexie';
import type { PerfSample } from '@/types/ollama';

export interface Conversation {
  id: number;
  /** ★ 탭별 세션 분리(Phase 2-5)의 키. -1이면 탭에 묶이지 않은 대화. */
  tabId: number;
  title: string;
  /** 이 대화가 시작된 페이지. 탭이 다른 곳으로 이동하면 새 대화를 연다. */
  originUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 모델의 추론 텍스트. 접이식으로 보여주고, 다음 턴 컨텍스트에는 넣지 않는다. */
  thinking?: string;
  /** 페이지 본문을 절단했을 때의 고지. 메시지에 붙여 영구 보존한다. */
  notice?: string;
  /** 성능 계측. 계획서 §6 목표 대조와 Phase 7-1 대시보드에 쓴다. */
  perf?: PerfSample;
  /** 생성이 중단되었는가 */
  aborted?: boolean;
  error?: string;
  createdAt: number;
}

class SaideDB extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>;
  messages!: EntityTable<StoredMessage, 'id'>;

  constructor() {
    super('saide');
    this.version(1).stores({
      conversations: '++id, tabId, createdAt, updatedAt, title',
      messages: '++id, conversationId, createdAt',
      // Phase 6 (선택) — bge-m3 임베딩 1024-dim
      pageVectors: '++id, url, visitedAt',
    });
  }
}

export const db = new SaideDB();

/* ── 대화 ──────────────────────────────────────────────── */

export async function createConversation(
  tabId: number,
  originUrl: string,
  title = '새 대화',
): Promise<number> {
  const now = Date.now();
  return db.conversations.add({ tabId, originUrl, title, createdAt: now, updatedAt: now });
}

/**
 * 해당 탭의 가장 최근 대화를 찾는다. 없으면 만든다.
 *
 * 탭이 다른 사이트로 이동하면 이전 대화를 이어붙이는 게 부자연스러우므로
 * 호스트가 달라지면 새 대화를 연다.
 */
export async function getOrCreateForTab(
  tabId: number,
  url: string,
): Promise<Conversation> {
  const existing = await db.conversations
    .where('tabId')
    .equals(tabId)
    .reverse()
    .sortBy('updatedAt');

  const prev = existing[0];
  if (prev && sameHost(prev.originUrl, url)) return prev;

  const id = await createConversation(tabId, url);
  return (await db.conversations.get(id))!;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return a === b;
  }
}

export async function listConversations(limit = 50): Promise<Conversation[]> {
  return db.conversations.orderBy('updatedAt').reverse().limit(limit).toArray();
}

export async function renameConversation(id: number, title: string): Promise<void> {
  await db.conversations.update(id, { title, updatedAt: Date.now() });
}

export async function deleteConversation(id: number): Promise<void> {
  // 메시지를 먼저 지운다. 순서가 반대면 고아 레코드가 남는다.
  await db.transaction('rw', db.messages, db.conversations, async () => {
    await db.messages.where('conversationId').equals(id).delete();
    await db.conversations.delete(id);
  });
}

export async function deleteAllConversations(): Promise<void> {
  await db.transaction('rw', db.messages, db.conversations, async () => {
    await db.messages.clear();
    await db.conversations.clear();
  });
}

/* ── 메시지 ────────────────────────────────────────────── */

export async function listMessages(conversationId: number): Promise<StoredMessage[]> {
  return db.messages.where('conversationId').equals(conversationId).sortBy('createdAt');
}

export async function addMessage(
  msg: Omit<StoredMessage, 'id' | 'createdAt'> & { createdAt?: number },
): Promise<number> {
  const id = await db.messages.add({ ...msg, createdAt: msg.createdAt ?? Date.now() });
  await db.conversations.update(msg.conversationId, { updatedAt: Date.now() });
  return id;
}

export async function updateMessage(
  id: number,
  patch: Partial<StoredMessage>,
): Promise<void> {
  await db.messages.update(id, patch);
}

export async function deleteMessagesFrom(
  conversationId: number,
  createdAtInclusive: number,
): Promise<void> {
  // 재생성: 해당 시점 이후 메시지를 걷어낸다.
  await db.messages
    .where('conversationId')
    .equals(conversationId)
    .filter((m) => m.createdAt >= createdAtInclusive)
    .delete();
}

/** 첫 사용자 메시지로 대화 제목을 만든다. 별도 LLM 호출은 낭비다(21 tok/s). */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= 28 ? clean || '새 대화' : `${clean.slice(0, 28)}…`;
}
