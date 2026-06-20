import { useState, useMemo, useEffect } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "./components/sidebar/Sidebar";
import ContentArea from "./components/ContentArea";
import SettingsPage, { type SettingsSection } from "./components/settings/SettingsPage";
import PluginMarketPage from "./components/PluginMarketPage";
import TodoPage from "./components/TodoPage";
import KnowledgeBasePage from "./components/KnowledgeBasePage";
import PendingWikiDialog, { type PendingWikiInfo } from "./components/wiki/PendingWikiDialog";
import PetTaskBridge from "./components/pet/PetTaskBridge";
import { useWorkspaces } from "./hooks/useWorkspaces";
import { CodebaseIndexProvider } from "./hooks/useCodebaseIndex";
import { AgentProvider } from './hooks/useAgentContext';
import { AuthProvider } from './hooks/useAuth';
import { I18nProvider } from "./i18n";
import { ThemeProvider, useTheme } from "./hooks/useTheme";

/** 连接 useTheme → antd ConfigProvider，使 antd 组件跟随暗色模式 */
function AntdThemeSync({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <ConfigProvider
      theme={{
        algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      {children}
    </ConfigProvider>
  );
}

function App() {
  const store = useWorkspaces();
  const [view, setView] = useState<'main' | 'settings' | 'pluginMarket' | 'todo' | 'knowledgeBase'>('main');
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  const [pendingWiki, setPendingWiki] = useState<PendingWikiInfo[]>([]);
  const selectedWorkspace = store.workspaces.find(w => w.id === store.selectedWorkspaceId);

  // 冷启动检测未完成的 Wiki 生成
  useEffect(() => {
    if (store.isLoading) return;
    const checkPending = async () => {
      const wsList = store.workspaces
        .filter(ws => ws.path)
        .map(ws => ({
          workspaceId: ws.id,
          workspacePath: ws.path!,
          workspaceName: ws.name,
        }));
      if (wsList.length === 0) return;
      try {
        const result = await invoke<PendingWikiInfo[]>('wiki_check_pending', { workspaces: wsList });
        if (result.length > 0) {
          setPendingWiki(result);
        }
      } catch (e) {
        console.error('[App] wiki_check_pending failed:', e);
      }
    };
    void checkPending();
    // 仅在 isLoading 从 true→false 时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isLoading]);

  // 点击 Rabbit/Workspace 时自动切回 main 视图
  const storeWithViewSwitch = useMemo(() => ({
    ...store,
    selectRabbit: (rabbitId: string | null) => {
      store.selectRabbit(rabbitId);
      if (rabbitId) setView('main');
    },
    selectWorkspace: (id: string | null) => {
      store.selectWorkspace(id);
      setView('main');
    },
  }), [store]);

  // Loading 界面：等待异步数据加载完成
  if (store.isLoading) {
    return (
      <ThemeProvider>
        <AntdThemeSync>
          <I18nProvider>
            <div className="flex h-screen items-center justify-center bg-[#F8F8F8] dark:bg-[#1a1a1a]">
              <div className="h-6 w-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
            </div>
          </I18nProvider>
        </AntdThemeSync>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AntdThemeSync>
        <I18nProvider>
        <AuthProvider>
        <CodebaseIndexProvider workspaces={store.workspaces}>
          <AgentProvider store={store}>
          <PetTaskBridge store={store} />
          <div className="flex h-screen bg-[#F8F8F8] dark:bg-[#1a1a1a]">
            {view === 'settings' ? (
              <SettingsPage onBack={() => setView('main')} initialSection={settingsSection} workspaces={store.workspaces} />
            ) : (
              <>
                <Sidebar
                  store={storeWithViewSwitch}
                  onOpenSettings={() => { setSettingsSection(undefined); setView('settings'); }}
                  onOpenPluginMarket={() => { store.selectRabbit(null); setView('pluginMarket'); }}
                  isPluginMarketActive={view === 'pluginMarket'}
                  onOpenTodo={() => { store.selectRabbit(null); setView('todo'); }}
                  isTodoActive={view === 'todo'}
                  onOpenKnowledgeBase={(workspaceId) => { store.selectWorkspace(workspaceId); setView('knowledgeBase'); }}
                />
                {view === 'pluginMarket' ? (
                  <PluginMarketPage />
                ) : view === 'todo' ? (
                  <TodoPage />
                ) : view === 'knowledgeBase' ? (
                  <KnowledgeBasePage workspace={selectedWorkspace} />
                ) : (
                  <ContentArea store={storeWithViewSwitch} onOpenSettings={(section) => { setSettingsSection(section as SettingsSection); setView('settings'); }} />
                )}
              </>
            )}
          </div>
          </AgentProvider>

                   {/* 冷启动提醒：未完成的 Wiki 生成 */}
          {pendingWiki.length > 0 && (
            <PendingWikiDialog
              pendingList={pendingWiki}
              onContinue={(wsId) => {
                store.selectWorkspace(wsId);
                setView('knowledgeBase');
                setPendingWiki([]);
              }}
              onDismiss={() => setPendingWiki([])}
            />
          )}
        </CodebaseIndexProvider>
        </AuthProvider>
        </I18nProvider>
      </AntdThemeSync>
    </ThemeProvider>
  );
}

export default App;
