import { useEffect, useRef, useState } from 'react';
import { MoonIcon, TimerIcon, CheckIcon, MusicNotesIcon } from '@phosphor-icons/react';
import type { SleepTimerController, SleepTimerRule, SleepTimerSnapshot, SleepTimerTrigger } from '@studio/player/sleep-timer';
import { time } from './api';

const presets = [15, 30, 45, 60, 90];
const actionLabels = { pause: '暂停播放', stop: '停止播放', close: '关闭播放器' };
const actionHints = { pause: '保留当前位置，可以随时继续听。', stop: '释放播放资源，保留队列和页面。', close: '停止播放并关闭播放器。' };

export function SleepPanel({ timer }: { timer: SleepTimerController | null }) {
  const [snapshot, setSnapshot] = useState<SleepTimerSnapshot | null>(timer?.snapshot ?? null);
  const [trigger, setTrigger] = useState<SleepTimerTrigger['type']>('duration');
  const [duration, setDuration] = useState('30'), [unit, setUnit] = useState('60000'), [count, setCount] = useState('3');
  const unitRef = useRef(unit); unitRef.current = unit;
  const [action, setAction] = useState<SleepTimerSnapshot['action']>('pause'), [error, setError] = useState('');
  useEffect(() => {
    if (!timer) { setSnapshot(null); return; }
    let ruleKey = '';
    const update = () => {
      const next = timer.snapshot, nextKey = JSON.stringify([next.status === 'running', next.trigger, next.action]);
      setSnapshot(next);
      // Timer ticks update the countdown without overwriting an unfinished form.
      if (nextKey !== ruleKey && next.status === 'running' && next.trigger) {
        setTrigger(next.trigger.type); setAction(next.action);
        if (next.trigger.type === 'duration') setDuration(String(next.trigger.durationMs / Number(unitRef.current)));
        if (next.trigger.type === 'items') setCount(String(next.trigger.count));
      }
      ruleKey = nextKey;
    };
    update(); timer.addEventListener('change', update); timer.addEventListener('destroy', update);
    return () => { timer.removeEventListener('change', update); timer.removeEventListener('destroy', update); };
  }, [timer]);
  const unavailable = !timer || timer.isDestroyed, running = snapshot?.status === 'running';
  const start = (rule: SleepTimerRule) => {
    if (unavailable) return;
    try { timer.start(rule); setError(''); }
    catch (failure) { setError(failure instanceof Error && failure.message.startsWith('Load an item') ? '请先播放一首音乐，再设置播完当前曲。' : '设置未生效，请检查时长、次数和结束动作。'); }
  };
  const presetActive = (minutes: number) => running && snapshot.action === 'pause' && snapshot.trigger?.type === 'duration' && snapshot.trigger.durationMs === minutes * 60000;
  const timerError = snapshot?.error ? '定时结束操作未完成，请重新设置或取消。' : '';
  return <div className="sleep-panel">
    <div className={'sleep-summary ' + (running ? 'is-running' : '')}>
      <span className="sleep-summary-icon"><MoonIcon size={25} weight={running ? 'fill' : 'regular'} /></span>
      <div><p className="sleep-summary-label">{running ? '定时已开启' : '让音乐陪你入睡'}</p>
        <strong>{running ? snapshot.trigger?.type === 'duration' ? time(Math.ceil(snapshot.remainingMs / 1000)) : `再播完 ${snapshot.remainingItems ?? 1} 首` : '选一个时间，安心休息'}</strong>
        <p className="muted">{running ? `结束后${actionLabels[snapshot.action]}` : snapshot?.actionPending ? '正在完成定时结束操作…' : snapshot?.status === 'expired' ? '上次定时已完成，可以设置新的定时。' : '到时自动暂停，留住你听到的位置。'}</p>
      </div>
    </div>
    <section className="sleep-quick" aria-label="快捷倒计时">
      <div className="sleep-section-heading"><TimerIcon size={17} /><span>快捷设置</span><small>到时暂停</small></div>
      <div className="sleep-presets">{presets.map(minutes => <button key={minutes} type="button" className={'sleep-preset ' + (presetActive(minutes) ? 'selected' : '')} disabled={unavailable} aria-pressed={!!presetActive(minutes)} onClick={() => start({ trigger: { type: 'duration', durationMs: minutes * 60000 } })}><strong>{minutes}</strong><span>分钟</span>{presetActive(minutes) && <CheckIcon size={12} />}</button>)}</div>
      <button type="button" className="btn sleep-current" disabled={unavailable} aria-pressed={!!(running && snapshot.trigger?.type === 'current' && snapshot.action === 'pause')} onClick={() => start({ trigger: { type: 'current' } })}><MusicNotesIcon size={18} /><span>播完当前曲</span><span className="muted">自然结束后暂停</span></button>
    </section>
    <form className="sleep-form" aria-label="睡眠设置" onSubmit={event => {
      event.preventDefault();
      start({ trigger: trigger === 'duration' ? { type: trigger, durationMs: Number(duration) * Number(unit) } : trigger === 'items' ? { type: trigger, count: Number(count) } : { type: trigger }, action });
    }}>
      <fieldset className="field-stack" disabled={unavailable}>
        <legend>自定义定时</legend>
        <div className="sleep-fields">
          <label className="field"><span className="field-label">结束条件</span><select className="select" data-field="trigger" value={trigger} onChange={event => { setTrigger(event.target.value as SleepTimerTrigger['type']); setError(''); }}><option value="duration">倒计时</option><option value="items">自然播完 N 首</option><option value="current">播完当前曲</option></select></label>
          {trigger === 'duration' && <div className="sleep-duration"><label className="field"><span className="field-label">时长</span><input className="input" data-field="duration" type="number" min="0.001" step="any" required inputMode="decimal" value={duration} onChange={event => setDuration(event.target.value)} /></label><label className="field"><span className="field-label">单位</span><select className="select" data-field="unit" value={unit} onChange={event => setUnit(event.target.value)}><option value="60000">分钟</option><option value="1000">秒</option></select></label></div>}
          {trigger === 'items' && <label className="field"><span className="field-label">歌曲数量</span><input className="input" data-field="count" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required inputMode="numeric" value={count} onChange={event => setCount(event.target.value)} /></label>}
          <label className="field sleep-action"><span className="field-label">结束动作</span><select className="select" data-field="action" value={action} onChange={event => setAction(event.target.value as SleepTimerSnapshot['action'])}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <p className="muted sleep-hint">{trigger === 'duration' ? '暂停播放时，倒计时也会继续。' : trigger === 'items' ? '仅自然播完才计数，手动切歌或快进到末尾不计数。' : '等待当前曲自然播完；切歌后会等待新的当前曲。'} {actionHints[action]}</p>
        <div className="sleep-actions"><button type="submit" className="btn btn-primary" data-action="start-timer"><TimerIcon size={18} />{running ? '重新设置' : '开启定时'}</button><button type="button" className="btn btn-secondary" data-action="cancel-timer" disabled={!running && !snapshot?.actionPending} onClick={() => { timer?.cancel(); setError(''); }}>取消定时</button></div>
      </fieldset>
    </form>
    {(error || timerError) && <p className="error-text" role="alert">{error || timerError}</p>}
    {unavailable && <p className="muted">播放器尚未就绪，稍后再试。</p>}
  </div>;
}
