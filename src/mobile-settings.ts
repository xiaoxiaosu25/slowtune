export const mobileSettingsTitles = {
  appearance: '外观与主题',
  welcome: '欢迎页',
  sources: '音乐来源',
  account: 'B站账号',
  recommendation: '推荐偏好',
  access: '启动与访问',
  diagnostics: '数据与诊断',
  about: '关于慢听',
} as const;

export type MobileSettingsSection = keyof typeof mobileSettingsTitles;
export const mobileSettingsRoute = (section: MobileSettingsSection) => 'settings/' + section;
export function mobileSettingsSection(route: string): MobileSettingsSection | undefined {
  if (!route.startsWith('settings/')) return;
  const section = route.slice('settings/'.length);
  return Object.hasOwn(mobileSettingsTitles, section) ? section as MobileSettingsSection : undefined;
}
