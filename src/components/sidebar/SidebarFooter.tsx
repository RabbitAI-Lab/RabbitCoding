import { useRef, useState, useCallback } from 'react';
import {
  Settings, Palette, HelpCircle, LogOut,
  BarChart3, Languages, Check, ChevronRight,
  Monitor, Sun, Moon, Store, ListTodo,
  LogIn,
} from 'lucide-react';
import Popover from '../common/Popover';
import Tooltip from '../common/Tooltip';
import Modal from '../common/Modal';
import FeedbackPanel from '../settings/FeedbackPanel';
import { useI18n } from '../../i18n/useI18n';
import type { Language } from '../../i18n';
import { useTheme, type Theme } from '../../hooks/useTheme';
import { useUsage, formatTokens } from '../../hooks/useUsage';
import { useAuth } from '../../hooks/useAuth';
import type { Workspace } from '../../types';

export default function SidebarFooter({ onOpenSettings, onOpenPluginMarket, isPluginMarketActive, onOpenTodo, isTodoActive, workspaces }: { onOpenSettings: () => void; onOpenPluginMarket: () => void; isPluginMarketActive: boolean; onOpenTodo: () => void; isTodoActive: boolean; workspaces: Workspace[] }) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, isLoggingIn, loginError, login, logout } = useAuth();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // 主题子菜单状态
  const [themeSubmenuOpen, setThemeSubmenuOpen] = useState(false);
  const [themeSubmenuPos, setThemeSubmenuPos] = useState({ left: 0, top: 0 });

  // 语言子菜单状态
  const [langSubmenuOpen, setLangSubmenuOpen] = useState(false);
  const [langSubmenuPos, setLangSubmenuPos] = useState({ left: 0, top: 0 });

  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const usageBtnRef = useRef<HTMLButtonElement>(null);
  const themeItemRef = useRef<HTMLDivElement>(null);
  const themeSubmenuRef = useRef<HTMLDivElement>(null);
  const langItemRef = useRef<HTMLDivElement>(null);
  const langSubmenuRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSettings = useCallback(() => {
    setSettingsOpen(prev => !prev);
    setUsageOpen(false);
    setThemeSubmenuOpen(false);
    setLangSubmenuOpen(false);
  }, []);

  const toggleUsage = useCallback(() => {
    setUsageOpen(prev => !prev);
    setSettingsOpen(false);
  }, []);

  const handleMenuClick = useCallback((key: string) => {
    if (key === 'openSettings') {
      onOpenSettings();
      setSettingsOpen(false);
      return;
    }
    if (key === 'help') {
      setFeedbackOpen(true);
      setSettingsOpen(false);
      return;
    }
    if (key === 'logout') {
      logout();
      setSettingsOpen(false);
      return;
    }
    console.log(`Menu clicked: ${key}`);
    if (key !== 'theme' && key !== 'language') {
      setSettingsOpen(false);
    }
  }, [onOpenSettings, logout]);

  // ---------- 通用 hover 延时工具 ----------
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // ---------- 主题子菜单 ----------
  const handleThemeMouseEnter = useCallback(() => {
    clearHoverTimer();
    setLangSubmenuOpen(false);
    if (themeItemRef.current) {
      const rect = themeItemRef.current.getBoundingClientRect();
      setThemeSubmenuPos({ left: rect.right + 2, top: rect.top });
    }
    setThemeSubmenuOpen(true);
  }, [clearHoverTimer]);

  const handleThemeMouseLeave = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => setThemeSubmenuOpen(false), 150);
  }, [clearHoverTimer]);

  const handleThemeSelect = useCallback((next: Theme) => {
    setTheme(next);
    setThemeSubmenuOpen(false);
    setSettingsOpen(false);
  }, [setTheme]);

  // ---------- 语言子菜单 ----------
  const handleLangMouseEnter = useCallback(() => {
    clearHoverTimer();
    setThemeSubmenuOpen(false);
    if (langItemRef.current) {
      const rect = langItemRef.current.getBoundingClientRect();
      setLangSubmenuPos({ left: rect.right + 2, top: rect.top });
    }
    setLangSubmenuOpen(true);
  }, [clearHoverTimer]);

  const handleLangMouseLeave = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => setLangSubmenuOpen(false), 150);
  }, [clearHoverTimer]);

  const handleLanguageSelect = useCallback((lang: Language) => {
    setLanguage(lang);
    setLangSubmenuOpen(false);
    setSettingsOpen(false);
  }, [setLanguage]);

  // ---------- 子菜单公共 hover ----------
  const handleSubmenuMouseEnter = useCallback(() => clearHoverTimer(), [clearHoverTimer]);
  const handleSubmenuMouseLeave = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setThemeSubmenuOpen(false);
      setLangSubmenuOpen(false);
    }, 150);
  }, [clearHoverTimer]);

  const menuItems = [
    { key: 'openSettings', labelKey: 'sidebar.footer.settings', icon: Settings, dividerBelow: true },
    { key: 'theme', labelKey: 'sidebar.footer.theme', icon: Palette },
    { key: 'language', labelKey: 'sidebar.footer.language', icon: Languages, dividerBelow: true },
    { key: 'help', labelKey: 'sidebar.footer.help', icon: HelpCircle },
    ...(user ? [{ key: 'logout', labelKey: 'sidebar.footer.logout', icon: LogOut, danger: true }] : []),
  ];

  const themeOptions: { value: Theme; labelKey: string; Icon: typeof Monitor }[] = [
    { value: 'system', labelKey: 'sidebar.footer.themeSystem', Icon: Monitor },
    { value: 'light', labelKey: 'sidebar.footer.themeLight', Icon: Sun },
    { value: 'dark', labelKey: 'sidebar.footer.themeDark', Icon: Moon },
  ];

  const languageOptions: { value: Language; labelKey: string }[] = [
    { value: 'zh', labelKey: 'sidebar.footer.chinese' },
    { value: 'en', labelKey: 'sidebar.footer.english' },
  ];

  const usageStats = useUsage(workspaces);

  const hasSubmenu = (key: string) => key === 'theme' || key === 'language';

  return (
    <>
      {/* Todo + 插件市场入口 */}
      <div className="px-3 pb-1">
        <button
          onClick={onOpenTodo}
          className={`group flex w-full items-center gap-1 rounded-md -mx-1.5 px-1.5 py-1.5 cursor-pointer text-left transition-colors ${
            isTodoActive
              ? 'bg-blue-100/60 text-[#141414] dark:bg-blue-900/40 dark:text-gray-100'
              : 'hover:bg-gray-200/40 text-[#646261] hover:text-[#141414] dark:hover:bg-gray-700/40 dark:text-gray-400 dark:hover:text-white'
          }`}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <ListTodo size={13} />
          </span>
          <span className="flex-1 truncate text-xs">{t('todo.title')}</span>
        </button>
        <button
          onClick={onOpenPluginMarket}
          className={`group flex w-full items-center gap-1 rounded-md -mx-1.5 px-1.5 py-1.5 cursor-pointer text-left transition-colors ${
            isPluginMarketActive
              ? 'bg-blue-100/60 text-[#141414] dark:bg-blue-900/40 dark:text-gray-100'
              : 'hover:bg-gray-200/40 text-[#646261] hover:text-[#141414] dark:hover:bg-gray-700/40 dark:text-gray-400 dark:hover:text-white'
          }`}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <Store size={13} />
          </span>
          <span className="flex-1 truncate text-xs">{t('sidebar.pluginMarket.title')}</span>
        </button>
      </div>

      {/* 用户账号区域 */}
      <div className="px-3 py-3">
        {user ? (
          /* ---- 已登录状态：显示用户信息 ---- */
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full overflow-hidden">
              <img src="/avatar.png" alt="avatar" className="h-full w-full rounded-full object-cover" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{user.displayName || user.username}</p>
              <p className="truncate text-[10px] text-gray-400 dark:text-gray-500">{user.email}</p>
            </div>
            <Tooltip content={t('sidebar.footer.usage')}>
              <button
                ref={usageBtnRef}
                onClick={toggleUsage}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-blue-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-blue-300"
              >
                <BarChart3 size={14} />
              </button>
            </Tooltip>
            <Tooltip content={t('sidebar.footer.settings')}>
              <button
                ref={settingsBtnRef}
                onClick={toggleSettings}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-blue-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-blue-300"
              >
                <Settings size={14} />
              </button>
            </Tooltip>
          </div>
        ) : (
          /* ---- 未登录状态：显示登录按钮 ---- */
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full overflow-hidden">
              <img src="/avatar.png" alt="avatar" className="h-full w-full rounded-full object-cover" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                {isLoggingIn ? t('sidebar.footer.loggingIn') : t('sidebar.footer.notLoggedIn')}
              </p>
              {loginError && (
                <p className="truncate text-[10px] text-red-400">{loginError}</p>
              )}
            </div>
            <button
              onClick={login}
              disabled={isLoggingIn}
              className="login-orange-btn flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: isLoggingIn ? undefined : '#E8702A',
              }}
            >
              <LogIn size={12} />
              <span>{t('sidebar.footer.login')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Usage popover */}
      <Popover
        anchorRef={usageBtnRef}
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
      >
        <div className="min-w-[200px] px-4 py-3">
          <p className="mb-3 text-xs font-semibold text-gray-700 dark:text-gray-200">{t('sidebar.footer.usageOverview')}</p>

          {/* 对话次数 */}
          <div className="mb-2.5 last:mb-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">{t('sidebar.footer.conversations')}</span>
              <span className="font-semibold text-blue-600 dark:text-blue-300">{usageStats.totalConversations}</span>
            </div>
          </div>

          {/* 总轮次 */}
          <div className="mb-2.5 last:mb-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">{t('sidebar.footer.totalTurns')}</span>
              <span className="font-semibold text-blue-600 dark:text-blue-300">{usageStats.totalTurns}</span>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="my-2 border-t border-gray-100 dark:border-gray-700" />

          {/* Input Tokens */}
          <div className="mb-1.5 last:mb-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">{t('sidebar.footer.inputTokens')}</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatTokens(usageStats.totalTokens.inputTokens)}</span>
            </div>
          </div>

          {/* Output Tokens */}
          <div className="mb-1.5 last:mb-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">{t('sidebar.footer.outputTokens')}</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatTokens(usageStats.totalTokens.outputTokens)}</span>
            </div>
          </div>

          {/* Cache Tokens */}
          <div className="mb-1.5 last:mb-0">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">{t('sidebar.footer.cacheTokens')}</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {formatTokens(usageStats.totalTokens.cacheReadInputTokens + usageStats.totalTokens.cacheCreationInputTokens)}
              </span>
            </div>
          </div>
        </div>
      </Popover>

      {/* Settings popover */}
      <Popover
        anchorRef={settingsBtnRef}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setThemeSubmenuOpen(false);
          setLangSubmenuOpen(false);
        }}
        ignoredRefs={[themeSubmenuRef, langSubmenuRef]}
      >
        {menuItems.map(item => {
          const isTheme = item.key === 'theme';
          const isLang = item.key === 'language';
          return (
            <div
              key={item.key}
              ref={isTheme ? themeItemRef : isLang ? langItemRef : undefined}
              onMouseEnter={isTheme ? handleThemeMouseEnter : isLang ? handleLangMouseEnter : undefined}
              onMouseLeave={isTheme ? handleThemeMouseLeave : isLang ? handleLangMouseLeave : undefined}
            >
              <button
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                  item.danger
                    ? 'text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/60'
                }`}
                onClick={() => handleMenuClick(item.key)}
              >
                <item.icon size={14} className="shrink-0" />
                <span>{t(item.labelKey)}</span>
                {hasSubmenu(item.key) && (
                  <ChevronRight size={12} className="ml-auto shrink-0 text-gray-400 dark:text-gray-500" />
                )}
              </button>
              {item.dividerBelow && (
                <div className="my-1 border-t border-gray-100 dark:border-gray-700/60" />
              )}
            </div>
          );
        })}
      </Popover>

      {/* 主题子菜单 */}
      {themeSubmenuOpen && (
        <div
          ref={themeSubmenuRef}
          onMouseEnter={handleSubmenuMouseEnter}
          onMouseLeave={handleSubmenuMouseLeave}
          className="fixed z-[60] min-w-[150px] rounded-lg border border-gray-200 bg-[#F8F8F8] py-1 shadow-lg dark:border-gray-700 dark:bg-[#1e1e1e]"
          style={{ left: themeSubmenuPos.left, top: themeSubmenuPos.top }}
        >
          {themeOptions.map(opt => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleThemeSelect(opt.value)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/60'
                }`}
              >
                <opt.Icon size={14} className="shrink-0" />
                <span className="flex-1">{t(opt.labelKey)}</span>
                {active && <Check size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {/* 问题反馈弹窗 */}
      <Modal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        title={t('settings.nav.feedback')}
        widthClassName="w-[680px]"
      >
        <FeedbackPanel />
      </Modal>

      {/* 语言子菜单 */}
      {langSubmenuOpen && (
        <div
          ref={langSubmenuRef}
          onMouseEnter={handleSubmenuMouseEnter}
          onMouseLeave={handleSubmenuMouseLeave}
          className="fixed z-[60] min-w-[140px] rounded-lg border border-gray-200 bg-[#F8F8F8] py-1 shadow-lg dark:border-gray-700 dark:bg-[#1e1e1e]"
          style={{ left: langSubmenuPos.left, top: langSubmenuPos.top }}
        >
          {languageOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleLanguageSelect(opt.value)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                language === opt.value
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/60'
              }`}
            >
              <span>{t(opt.labelKey)}</span>
              {language === opt.value && <Check size={14} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
