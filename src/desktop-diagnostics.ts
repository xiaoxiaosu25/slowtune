import type { BilibiliAccountState, ServerStatus } from './api';
import type { DesktopRuntimeInfo } from './desktop-host';

const version = (value: unknown) => typeof value === 'string' && /^v?\d+(?:\.\d+){1,3}(?:-(?:alpha|beta|rc)\.\d+)?$/.test(value) ? value : '未知';
const flag = (value: unknown, yes: string, no: string) => value === true ? yes : value === false ? no : '未知';
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '未知';
export function diagnosticErrorCode(issue: unknown) {
  const code = (issue as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && ['network', 'timeout', 'unauthorized', 'unavailable', 'upstream', 'rate-limited', 'cancelled'].includes(code) ? code : 'unknown';
}

// Explicit fields only. Never serialize a response, account, exception or log wholesale.
export function desktopDiagnostics({ runtime, status, account, checkedAt, refreshFailed, operationError }: {
  runtime?: DesktopRuntimeInfo; status?: ServerStatus; account?: BilibiliAccountState; checkedAt?: number; refreshFailed: boolean; operationError?: string;
}) {
  const youtube = status?.providers?.youtube;
  const accountState = account?.state;
  const savedError = runtime?.preferences?.error;
  return [
    '慢听 Windows 桌面诊断',
    `应用版本：${version(runtime?.appVersion)}`,
    `内部服务版本：${version(status?.version)}`,
    `系统：${runtime?.platform === 'win32' ? 'Windows' : '未知'} · ${['x64', 'arm64', 'ia32'].includes(runtime?.arch ?? '') ? runtime!.arch : '未知'}`,
    `Electron：${version(runtime?.electron)} · Chromium：${version(runtime?.chromium)}`,
    `宿主 Node.js：${version(runtime?.node)} · 服务 Node.js：${version(status?.node)}`,
    `信息时间：${typeof checkedAt === 'number' && Number.isFinite(checkedAt) && checkedAt > 0 && checkedAt < 8.64e15 ? new Date(checkedAt).toISOString() : '未知'}`,
    `本次状态读取：${refreshFailed ? '失败，保留上次信息' : status ? '成功（不代表实际播放通过）' : '未知'}`,
    `构建状态：${flag(status?.build?.stale, '更新待重启', '与运行中服务一致')}`,
    `B站接入：${flag(status?.providers?.bilibili?.available, '可用（未验证实际播放）', '不可用')}`,
    `B站账号：${accountState === 'authenticated' ? '已登录' : accountState === 'anonymous' ? '未登录' : accountState === 'expired' ? '已过期' : accountState === 'unavailable' ? '读取失败' : '未知'}`,
    `YouTube 开关：${flag(youtube?.enabled, '开启', '关闭')} · 工具：${youtube?.checking === true ? '检查中' : flag(youtube?.available, '可用（未验证实际播放）', '不可用')}`,
    `yt-dlp 版本：${version(youtube?.toolVersion)}`,
    `来源错误：${youtube?.issue ? 'YouTube 有状态说明（原文未复制）' : '未知／未报告'}`,
    `本机资源：媒体读取 ${count(status?.delivery?.activeReads)} · 取源任务 ${count(status?.tool?.active)}`,
    `偏好保存：${runtime ? runtime.preferences.pending ? '尚未完成' : '已完成' : '未知'} · 错误：${savedError && ['ENOSPC', 'EACCES', 'EPERM', 'write-failed'].includes(savedError) ? savedError : savedError ? 'unknown' : runtime ? '未报告' : '未知'}`,
    `最近操作错误：${operationError ? diagnosticErrorCode({ code: operationError }) : '未报告'}`,
    '仅含版本、状态及错误分类；不含凭据、媒体地址、账号身份、私人路径或原始日志。仅复制到剪贴板，不自动上传。',
  ].join('\n');
}
