import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Modal } from './Modal';

type Props = { children: ReactNode; enabled?: boolean; resetKey?: string; label: string; onRetry?: () => void; onClose?: () => void; dialog?: boolean; className?: string };

/** Keep a failed desktop region below the workspace that owns the live player. */
export class DesktopRegion extends Component<Props, { failed: boolean; resetKey?: string }> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: { resetKey?: string }) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.enabled === false) throw new Error('Page rendering failed');
    const { label, onClose, dialog } = this.props;
    const content = <div className="feedback" role="alert">
      <p>{label}暂时无法显示。可以重试或关闭后重新打开。</p>
      <p className="muted">已保存资料保留；此区域未保存的输入可能需要重新填写。</p>
      <button className="btn btn-secondary" onClick={() => { this.props.onRetry?.(); this.setState({ failed: false }); }}>重试显示</button>
      {onClose && <button className="btn btn-ghost" onClick={onClose}>关闭此区域</button>}
    </div>;
    return dialog && onClose ? <Modal title={label + '暂不可用'} onClose={onClose}>{content}</Modal> : this.props.className ? <aside className={this.props.className}>{content}</aside> : content;
  }
}

type FeatureModule = Record<string, unknown>;
const modules = new Map<string, FeatureModule>();
const loading = new Map<string, Promise<FeatureModule>>();
let sequence = 0;

function loadFeatureModule(url: string): Promise<FeatureModule> {
  const ready = modules.get(url);
  if (ready) return Promise.resolve(ready);
  const active = loading.get(url);
  if (active) return active;
  const target = new URL(url, window.location.href), request = sequence++;
  if (request) target.searchParams.set('retry', String(request));
  const pending = import(/* @vite-ignore */ target.href).then(module => {
    modules.set(url, module);
    return module;
  }).finally(() => loading.delete(url));
  loading.set(url, pending);
  return pending;
}

/** Managers share one emitted chunk, including their deferred shared dependencies. */
export function desktopFeature<P extends { onClose: () => void }>(url: string, name: string, label: string, dialog = true) {
  let ready: ComponentType<P> | undefined;
  const load = async () => {
    if (ready) return { default: ready };
    const module = await loadFeatureModule(url);
    ready = module[name] as ComponentType<P>;
    return { default: ready };
  };
  return function DesktopFeature(props: P) {
    const [attempt, setAttempt] = useState(0);
    const Feature = useMemo(() => ready ?? lazy(load), [attempt]);
    const loading = <p className="loading" role="status">正在打开{label}…</p>;
    return <DesktopRegion key={attempt} label={label} dialog={dialog} className={dialog ? undefined : 'playback-management'} onClose={props.onClose} onRetry={() => setAttempt(value => value + 1)}>
      <Suspense fallback={dialog ? <Modal title={'正在打开' + label} onClose={props.onClose}>{loading}</Modal> : <aside className="playback-management">{loading}<button className="btn btn-ghost" onClick={props.onClose}>取消打开</button></aside>}><Feature {...props}/></Suspense>
    </DesktopRegion>;
  };
}
