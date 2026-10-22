import { useEffect, useRef, useState } from 'react';
import type { ConfigOverrides, TextField } from '@studio/recommendation';
import { ApiError, errorText, request } from './api';
import type { LegacyRules, RecommendedShelf, SelectionState } from '../server/recommendation';

type Order = ConfigOverrides['order'];
export interface DraftForm {
  include: string;
  exclude: string;
  preference: string;
  fields: TextField[];
  mode: 'any' | 'all';
  order: Order;
  author: number;
  work: number;
  boards: string;
  categories: string;
}

export interface LegacyForm {
  include: string;
  exclude: string;
  mode: 'any' | 'all';
  order: 'upstream' | 'random';
  raw?: string;
}

/** 推荐设置的完整草稿契约：读取、预览、条件保存与两套旧格式入口。 */
export interface SelectionDraft {
  state?: SelectionState;
  form: DraftForm;
  legacyForm: LegacyForm;
  preview?: RecommendedShelf;
  busy: boolean;
  message: string;
  rawMode: boolean;
  raw: string;
  patch(values: Partial<DraftForm>): void;
  patchLegacy(values: Partial<LegacyForm>): void;
  change(...keys: (keyof ConfigOverrides)[]): void;
  editRaw(value: string): void;
  toggleRaw(checked: boolean): void;
  cancel(): void;
  read(): Promise<void>;
  run(action: 'preview' | 'save' | 'switch' | 'legacy', entry?: 0 | 1): Promise<void>;
  stageLegacyDraft(): void;
}

const emptyForm = (): DraftForm => ({ include: '', exclude: '', preference: '', fields: ['title'], mode: 'any', order: 'upstream', author: 0, work: 0, boards: '', categories: '' });
const split = (text: string) => text.split(/\n/).map(t => t.trim()).filter(Boolean);
const modes = ['any', 'all'] as const;
const orders = ['upstream', 'score', 'random', 'time'] as const;
const legacyOrders = ['upstream', 'random'] as const;
const knownOrders: readonly Order[] = orders;
export const toMode = (value: string): 'any' | 'all' => modes.find(m => m === value) ?? 'any';
export const toOrder = (value: string): Order => orders.find(o => o === value) ?? 'upstream';
export const toLegacyOrder = (value: string): 'upstream' | 'random' => legacyOrders.find(o => o === value) ?? 'upstream';

function needsCompleteEditor(r: ConfigOverrides) {
  const groups = [...(r.include?.groups ?? []), ...(r.exclude ?? []), ...(r.preferences ?? [])], first = groups[0]?.fields;
  return (r.include?.groups.length ?? 0) > 1 || (r.exclude?.length ?? 0) > 1 || (r.preferences?.length ?? 0) > 1
    || groups.some(g => g.terms.some(t => t.trim() !== t || t.includes('\n')) || g.fields.some(f => !['title', 'author', 'tags', 'categories'].includes(f)) || JSON.stringify(g.fields) !== JSON.stringify(first))
    || !!r.include?.groups.some(g => g.mode !== r.include!.mode) || !!r.exclude?.some(g => g.mode !== 'any') || !!r.preferences?.some(g => g.mode !== 'any' || g.weight !== 10)
    || !!r.order && !knownOrders.includes(r.order);
}

