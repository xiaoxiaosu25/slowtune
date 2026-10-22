import { useState } from 'react';
import { ArrowRightIcon, CaretDownIcon, CheckCircleIcon, EyeIcon, HeartIcon, MinusCircleIcon, SlidersHorizontalIcon } from '@phosphor-icons/react';
import type { RecommendedShelf } from '../server/recommendation';
import { toLegacyOrder, toMode, toOrder, useSelectionState, type SelectionDraft } from './useSelectionState';

const labels: Record<string, string> = { 'music-recommendation': 'B站匿名推荐', 'account-recommendation': 'B站账号推荐', 'youtube-music-selection': 'YouTube 音乐精选' };
const matchFields = ['title', 'author', 'tags', 'categories'] as const;
type MatchField = typeof matchFields[number];
const fieldLabels: Record<MatchField, string> = { title: '标题', author: 'UP主／博主', tags: '标签', categories: '分类' };
const originLabels: Record<string, string> = { include: '包含条件', exclude: '排除条件', preferences: '关键词偏好', order: '排序', diversity: '重复限制', scope: '来源范围', repeat: '重复策略', budget: '读取预算', mix: '来源比例', batchSize: '批次数量' };

function LegacyRules({ draft }: { draft: SelectionDraft }) {
  const { legacyForm, busy } = draft;
  return <details className="recommendation-legacy" open={legacyForm.raw !== undefined || undefined}>
    <summary>编辑旧版规则</summary>
    <fieldset className="field-stack" disabled={busy}>
      {legacyForm.raw !== undefined
        ? <label className="field"><span className="field-label">完整旧格式配置 JSON</span><textarea className="textarea recommendation-code" aria-label="完整旧格式配置 JSON" value={legacyForm.raw} onChange={e => draft.patchLegacy({ raw: e.target.value })}/></label>
        : <>
          <label className="field"><span className="field-label">旧格式包含关键词</span><textarea className="textarea" aria-label="旧格式包含关键词" value={legacyForm.include} onChange={e => draft.patchLegacy({ include: e.target.value })}/></label>
          <label className="field"><span className="field-label">旧格式排除关键词</span><textarea className="textarea" aria-label="旧格式排除关键词" value={legacyForm.exclude} onChange={e => draft.patchLegacy({ exclude: e.target.value })}/></label>
          <label className="field field-inline"><span className="field-label">旧格式关键词关系</span><select className="select" aria-label="旧格式关键词关系" value={legacyForm.mode} onChange={e => draft.patchLegacy({ mode: toMode(e.target.value) })}><option value="any">任意满足</option><option value="all">全部满足</option></select></label>
          <label className="field field-inline"><span className="field-label">旧格式结果顺序</span><select className="select" aria-label="旧格式结果顺序" value={legacyForm.order} onChange={e => draft.patchLegacy({ order: toLegacyOrder(e.target.value) })}><option value="upstream">来源原顺序</option><option value="random">随机</option></select></label>
        </>}
      <div className="toolbar"><button className="btn btn-primary" onClick={() => void draft.run('legacy')}>保存旧格式配置</button></div>
    </fieldset>
  </details>;
}

