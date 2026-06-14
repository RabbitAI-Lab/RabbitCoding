import { useState, useMemo } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import Sidebar from "./components/sidebar/Sidebar";
import ContentArea from "./components/ContentArea";
import SettingsPage, { type SettingsSection } from "./components/settings/SettingsPage";
import PluginMarketPage from "./components/PluginMarketPage";
import TodoPage from "./components/TodoPage";
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
  const [view, setView] = useState<'main' | 'settings' | 'pluginMarket' | 'todo'>('main');
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);

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
                />
                {view === 'pluginMarket' ? (
                  <PluginMarketPage />
                ) : view === 'todo' ? (
                  <TodoPage />
                ) : (
                  <ContentArea store={storeWithViewSwitch} onOpenSettings={(section) => { setSettingsSection(section as SettingsSection); setView('settings'); }} />
                )}
              </>
            )}
          </div>
          </AgentProvider>
        </CodebaseIndexProvider>
        </AuthProvider>
        </I18nProvider>
      </AntdThemeSync>
    </ThemeProvider>
  );
}

export default App;
