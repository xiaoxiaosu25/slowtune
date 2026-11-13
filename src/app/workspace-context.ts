import { createContext, useContext } from 'react';
import type { WorkspaceController } from './useWorkspaceController';

/** 工作区控制器的结果；由 App 提供，界面区域通过 useWorkspace() 读取。 */
export const WorkspaceContext = createContext<WorkspaceController | null>(null);

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace() must be used inside WorkspaceContext.Provider');
  return workspace;
}