function Preview({ preview }: { preview: RecommendedShelf }) {
  const items = preview.page?.items ?? [];
  const pool = preview.recommendation?.pool ?? 0;
  return <section aria-label="推荐预览" className="recommendation-preview">
    <div className="recommendation-preview-heading">
      <span className="recommendation-section-icon"><EyeIcon size={20}/></span>
      <div><h4>看看推荐会怎样变化</h4><p className="muted">来自已取得的候选，仅供预览。保存后应用到推荐栏目。</p></div>
      <span className="recommendation-preview-count" role="status"><strong>{items.length}</strong> / {pool} 首</span>
    </div>
    {items.length > 0
      ? <ol className="preview-list">{items.slice(0, 12).map((track, index) => <li key={track.resourceId}><span className="preview-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{track.title}</strong>{(track.uploader?.name || track.artists?.length) && <span>{track.uploader?.name ?? track.artists?.join(' / ')}</span>}</div></li>)}</ol>
      : <div className="recommendation-preview-empty"><SlidersHorizontalIcon size={24}/><strong>{pool ? '当前条件下没有匹配的音乐' : '当前没有可用的候选音乐'}</strong><p>{pool ? '试着减少包含条件，或检查排除关键词和匹配位置。' : '先回到发现页，读取对应栏目后再预览。'}</p></div>}
    {items.length > 12 && <p className="muted">这里展示前 12 首，共有 {items.length} 首符合当前规则。</p>}
    {preview.recommendation && <details className="recommendation-diagnostics"><summary>查看筛选详情</summary><pre>{JSON.stringify({ shortage: preview.recommendation.shortage, diagnostics: preview.recommendation.diagnostics, reasons: preview.recommendation.reasons }, null, 2)}</pre></details>}
  </section>;
}

export function RecommendationSettings({ onChanged, accountAuthenticated = false, youtubeEnabled=true }: { onChanged: (column: string) => void; accountAuthenticated?: boolean; youtubeEnabled?:boolean }) {
  const [selectedColumn, setSelectedColumn] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const column = selectedColumn&&!(selectedColumn==='youtube-music-selection'&&!youtubeEnabled)?selectedColumn:(accountAuthenticated ? 'account-recommendation' : 'music-recommendation');
  const draft = useSelectionState(column, onChanged);
  const { state, form, busy, rawMode, preview, message } = draft;
  const personalFields = state ? Object.entries(state.origins).filter(([, origin]) => origin === 'personal').map(([field]) => originLabels[field] ?? field) : [];
  const changePreference = (value: string) => {
    const enablePreferenceOrder = !form.preference.trim() && !!value.trim() && form.order === 'upstream';
    draft.patch({ preference: value, ...(enablePreferenceOrder ? { order: 'score' as const } : {}) });
    if (enablePreferenceOrder) draft.change('preferences', 'order');
    else draft.change('preferences');
  };
  return <section className="recommendation-settings" aria-labelledby="recommendation-heading" aria-busy={busy}>
    <header className="recommendation-heading">
      <span className="recommendation-heading-icon"><SlidersHorizontalIcon size={24}/></span>
      <div><h3 id="recommendation-heading">推荐偏好</h3><p className="muted">让平台推荐更合你的口味。关键词只筛选已取得的音乐。</p></div>
    </header>
    <div className="recommendation-column">
      <label className="field"><span className="field-label">这些偏好用在哪个栏目？</span><select className="select" aria-label="推荐栏目" value={column} onChange={e => setSelectedColumn(e.target.value)}>{Object.entries(labels).filter(([id])=>id!=='youtube-music-selection'||youtubeEnabled).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <p className="muted"><span>每个栏目单独设置</span><span>{window.slowTuneDesktop?'保存在本桌面应用的 data 中，与服务版各自保存':'同一服务的电脑和手机共用'}</span></p>
    </div>
    {!state && !message && <p className="loading" role="status">正在读取推荐偏好…</p>}
    {state && <>
      {state.entry === 0 && <div className="recommendation-mode-note"><div><strong>当前使用旧版规则</strong><p>下方新版偏好暂不生效。切换后可预览并保存。</p></div><button className="btn btn-secondary" disabled={busy} onClick={() => void draft.run('switch', 1)}>启用新版推荐</button></div>}
      {rawMode && <div className="recommendation-mode-note"><div><strong>当前使用完整配置</strong><p>这份配置包含复杂规则，请在下方展开的完整配置编辑器中修改。</p></div></div>}
      <fieldset className="field-stack recommendation-main" disabled={rawMode || busy}>
        <div className="recommendation-keywords">
          <label className="field recommendation-keyword-card">
            <span className="recommendation-card-title"><HeartIcon size={20}/><strong>想多听什么</strong><span>偏好</span></span>
            <span className="recommendation-field-help" id="preference-help">匹配任意关键词的音乐优先，其他音乐仍会保留。</span>
            <textarea className="textarea" aria-label="偏好关键词" aria-describedby="preference-help" rows={3} placeholder={'例如：陈奕迅\n现场'} value={form.preference} onChange={e => changePreference(e.target.value)}/>
            <span className="recommendation-input-note">每行一个关键词 · 可在下方调整排序</span>
          </label>
          <label className="field recommendation-keyword-card">
            <span className="recommendation-card-title"><MinusCircleIcon size={20}/><strong>想少听什么</strong><span>排除</span></span>
            <span className="recommendation-field-help" id="exclude-help">匹配任意关键词的音乐会被过滤。</span>
            <textarea className="textarea" aria-label="排除关键词" aria-describedby="exclude-help" rows={3} placeholder={'例如：伴奏\n教学'} value={form.exclude} onChange={e => { draft.patch({ exclude: e.target.value }); draft.change('exclude'); }}/>
            <span className="recommendation-input-note">每行一个关键词 · 留空则不排除</span>
          </label>
        </div>
        <div className="recommendation-order-row">
          <label className="field"><span className="field-label">推荐怎么排列</span><select className="select" aria-label="推荐顺序" value={form.order} onChange={e => { draft.patch({ order: toOrder(e.target.value) }); draft.change('order'); }}><option value="upstream">按平台推荐顺序</option><option value="score">关键词偏好优先</option><option value="random">随机排列</option><option value="time">最新发布优先</option></select></label>
          <p className="muted">{form.order === 'score' ? '偏好匹配的音乐靠前，同分时保留来源顺序。' : form.order === 'time' ? '按真实发布时间排列，缺少时间的音乐放在后面。' : form.order === 'random' ? '将当前候选打乱，保存后用于下一批推荐。' : '保留平台给出的顺序，优先展示最近未出现的音乐。'}</p>
        </div>
        {form.preference.trim() && form.order !== 'score' && <div className="recommendation-order-hint"><p>已填写偏好关键词，选择“关键词偏好优先”后才会按偏好排列。</p><button className="btn btn-secondary btn-sm" onClick={() => { draft.patch({ order: 'score' }); draft.change('order'); }}>启用偏好排序<ArrowRightIcon size={16}/></button></div>}
        <fieldset className="field-stack match-fields"><legend>关键词匹配位置</legend><div className="choice-row">{matchFields.map(field => <label className="choice" key={field}><input type="checkbox" checked={form.fields.includes(field)} onChange={e => { draft.patch({ fields: e.target.checked ? [...form.fields, field] : form.fields.filter(x => x !== field) }); draft.change('include', 'exclude', 'preferences'); }}/>{fieldLabels[field]}</label>)}</div><p className="recommendation-field-help">按平台提供的文字匹配，不分析音频。标签或分类可能缺失，建议优先使用标题。</p></fieldset>
      </fieldset>
      <details className="recommendation-advanced" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}>
        <summary><SlidersHorizontalIcon size={18}/><span><strong>高级筛选</strong><small>{[!!form.include.trim(), form.author > 0, form.work > 0, !!form.boards.trim(), !!form.categories.trim()].filter(Boolean).length ? '已设置筛选条件，展开查看' : '包含条件、重复限制与来源范围'}</small></span><CaretDownIcon size={16} className="recommendation-chevron"/></summary>
        <fieldset className="field-stack recommendation-advanced-body" disabled={rawMode || busy}>
          <div className="recommendation-strict-filter">
            <label className="field"><span className="field-label">只保留符合条件的音乐</span><textarea className="textarea" aria-label="包含关键词" aria-describedby="include-help" rows={3} placeholder={'例如：粤语\n现场'} value={form.include} onChange={e => { draft.patch({ include: e.target.value }); draft.change('include'); }}/><span id="include-help" className="recommendation-field-help">每行一个关键词，留空则不限制。条件越多，可用音乐可能越少。</span></label>
            <label className="field"><span className="field-label">包含条件之间的关系</span><select className="select" aria-label="关键词关系" value={form.mode} onChange={e => { draft.patch({ mode: toMode(e.target.value) }); draft.change('include'); }}><option value="any">符合任意一个即可</option><option value="all">必须全部符合</option></select><span className="recommendation-field-help">排除关键词始终是匹配任意一个就过滤。</span></label>
          </div>
          <div className="recommendation-advanced-group"><h4>减少重复出现</h4><p className="recommendation-field-help">限制同一批中的重复项，填 0 表示不限制。作者指视频上传者。</p><div className="field-grid">
            <label className="field"><span className="field-label">同一 UP主／博主上限</span><input className="input" aria-label="作者上限" type="number" min="0" max="100" value={form.author} onChange={e => { draft.patch({ author: Number(e.target.value) }); draft.change('diversity'); }}/></label>
            <label className="field"><span className="field-label">同一视频上限</span><input className="input" aria-label="作品上限" type="number" min="0" max="100" value={form.work} onChange={e => { draft.patch({ work: Number(e.target.value) }); draft.change('diversity'); }}/></label>
          </div></div>
          <div className="recommendation-advanced-group"><h4>限定来源范围</h4><p className="recommendation-field-help">仅在明确知道平台分区或分类时填写，每行一个。所需资料缺失的音乐不会通过筛选；YouTube 地区仍在发现页选择。</p><div className="field-grid">
            <label className="field"><span className="field-label">平台分区编号</span><textarea className="textarea" aria-label="真实分区编号" rows={2} placeholder="留空则不限分区" value={form.boards} onChange={e => { draft.patch({ boards: e.target.value }); draft.change('scope'); }}/></label>
            <label className="field"><span className="field-label">平台分类名称</span><textarea className="textarea" aria-label="真实分类" rows={2} placeholder="留空则不限分类" value={form.categories} onChange={e => { draft.patch({ categories: e.target.value }); draft.change('scope'); }}/></label>
          </div></div>
        </fieldset>
      </details>
      <details className="recommendation-compatibility" open={compatibilityOpen || rawMode || state.entry === 0} onToggle={e => setCompatibilityOpen(e.currentTarget.open)}>
        <summary><span>完整配置与旧版兼容</span><CaretDownIcon size={16} className="recommendation-chevron"/></summary>
        <div className="field-stack recommendation-compatibility-body">
          <p className="muted">未修改的字段继续使用默认配置。旧版规则单独保存，载入后需要重新预览并保存。</p>
          <label className="choice"><input type="checkbox" disabled={busy} checked={rawMode} onChange={e => draft.toggleRaw(e.target.checked)}/>编辑完整个人覆盖</label>
          {rawMode && <label className="field"><span className="field-label">完整个人覆盖 JSON</span><textarea className="textarea recommendation-code" aria-label="完整个人覆盖 JSON" disabled={busy} value={draft.raw} onChange={e => draft.editRaw(e.target.value)}/></label>}
          <div className="toolbar">
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void draft.run('switch', state.entry === 1 ? 0 : 1)}>{state.entry === 1 ? '切换到旧版入口' : '切换回新版规则'}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={draft.stageLegacyDraft}>载入旧配置为新版草稿</button>
          </div>
          {state.entry === 0 && <LegacyRules draft={draft}/>}
          <p className="recommendation-revisions">当前：{state.entry === 1 ? '新版推荐' : '旧版规则'} · 预设 {state.document.preset.revision} · 个人修订 {state.sharedRevision} · 旧修订 {state.legacyRevision}</p>
          <p className="recommendation-revisions">个人设置：{personalFields.join('、') || '使用默认配置'}</p>
        </div>
      </details>
      <div className="recommendation-actions">
        <div className="recommendation-save-status">{preview ? <CheckCircleIcon size={20}/> : <EyeIcon size={20}/>}<p>{preview ? '已预览，可以保存' : '先预览，再保存'}<span>{preview ? '继续修改后，需要重新预览。' : '预览不会修改当前推荐设置。'}</span></p></div>
        <div className="toolbar">
          <button className="btn btn-ghost" disabled={busy} onClick={() => void draft.read()}>撤销修改</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => void draft.run('preview')}><EyeIcon size={18}/>预览效果</button>
          <button className="btn btn-primary" disabled={busy || !preview} onClick={() => void draft.run('save')}>保存偏好</button>
        </div>
      </div>
      {busy && <div className="recommendation-operation" role="status"><span>正在处理推荐设置…</span><button className="btn btn-ghost btn-sm" onClick={draft.cancel}>取消推荐操作</button></div>}
      {preview && <Preview preview={preview}/>}
    </>}
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
