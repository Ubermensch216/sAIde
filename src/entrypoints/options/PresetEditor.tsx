/**
 * 사용자 정의 프리셋 편집. 계획서 §5 Phase 4-4
 *
 * 슬래시 커맨드로 바로 쓸 수 있는 자기만의 프롬프트를 만든다.
 * `{{selection}}`을 쓰면 커맨드 뒤에 입력한 내용이 그 자리에 들어간다.
 */

import { useEffect, useState } from 'react';
import type { CustomPreset, PresetNeeds } from '@/lib/prompts/presets';
import {
  addCustomPreset,
  deleteCustomPreset,
  loadCustomPresets,
  normalizeSlash,
} from '@/lib/storage/presets';

const NEEDS_LABEL: Record<PresetNeeds, string> = {
  none: '첨부 없음',
  page: '페이지 본문 필요',
  screen: '화면 캡처 필요',
  selection: '입력한 텍스트 대상',
};

export function PresetEditor() {
  const [list, setList] = useState<CustomPreset[]>([]);
  const [label, setLabel] = useState('');
  const [slash, setSlash] = useState('');
  const [template, setTemplate] = useState('');
  const [needs, setNeeds] = useState<PresetNeeds>('none');

  useEffect(() => {
    loadCustomPresets().then(setList);
  }, []);

  const normalized = normalizeSlash(slash);
  const conflict = list.some((p) => p.slash === normalized);
  const canAdd = Boolean(label.trim() && normalized && template.trim());

  const add = async () => {
    if (!canAdd) return;
    setList(await addCustomPreset({ label, slash, template, needs }));
    setLabel('');
    setSlash('');
    setTemplate('');
    setNeeds('none');
  };

  return (
    <section>
      <h2>내 프리셋</h2>

      <div className="field">
        <p className="desc">
          자주 쓰는 프롬프트를 슬래시 커맨드로 등록합니다. 사이드패널 입력창에 <code>/</code>를
          치면 목록이 뜹니다. 본문에 <code>{'{{selection}}'}</code>를 넣으면 커맨드 뒤에 입력한
          내용이 그 자리에 들어갑니다.
        </p>
      </div>

      {list.length > 0 && (
        <div className="field">
          <ul className="preset-list">
            {list.map((p) => (
              <li key={p.id}>
                <div className="preset-main">
                  <div className="preset-head">
                    <code>/{p.slash}</code>
                    <strong>{p.label}</strong>
                    <span className="preset-needs">{NEEDS_LABEL[p.needs]}</span>
                  </div>
                  <div className="preset-body">{p.template}</div>
                </div>
                <button
                  className="btn-sm"
                  onClick={async () => setList(await deleteCustomPreset(p.id))}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <div className="row">
          <label htmlFor="p-label">이름</label>
          <input
            id="p-label"
            type="text"
            value={label}
            placeholder="예: 회의록 정리"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div className="row">
          <label htmlFor="p-slash">명령어</label>
          <input
            id="p-slash"
            type="text"
            value={slash}
            placeholder="minutes"
            onChange={(e) => setSlash(e.target.value)}
          />
        </div>
        {normalized && (
          <p className={conflict ? 'warn' : 'desc'}>
            <code>/{normalized}</code>
            {conflict ? ' — 같은 이름이 있습니다. 저장하면 덮어씁니다.' : ' 로 저장됩니다.'}
          </p>
        )}

        <div className="row">
          <label htmlFor="p-needs">필요한 첨부</label>
          <select
            id="p-needs"
            value={needs}
            onChange={(e) => setNeeds(e.target.value as PresetNeeds)}
          >
            {(Object.keys(NEEDS_LABEL) as PresetNeeds[]).map((k) => (
              <option key={k} value={k}>
                {NEEDS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <p className="desc">
          '페이지 본문 필요'를 고르면 명령 실행 시 본문을 먼저 읽습니다(약 15초). '화면 캡처'는 약
          5초로 더 빠릅니다.
        </p>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label htmlFor="p-template">본문</label>
          <textarea
            id="p-template"
            rows={4}
            value={template}
            placeholder={'다음 회의록에서 결정 사항과 할 일만 뽑아줘.\n\n{{selection}}'}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </div>

        <button className="btn btn-primary" disabled={!canAdd} onClick={add}>
          추가
        </button>
      </div>
    </section>
  );
}
