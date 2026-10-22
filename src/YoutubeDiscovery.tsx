import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Shelf } from '@studio/music-sources';
import { DiscoveryShelf } from './DiscoveryShelf';
import { request, errorText, cancelled, type Track } from './api';
import { chineseMusicRegions, isYoutubeRegion, youtubeMusicUrl, youtubeRegions, type YoutubeMusicResult, type YoutubeRegion } from '../server/youtube-regions';
import { readYoutubeRegion, writeYoutubeRegion, youtubeMusicPath } from './youtube-candidates';
import type { RecommendedShelf } from '../server/recommendation';
import { discoverySize } from './CatalogView';

interface Props {
  displayActive?:boolean;
  available: boolean;
  refreshToken: number;
  renderCovers: (items: Track[]) => ReactNode;
  renderList: (items: Track[]) => ReactNode;
  onPlayAll: (items: Track[]) => void;
  onImport?:(items:Track[],title?:string)=>void;
}

export function YoutubeDiscovery({ available, refreshToken, renderCovers, renderList, onPlayAll, onImport, displayActive=true }: Props) {
  const [region, setRegion] = useState(readYoutubeRegion);
  const [data, setData] = useState<YoutubeMusicResult>();
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<unknown>();
  const [message, setMessage] = useState(''), [saveFailed, setSaveFailed] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const previous = useRef<{ region: YoutubeRegion; ids: Set<string> } | undefined>(undefined);
  const previousRefresh = useRef(refreshToken);
  const current = data?.region === region ? data : undefined;

  async function load(refresh = false) {
    active.current?.abort();
    if (!available) { setBusy(false); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setFailure(undefined);
    try {
      const result = await request<YoutubeMusicResult>(youtubeMusicPath(region, { refresh }), undefined, controller.signal);
      if (!controller.signal.aborted) {
        const items = result.shelf.page?.items ?? [], old = previous.current;
        const newCount = old?.region === region ? items.filter(item => !old.ids.has(item.ref.id)).length : items.length;
        setMessage(!items.length ? '本次没有找到音乐，可换一批或选择其他地区。' : refresh&&old?.region === region ? newCount ? `本次找到 ${newCount} 首新音乐` : '本次返回相同的音乐，可再换一批。' : `当前批次 ${Math.min(discoverySize,items.length)} 首音乐`);
        previous.current = { region, ids: new Set(items.map(item => item.ref.id)) };
        setData(result);
      }
    } catch (error) { if (!controller.signal.aborted && !cancelled(error)) setFailure(error); }
    finally { if (active.current === controller) setBusy(false); }
  }

  useEffect(() => {
    try { writeYoutubeRegion(region); setSaveFailed(false); } catch { setSaveFailed(true); }
  }, [region]);
  useEffect(() => {
    void load(previousRefresh.current !== refreshToken);
    previousRefresh.current = refreshToken;
    return () => { active.current?.abort(); };
  }, [region, available, refreshToken]);
  const recommendation=(current?.shelf as RecommendedShelf|undefined)?.recommendation;
  useEffect(()=>{if(!recommendation?.updating||busy)return;const timer=setTimeout(()=>void load(),3000);return()=>clearTimeout(timer);},[current,recommendation?.updating,busy]);

  const shelf: Shelf = current?.shelf ?? { id: 'youtube-music-selection', title: 'YouTube 音乐精选', kind: 'recommendation' };
  const retry = <button className="btn btn-secondary btn-sm" onClick={() => void load(true)}>重试音乐精选</button>;
  return <DiscoveryShelf shelf={shelf} displayActive={displayActive} loading={busy} renderCovers={renderCovers} renderList={renderList}
    renderError={error => <p role="alert">{errorText(error)} {retry}</p>}
    onRefresh={available ? () => void load(true) : undefined}
    onPlayAll={onPlayAll}
    onImport={onImport}
    info={<>
      <p>{chineseMusicRegions.has(region) ? '从音乐区公开歌单中精选歌曲，优先华语和粤语。' : '从当前地区的音乐区公开歌单中精选歌曲。'}</p>
      <p><a href={current?.sourceUrl ?? `${youtubeMusicUrl}?gl=${region}&hl=zh-CN`} target="_blank" rel="noreferrer">查看 YouTube 音乐区</a></p>
      {!!current?.playlists.length && <p>本批歌单：{current.playlists.map((playlist, index) => <span key={playlist.id}>{index > 0 && ' · '}<a href={playlist.url} target="_blank" rel="noreferrer">{playlist.title}</a></span>)}</p>}
    </>}
    status={<>
      {current && <span>{message} · 获取于 {new Date(current.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
      {busy && <span>正在获取 YouTube 音乐精选… <button className="btn btn-ghost btn-sm" onClick={() => { active.current?.abort(); setBusy(false); }}>取消</button></span>}
      {!available && <span className="error-text" role="alert">YouTube 视频来源暂不可用，请在设置中检查取源工具。</span>}
      {available && !!failure && <span className="error-text" role="alert">{errorText(failure)} {retry}</span>}
      {recommendation?.updating&&<span>启动时正在准备新推荐，先展示上次内容。</span>}
      {recommendation?.issue&&<span className="error-text" role="alert">{errorText({code:recommendation.issue})} {recommendation.retained?'已保留上次内容。':'已展示可用歌曲。'}{retry}</span>}
      {!!current?.warnings.length && <span>部分歌单暂时无法读取，已展示可用歌曲。可换一批或选择其他地区。</span>}
      {saveFailed && <span>当前浏览器无法保存地区选择。</span>}
    </>}
    controls={<div className="toolbar youtube-discovery-controls">
      <label className="field field-inline"><span className="field-label">音乐区地区</span><select className="select select-sm" aria-label="YouTube 音乐区地区" value={region} onChange={event => { if (isYoutubeRegion(event.target.value)) setRegion(event.target.value); }}>
        {youtubeRegions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>}/>;
}