export function useSelectionState(column: string, onChanged: (column: string) => void): SelectionDraft {
  const [state, setState] = useState<SelectionState>();
  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [legacyForm, setLegacyForm] = useState<LegacyForm>({ include: '', exclude: '', mode: 'any', order: 'upstream' });
  const [preview, setPreview] = useState<RecommendedShelf>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [absorb, setAbsorb] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState('{}');
  const active = useRef<AbortController | undefined>(undefined);
  const base = useRef<ConfigOverrides>({});
  const touched = useRef(new Set<keyof ConfigOverrides>());

  function parseJson<T>(text: string, label: string): T | undefined {
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) { setMessage(label + '需要一个 JSON 对象，当前内容不是。'); return undefined; }
      return value as T;
    } catch (error) {
      setMessage(label + '无法解析：' + (error instanceof Error ? error.message : '未知错误'));
      return undefined;
    }
  }

  function loadDraft(r: ConfigOverrides) {
    base.current = structuredClone(r);
    touched.current.clear();
    setRawMode(needsCompleteEditor(r));
    setRaw(JSON.stringify(r, null, 2));
    setForm({
      include: r.include?.groups.flatMap(g => g.terms).join('\n') ?? '',
      exclude: r.exclude?.flatMap(g => g.terms).join('\n') ?? '',
      preference: r.preferences?.flatMap(g => g.terms).join('\n') ?? '',
      fields: r.include?.groups[0]?.fields ?? r.exclude?.[0]?.fields ?? r.preferences?.[0]?.fields ?? ['title'],
      mode: r.include?.mode ?? 'any',
      order: r.order ?? 'upstream',
      author: r.diversity?.author ?? 0,
      work: r.diversity?.directory ?? 0,
      boards: r.scope?.boards.join('\n') ?? '',
      categories: r.scope?.categories.join('\n') ?? '',
    });
  }

  function fill(value: SelectionState) {
    setState(value);
    loadDraft(value.document.overrides);
    setLegacyForm({
      include: value.legacy.include.join('\n'),
      exclude: value.legacy.exclude.join('\n'),
      mode: value.legacy.mode,
      order: value.legacy.order,
      raw: [...value.legacy.include, ...value.legacy.exclude].some(t => t.trim() !== t || t.includes('\n')) ? JSON.stringify(value.legacy, null, 2) : undefined,
    });
  }

  async function read() {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setBusy(false);
    setState(undefined);
    try {
      const value = await request<SelectionState>('/api/recommendation/settings?column=' + column, undefined, c.signal);
      if (!c.signal.aborted) { fill(value); setPreview(undefined); setAbsorb(false); setMessage(''); }
    } catch (e) { if (!c.signal.aborted) setMessage(errorText(e)); }
  }

  useEffect(() => { void read(); return () => { active.current?.abort(); active.current = undefined; }; }, [column]);

  const overrides = (): ConfigOverrides => ({
    include: { mode: form.mode, groups: split(form.include).length ? [{ id: base.current.include?.groups[0]?.id ?? 'personal-include', fields: form.fields, mode: form.mode, terms: split(form.include) }] : [] },
    exclude: split(form.exclude).length ? [{ id: base.current.exclude?.[0]?.id ?? 'personal-exclude', fields: form.fields, mode: 'any', terms: split(form.exclude) }] : [],
    preferences: split(form.preference).length ? [{ id: base.current.preferences?.[0]?.id ?? 'personal-preference', fields: form.fields, mode: 'any', terms: split(form.preference), weight: 10 }] : [],
    order: form.order,
    diversity: { ...(base.current.diversity ?? state!.document.preset.config.diversity), author: form.author, directory: form.work },
    scope: { ...(base.current.scope ?? state!.document.preset.config.scope), boards: split(form.boards), categories: split(form.categories) },
  });

  function mergedOverrides(): ConfigOverrides {
    const proposed = overrides(), next = structuredClone(base.current);
    for (const key of touched.current) Object.assign(next, { [key]: proposed[key] });
    return next;
  }

  /** 草稿的唯一入口：完整 JSON 无法解析时给出可读原因并返回 undefined。 */
  function readDraft(): ConfigOverrides | undefined {
    return rawMode ? parseJson<ConfigOverrides>(raw, '完整个人覆盖 JSON') : mergedOverrides();
  }

  function readLegacyDraft(): LegacyRules | undefined {
    if (legacyForm.raw !== undefined) return parseJson<LegacyRules>(legacyForm.raw, '完整旧格式配置 JSON');
    return {
      include: legacyForm.include === state!.legacy.include.join('\n') ? state!.legacy.include : split(legacyForm.include),
      exclude: legacyForm.exclude === state!.legacy.exclude.join('\n') ? state!.legacy.exclude : split(legacyForm.exclude),
      mode: legacyForm.mode,
      order: legacyForm.order,
    };
  }

  const patch = (values: Partial<DraftForm>) => setForm(old => ({ ...old, ...values }));
  const patchLegacy = (values: Partial<LegacyForm>) => setLegacyForm(old => ({ ...old, ...values }));
  const change = (...keys: (keyof ConfigOverrides)[]) => { for (const key of keys) touched.current.add(key); setPreview(undefined); setAbsorb(false); };
  const editRaw = (value: string) => { setRaw(value); setPreview(undefined); setAbsorb(false); };
  const cancel = () => { active.current?.abort(); };

  function toggleRaw(checked: boolean) {
    const r = readDraft();
    if (!r) return;
    if (!checked && needsCompleteEditor(r)) { setMessage('此配置需要完整个人覆盖编辑器；规则保持原值。'); return; }
    loadDraft(r);
    setRawMode(checked);
    setPreview(undefined);
  }

  function stageLegacyDraft() {
    if (!state) return;
    loadDraft({
      include: { mode: state.legacy.mode, groups: state.legacy.include.length ? [{ id: 'legacy-include', fields: ['title'], mode: state.legacy.mode, terms: [...new Set(state.legacy.include)] }] : [] },
      exclude: state.legacy.exclude.length ? [{ id: 'legacy-exclude', fields: ['title'], mode: 'any', terms: [...new Set(state.legacy.exclude)] }] : [],
      order: state.legacy.order,
    });
    setAbsorb(true);
    setPreview(undefined);
  }

  async function run(action: 'preview' | 'save' | 'switch' | 'legacy', entry?: 0 | 1) {
    if (!state) return;
    const wantsDraft = action === 'preview' || action === 'save';
    const draft = wantsDraft ? readDraft() : undefined;
    if (wantsDraft && !draft) return;
    const legacy = action === 'legacy' ? readLegacyDraft() : undefined;
    if (action === 'legacy' && !legacy) return;
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setMessage('');
    try {
      if (action === 'preview') {
        const value = await request<RecommendedShelf>('/api/recommendation/preview', { column, overrides: draft, absorbLegacy: absorb }, c.signal);
        if (!c.signal.aborted) setPreview(value);
      } else {
        const patchBody = action === 'switch' ? { entry } : action === 'legacy' ? { legacy } : { overrides: draft, absorbLegacy: absorb };
        const value = await request<SelectionState>('/api/recommendation/settings', { column, expected: state, patch: patchBody }, c.signal);
        if (active.current === c && !c.signal.aborted) { fill(value); setPreview(undefined); setAbsorb(false); setMessage('已保存；下一次推荐生效。'); onChanged(column); }
      }
    } catch (e) {
      if (active.current !== c) return;
      if (!c.signal.aborted) setMessage(action === 'preview' && e instanceof ApiError && e.code === 'not-found'
        ? '这个栏目还没有可预览的音乐。请先回到发现页读取对应栏目；B站账号推荐需要先登录，匿名推荐在退出B站账号后使用。'
        : errorText(e));
      else {
        try {
          const value = await request<SelectionState>('/api/recommendation/settings?column=' + column);
          if (active.current !== c) return;
          setState(value);
          setMessage('保存回应已取消，已重读实际修订。草稿保留，请核对后预览。');
          setPreview(undefined);
          if (['entry', 'epoch', 'legacyRevision', 'sharedRevision'].some(k => value[k as keyof SelectionState] !== state[k as keyof SelectionState])) onChanged(column);
        } catch (error) { if (active.current === c) setMessage('保存回应已取消，重读修订失败：' + errorText(error)); }
      }
    } finally { if (active.current === c) setBusy(false); }
  }

  return { state, form, legacyForm, preview, busy, message, rawMode, raw, patch, patchLegacy, change, editRaw, toggleRaw, cancel, read, run, stageLegacyDraft };
}
