import SidebarHeader from './SidebarHeader';
import WorkspaceList from './WorkspaceList';
import SidebarFooter from './SidebarFooter';
import type { useWorkspaces } from '../../hooks/useWorkspaces';
import { useResizable } from '../../hooks/useResizable';
import { titleBarPadding } from '../../utils/platform';

interface SidebarProps {
  store: ReturnType<typeof useWorkspaces>;
  onOpenSettings: () => void;
  onOpenPluginMarket: () => void;
  isPluginMarketActive: boolean;
  onOpenTodo: () => void;
  isTodoActive: boolean;
}

export default function Sidebar({ store, onOpenSettings, onOpenPluginMarket, isPluginMarketActive, onOpenTodo, isTodoActive }: SidebarProps) {
  const { width, isResizing, handleProps } = useResizable({
    storageKey: 'sidebar-width',
    defaultWidth: 272,
  });

  return (
    <aside
      className="relative flex h-screen shrink-0 flex-col bg-[#F8F8F8] dark:bg-[#1a1a1a]"
      style={{ width }}
    >
      {/* 标题栏拖拽区域（macOS 红绿灯按钮占位 / Windows 直接顶齐） */}
      <div data-tauri-drag-region className={`h-[34px] shrink-0 ${titleBarPadding}`} />

      <SidebarHeader store={store} />
      <WorkspaceList store={store} />
      <SidebarFooter onOpenSettings={onOpenSettings} onOpenPluginMarket={onOpenPluginMarket} isPluginMarketActive={isPluginMarketActive} onOpenTodo={onOpenTodo} isTodoActive={isTodoActive} workspaces={store.workspaces} />

      {/* 拖拽手柄 */}
      <div
        {...handleProps}
        className={`absolute inset-y-0 right-0 w-1 cursor-col-resize transition-colors hover:bg-blue-500/40 ${
          isResizing ? 'bg-blue-500/40' : ''
        }`}
      />
    </aside>
  );
}
