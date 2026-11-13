import { Button } from '../../ui/Button';
import type { ServerStatus } from '../../api';

/** 页面与运行中的服务不是同一次构建时，提示重启服务。 */
export function StaleBuildNotice({
  build,
  reload,
}: {
  build: NonNullable<ServerStatus['build']>;
  reload: () => unknown;
}) {
  return (
    <div className="build-notice" role="alert">
      <h1>服务端仍是旧构建</h1>
      <p>
        磁盘上的
        {build.changed.map((artifact) => (artifact === 'server' ? '服务端代码' : '网页资源')).join('、')}
        比运行中的服务更新。当前页面与运行中的服务不是同一次构建，B站栏目等接口会失败。
      </p>
      <p>
        请先运行 stop.cmd，再运行 一键启动.cmd（或在仓库执行 npm
        start）重新启动服务，然后重新输入访问码并刷新本页。
      </p>
      <p className="muted">
        服务启动 {new Date(build.startedAt).toLocaleString('zh-CN', { hour12: false })} · 磁盘构建{' '}
        {new Date(Math.max(build.current.server, build.current.client)).toLocaleString('zh-CN', {
          hour12: false,
        })}
      </p>
      <Button variant="primary"  onClick={() => void reload()}>
        重新检查
      </Button>
    </div>
  );
}
