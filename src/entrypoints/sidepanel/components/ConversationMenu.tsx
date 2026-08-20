/**
 * 대화 목록. 계획서 Phase 2-4
 */

import { useT } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import {
  deleteConversation,
  listConversations,
  type Conversation,
} from '@/lib/storage/db';

interface Props {
  currentId: number | null;
  onPick: (c: Conversation) => void;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

export function ConversationMenu({ currentId, onPick, onClose, onDeleted }: Props) {
  const t = useT();
  const [items, setItems] = useState<Conversation[]>([]);

  const reload = () => listConversations().then(setItems);
  useEffect(() => {
    void reload();
  }, []);

  const remove = async (e: React.MouseEvent, c: Conversation) => {
    e.stopPropagation();
    await deleteConversation(c.id);
    onDeleted(c.id);
    void reload();
  };

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={t('panel.conversations')}>
        <div className="sheet-head">
          <span>{t('conv.title')}</span>
          <button className="btn-sm" onClick={onClose}>
            {t('ui.close')}
          </button>
        </div>

        {items.length === 0 && <div className="sheet-empty">{t('conv.empty')}</div>}

        <ul className="conv-list">
          {items.map((c) => (
            <li
              key={c.id}
              className={c.id === currentId ? 'current' : ''}
              onClick={() => onPick(c)}
            >
              <div className="conv-main">
                <div className="conv-title">{c.title}</div>
                <div className="conv-meta">
                  {hostOf(c.originUrl)} · {relTime(c.updatedAt)}
                </div>
              </div>
              <button
                className="conv-del"
                onClick={(e) => remove(e, c)}
                aria-label={t('conv.deleteOne', { title: c.title })}
                title={t('ui.delete')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || '로컬';
  } catch {
    return '알 수 없음';
  }
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
