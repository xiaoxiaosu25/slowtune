import { useEffect, useState } from 'react';
import type { ServerStatus } from './api';

interface Notice {
  name: string; version: string; license: string | null;
  purpose: string; source?: string; texts: { name: string; text: string }[];
}
interface Notices { schema: number; appVersion: string; entries: Notice[] }

const references = [
  { name: 'Azusa Player Mobile', url: 'https://github.com/lovegaoshi/azusa-player-mobile', purpose: 'B站发现、搜索、栏目组织与多来源播放的功能和架构参考。' },
  { name: 'NoxPlayer', url: 'https://github.com/lovegaoshi/NoxPlayer', purpose: '浏览器环境中的搜索接入与跨端功能组织参考。' },
  { name: 'BBPlayer', url: 'https://github.com/bbplayer-app/BBPlayer', purpose: 'B站播放信息请求、WBI 签名调用与解析和播放分工的技术参考。' },
  { name: 'bili-music', url: 'https://github.com/YOUYUDAWANG/bili-music/blob/main/ARCHITECTURE.md', purpose: '账号推荐、音乐内容筛选与收藏夹功能的架构资料参考。' },
  { name: 'biu', url: 'https://github.com/wood3n/biu', purpose: '音轨格式、音质选择及媒体地址有效期处理的思路参考。' },
  { name: 'B站用户助手', url: 'https://greasyfork.org/en/scripts/554606-b%E7%AB%99%E7%94%A8%E6%88%B7%E5%8A%A9%E6%89%8B-%E5%90%88%E9%9B%86%E6%8C%89%E6%97%B6%E9%97%B4%E6%8E%92%E5%BA%8F%E5%B9%B6%E6%92%AD%E6%94%BE/code', purpose: '收藏夹创建接口的调用格式参考。' },
];

