export interface WelcomeSettings {
  background: 'builtin' | 'custom' | 'plain';
  imageId?: string;
  desktopFocus: { x: number; y: number };
  mobileFocus: { x: number; y: number };
  shade: number;
  position: 'left' | 'center' | 'right';
}
export interface WelcomeState { revision: string; welcome: WelcomeSettings }
export interface BootstrapState extends WelcomeState { authenticationRequired: boolean; authenticated: boolean }
export interface AccessState { revision: string; authenticationRequired: boolean }
export const defaultWelcome = (): WelcomeSettings => ({ background: 'builtin', desktopFocus: { x: 50, y: 50 }, mobileFocus: { x: 36, y: 50 }, shade: 22, position: 'right' });