export function AboutPanel({ active, status }: { active: boolean; status?: ServerStatus }) {
  const desktop = !!window.slowTuneDesktop;
  const [notices, setNotices] = useState<Notices>();
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || notices) return;
    const controller = new AbortController();
    setError(false);
    void fetch('/legal/notices.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('notices');
      const value = await response.json() as Notices;
      if (value.schema !== 1 || !Array.isArray(value.entries)) throw new Error('notices');
      if (!controller.signal.aborted) setNotices(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [active, notices, retry]);
  const openSource = notices?.entries;
  return <div className="about-settings settings-stack">
    <header className="settings-section-heading">
      <div><h3 tabIndex={-1} data-about-heading>关于与声明</h3><p className="muted">慢听 SlowTune · {desktop ? 'Windows 桌面个人音乐应用' : '个人音乐网页工具'}</p></div>
      {(status?.version || notices?.appVersion) && <span className="settings-version">应用 {status?.version ?? notices?.appVersion}</span>}
    </header>
    <p className="muted">本应用为独立第三方工具，与哔哩哔哩、YouTube 及相关权利人无官方隶属或背书关系。</p>

    <section className="settings-group" aria-labelledby="source-disclosure-heading">
      <h4 id="source-disclosure-heading">接口与内容来源</h4>
      <div className="source-disclosure">
        <h5>B站</h5>
        <p>搜索、推荐、榜单、视频信息及播放信息来自哔哩哔哩网页服务使用的接口，扫码登录由B站登录服务完成，播放内容来自B站及其内容分发服务。</p>
        <p className="muted">接口调用方式和相关功能设计参考了社区项目的公开实现与技术资料，并结合网页接口实际响应进行适配。具体参考范围见下方“参考与致谢”。这属于非官方网页接口接入，并非B站开放平台向本应用提供的授权 API。</p>
        <a className="settings-text-link" href="https://www.bilibili.com/blackboard/protocal/licence.html" target="_blank" rel="noreferrer">B站用户协议（外部网站）</a>
      </div>
      <div className="source-disclosure">
        <h5>YouTube</h5>
        <p>通过 YouTube.js（youtubei.js）访问 YouTube 内部接口，读取目录、搜索、歌单、作者内容与评论；播放资源由{desktop ? '本机配置的' : '服务电脑上的'} yt-dlp 解析。</p>
        <p className="muted">这些工具由第三方维护，并非 YouTube 官方 SDK。本应用当前未提供 YouTube 账号登录；关闭来源会停止相关功能，已有歌曲资料保留。</p>
        <div className="settings-link-row"><a className="settings-text-link" href="https://github.com/LuanRT/YouTube.js" target="_blank" rel="noreferrer">YouTube.js 项目</a><a className="settings-text-link" href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">yt-dlp 项目</a><a className="settings-text-link" href="https://www.youtube.com/static?template=terms" target="_blank" rel="noreferrer">YouTube 服务条款（外部网站）</a></div>
      </div>
      <p className="muted">以上为接入方式说明，实际开启状态请查看“音乐来源”。接口、内容权限、地区、网络和平台策略变化都可能使功能暂时不可用。</p>
    </section>

    <section className="settings-group" aria-labelledby="references-heading">
      <h4 id="references-heading">参考与致谢</h4>
      <p className="muted">感谢以下项目公开的技术资料与设计思路，为B站接口接入、音乐发现及播放体验提供参考。</p>
      <ul className="reference-projects">{references.map(reference => <li key={reference.url}><a className="settings-text-link" href={reference.url} target="_blank" rel="noreferrer">{reference.name}</a><p>{reference.purpose}</p></li>)}</ul>
      <p className="muted">此处说明接口与功能设计的参考来源。实际使用的第三方软件及其许可证列在“开源软件与第三方材料”中。</p>
    </section>

    <section className="settings-group" aria-labelledby="usage-disclosure-heading">
      <h4 id="usage-disclosure-heading">免责声明</h4>
      <ol className="disclaimer-list">
        <li><strong>非官方项目。</strong>慢听为独立的第三方音乐工具，与哔哩哔哩、YouTube 及相关权利人无官方隶属、合作或背书关系。</li>
        <li><strong>内容版权。</strong>音视频、封面、评论和商标等内容的相关权利归相应权利人。本应用提供检索、资料管理与在线播放能力，不随应用分发第三方音视频文件，也不授予平台内容的使用、下载或传播许可。</li>
        <li><strong>使用范围。</strong>请在平台允许的访问与账号权限范围内使用，并遵守适用法律及平台服务条款。请勿用于侵权传播、未经许可的商业利用、恶意批量抓取或其他违法违规行为。</li>
        <li><strong>服务与账号风险。</strong>第三方接口可能变更、限流或停止服务，账号可能过期或受到平台限制；应用无法保证所有内容的可访问性、音质或持续可用性。重要资料请定期备份。</li>
        <li><strong>操作影响。</strong>请先核对登录、同步与导入的作用范围。开启B站收藏夹关联后，新增与删除会双向同步；全部替换资料会影响{desktop ? '本桌面应用的资料' : '连接同一服务的设备'}，并可能通过同步影响已关联的B站收藏夹。</li>
      </ol>
      <p className="muted">第三方软件的开源许可仅适用于对应软件，不代表平台内容授权。本声明不影响适用法律规定的权利和责任。</p>
      <p className="muted">{desktop ? '当前为 Windows 桌面测试版；真实来源长期播放、系统媒体键和休眠唤醒仍需实机验收。' : '当前提供网页产品；实体手机、锁屏后台播放与长期稳定性仍需进一步验证。'}</p>
    </section>

    <section className="settings-group" aria-labelledby="privacy-disclosure-heading">
      <h4 id="privacy-disclosure-heading">账号与数据保存</h4>
      <dl className="settings-data-scopes">
        <dt>{desktop ? '本地资料' : '服务电脑'}</dt><dd>{desktop ? '歌单、收藏、关注、推荐偏好与来源设置保存在本桌面应用的 data 文件夹，与服务版各自保存，不自动同步。' : '保存歌单、收藏、关注、推荐偏好与来源设置。连接同一个服务的电脑和手机共享这些资料及B站账号。'}</dd>
        <dt>B站凭据</dt><dd>{desktop ? '登录凭据由当前 Windows 用户加密后保存在本桌面应用的 data 中；歌单 JSON 备份不包含凭据。换电脑或 Windows 用户后可能需要重新登录。退出B站账号可删除本应用保存的凭据。' : '当前 Windows 实现使用服务电脑上的 Windows 用户加密保存登录凭据，不保存在手机中，也不包含在歌单备份里。退出B站账号可删除此服务保存的凭据。'}</dd>
        <dt>{desktop ? '播放与界面偏好' : '当前浏览器'}</dt><dd>{desktop ? '播放队列、模式、音量及界面偏好保存在本应用的 data 中。播放进度不持久化；重新打开后需手动从头播放。' : '保存播放队列、播放模式、音量及部分界面偏好。播放进度不持久化；恢复浏览器队列后需手动从头播放。'}</dd>
        <dt>备份范围</dt><dd>当前 JSON 备份包含歌单、收藏及曲目资料和来源标识，不包含音视频文件、登录凭据、关注名单、推荐偏好、来源设置或收藏夹同步关联。</dd>
      </dl>
      {desktop && <p className="muted">完整备份请先退出慢听，再复制整个 data 文件夹，包含资料库、设置、偏好和加密账号资料；歌单 JSON 只覆盖上列歌单资料，不是完整备份。</p>}
      <p className="muted">{desktop ? '搜索与播放会向相应平台或内容分发服务发起请求。本应用的内部连接仅供本机使用。' : '搜索与播放会向相应平台或内容分发服务发起请求。局域网 HTTP 连接不具备 HTTPS 的传输保护，请只在可信设备和网络中使用。'}</p>
      <p className="muted">{desktop ? '关闭主窗口或选择“退出慢听”会停止播放，等待必要保存并关闭本应用的内部服务；最小化可继续播放。退出应用保留B站登录，要删除凭据请到“B站账号”退出。' : '退出当前浏览器登录只结束该浏览器的服务访问会话，服务端B站登录仍保留。要移除该登录，请到“B站账号”退出。'}</p>
    </section>

    <section className="settings-group" aria-labelledby="licenses-heading">
      <h4 id="licenses-heading">开源软件与第三方材料</h4>
      {desktop && <p className="muted">慢听及随附自有公共包的原创代码按 AGPL-3.0-only 提供，不作担保；允许按许可证修改与再分发。<a className="settings-text-link" href="/legal/PROJECT-LICENSE.txt" download="slowtune-LICENSE.txt">项目许可证</a> · <a className="settings-text-link" href="/legal/PROJECT-NOTICE.txt" download="slowtune-NOTICE.txt">版权与范围</a> · <a className="settings-text-link" href="/legal/desktop-lyrics-source.tar.gz" download="slowtune-source.tar.gz">本构建对应源码</a>。第三方材料保留各自许可。</p>}
      <p className="muted">感谢第三方项目的贡献。下方清单按当前安装的运行依赖和随应用提供的字体生成，保留原版权与许可文本，可离线阅读；外部项目链接需要网络。</p>
      {!notices && !error && <p role="status">正在读取随应用提供的许可清单…</p>}
      {error && <div className="feedback" data-tone="error" role="alert"><p>许可清单读取失败，请重试或下载随应用提供的许可文件。</p><button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>重新读取许可清单</button></div>}
      {openSource && <details className="settings-details license-list"><summary>查看第三方组件与许可全文（{openSource.length} 项）</summary>
        <ul>{openSource.map((entry, index) => <li key={entry.name + entry.version + index}>
          <details><summary><span><strong>{entry.name}</strong><small>{entry.version} · {entry.license ?? '许可证未声明'} · {entry.purpose}</small></span></summary>
            <div className="license-content">{entry.source && <a className="settings-text-link" href={entry.source} target="_blank" rel="noreferrer">项目来源（外部网站）</a>}
              {entry.texts.map(file => <div key={file.name}><p className="muted">{file.name}</p><pre tabIndex={0} aria-label={entry.name + ' ' + file.name}>{file.text}</pre></div>)}
            </div>
          </details>
        </li>)}</ul>
      </details>}
      <a className="btn btn-secondary" href="/legal/THIRD-PARTY-NOTICES.txt" download="slow-listening-third-party-notices.txt">下载第三方许可全文</a>
      <details className="settings-details"><summary>yt-dlp 等外部工具许可</summary>
        <p>yt-dlp、其 EJS 依赖及运行环境{desktop ? '需要在本机另行配置' : '由服务宿主提供'}，未随本应用分发。yt-dlp 的源码与不同可执行发行物可能适用不同许可；应以实际安装版本和发行物所附许可为准。</p>
        <p className="muted">{status?.providers.youtube.toolVersion ? `当前${desktop ? '本机' : '服务'}报告 yt-dlp ${status.providers.youtube.toolVersion}。` : '当前未取得 yt-dlp 工具版本。'} <a href="https://github.com/yt-dlp/yt-dlp#licensing" target="_blank" rel="noreferrer">查看 yt-dlp 上游许可说明</a></p>
      </details>
    </section>
  </div>;
}
