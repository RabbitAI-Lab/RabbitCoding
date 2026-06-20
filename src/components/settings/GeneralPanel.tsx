import { useState } from 'react';
import { Monitor, Sun, Moon, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { Language } from '../../i18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useTheme, type Theme } from '../../hooks/useTheme';
import { SettingSection, SettingRow, Toggle } from './settingsShared';
import { sendTestNotification, openNotificationSettings } from '../../utils/notify';
import { useUsage, formatTokens } from '../../hooks/useUsage';
import type { Workspace } from '../../types';

/** 主题选项配置 */
const THEME_OPTIONS: { value: Theme; labelKey: string; icon: LucideIcon }[] = [
  { value: 'system', labelKey: 'sidebar.footer.themeSystem', icon: Monitor },
  { value: 'light', labelKey: 'sidebar.footer.themeLight', icon: Sun },
  { value: 'dark', labelKey: 'sidebar.footer.themeDark', icon: Moon },
];

export default function GeneralPanel({ workspaces }: { workspaces: Workspace[] }) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const usageStats = useUsage(workspaces);

  // 通知偏好
  const [notifyTaskDone, setNotifyTaskDone] = useLocalStorage('pref-notify-task-done', true);
  const [notifyDesktop, setNotifyDesktop] = useLocalStorage('pref-notify-desktop', true);
  const [notifySound, setNotifySound] = useLocalStorage('pref-notify-sound', false);

  // 偏好设置
  const [autoCollapseThinking, setAutoCollapseThinking] = useLocalStorage('pref-auto-collapse-thinking', false);
  const [showTokenUsage, setShowTokenUsage] = useLocalStorage('pref-show-token-usage', false);

  // 隐私设置
  const [telemetry, setTelemetry] = useLocalStorage('pref-telemetry', true);
  const [saveHistory, setSaveHistory] = useLocalStorage('pref-save-history', true);

  // 测试通知状态
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');

  return (
    <div className="space-y-5">
      {/* ① 用量统计 */}
      <SettingSection title={t('settings.general.subscription.title')}>
        <div className="py-2">
          <p className="text-xs text-[#333333] dark:text-gray-200">
            {t('settings.general.subscription.usageDesc')}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* 对话次数 */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('settings.general.subscription.conversations')}</p>
            <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-200">{usageStats.totalConversations}</p>
          </div>
          {/* 总轮次 */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('settings.general.subscription.totalTurns')}</p>
            <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-200">{usageStats.totalTurns}</p>
          </div>
          {/* Input Tokens */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('settings.general.subscription.inputTokens')}</p>
            <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-200">{formatTokens(usageStats.totalTokens.inputTokens)}</p>
          </div>
          {/* Output Tokens */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('settings.general.subscription.outputTokens')}</p>
            <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-200">{formatTokens(usageStats.totalTokens.outputTokens)}</p>
          </div>
          {/* Cache Tokens */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('settings.general.subscription.cacheTokens')}</p>
            <p className="mt-1 text-lg font-semibold text-gray-800 dark:text-gray-200">
              {formatTokens(usageStats.totalTokens.cacheReadInputTokens + usageStats.totalTokens.cacheCreationInputTokens)}
            </p>
          </div>
        </div>
      </SettingSection>

      {/* ② 语言 */}
      <SettingSection title={t('settings.general.language')}>
        <SettingRow
          label={t('settings.general.language')}
          description={t('settings.general.languageDesc')}
        >
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 p-0.5">
            {(['zh', 'en'] as const).map(lang => (
              <button
                key={lang}
                onClick={() => setLanguage(lang as Language)}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  language === lang
                    ? 'bg-[var(--brand-solid)] text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {lang === 'zh' ? t('sidebar.footer.chinese') : t('sidebar.footer.english')}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      {/* ③ 外观 */}
      <SettingSection title={t('settings.general.appearance')}>
        <SettingRow
          label={t('settings.general.appearance')}
          description={t('settings.general.appearanceDesc')}
        >
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 p-0.5">
            {THEME_OPTIONS.map(opt => {
              const active = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors ${
                    active
                      ? 'bg-[var(--brand-solid)] text-white'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <opt.icon size={12} />
                  <span>{t(opt.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </SettingRow>
      </SettingSection>

      {/* ④ 通知 */}
      <SettingSection title={t('settings.general.notifications')}>
        <SettingRow
          label={t('settings.general.notifyTaskDone')}
          description={t('settings.general.notifyTaskDoneDesc')}
        >
          <Toggle checked={notifyTaskDone} onChange={setNotifyTaskDone} />
        </SettingRow>
        <div className="border-t border-gray-100 dark:border-gray-700" />
        <SettingRow
          label={t('settings.general.notifyDesktop')}
          description={t('settings.general.notifyDesktopDesc')}
        >
          <Toggle checked={notifyDesktop} onChange={setNotifyDesktop} />
        </SettingRow>
        <div className="border-t border-gray-100 dark:border-gray-700" />
        <SettingRow
          label={t('settings.general.notifySound')}
          description={t('settings.general.notifySoundDesc')}
        >
          <Toggle checked={notifySound} onChange={setNotifySound} />
        </SettingRow>
        <div className="border-t border-gray-100 dark:border-gray-700" />
        <SettingRow
          label={t('settings.general.testNotification')}
          description={t('settings.general.testNotificationDesc')}
        >
          <div className="flex items-center gap-2">
            {testStatus === 'success' && (
              <span className="text-xs text-green-600 dark:text-green-400">
                {language === 'zh' ? '✓ 已发送' : '✓ Sent'}
              </span>
            )}
            {testStatus === 'failed' && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {language === 'zh' ? '✗ 未弹出' : '✗ Not shown'}
              </span>
            )}
            <button
              disabled={testStatus === 'testing'}
              onClick={async () => {
                setTestStatus('testing');
                const result = await sendTestNotification();
                setTestStatus(result.ok ? 'success' : 'failed');
                setTimeout(() => setTestStatus('idle'), 5000);
              }}
              className="rounded-lg px-3 py-1 text-xs text-[var(--brand-primary)] hover:bg-[var(--brand-soft-bg)] transition-colors disabled:opacity-50"
            >
              {testStatus === 'testing'
                ? (language === 'zh' ? '发送中…' : 'Sending…')
                : t('settings.general.testNotification')}
            </button>
          </div>
        </SettingRow>
        {/* 提示文字 + 打开系统设置按钮 */}
        <div className="px-4 py-2">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
            {language === 'zh'
              ? '如果未看到桌面通知，请在系统设置中允许 Rabbit Coding 发送通知。'
              : 'If you don\'t see desktop notifications, please allow Rabbit Coding in System Settings.'}
          </p>
          <button
            onClick={() => openNotificationSettings()}
            className="text-[11px] text-[var(--brand-primary)] hover:underline"
          >
            {language === 'zh' ? '› 打开系统通知设置' : '› Open System Notification Settings'}
          </button>
        </div>
      </SettingSection>

      {/* ⑤ 偏好 */}
      <SettingSection title={t('settings.general.preferences')}>
        <SettingRow
          label={t('settings.general.autoCollapseThinking')}
          description={t('settings.general.autoCollapseThinkingDesc')}
        >
          <Toggle checked={autoCollapseThinking} onChange={setAutoCollapseThinking} />
        </SettingRow>
        <div className="border-t border-gray-100 dark:border-gray-700" />
        <SettingRow
          label={t('settings.general.showTokenUsage')}
          description={t('settings.general.showTokenUsageDesc')}
        >
          <Toggle checked={showTokenUsage} onChange={setShowTokenUsage} />
        </SettingRow>
      </SettingSection>

      {/* ⑥ 隐私 */}
      <SettingSection title={t('settings.general.privacy')}>
        <SettingRow
          label={t('settings.general.telemetry')}
          description={t('settings.general.telemetryDesc')}
        >
          <Toggle checked={telemetry} onChange={setTelemetry} />
        </SettingRow>
        <div className="border-t border-gray-100 dark:border-gray-700" />
        <SettingRow
          label={t('settings.general.saveHistory')}
          description={t('settings.general.saveHistoryDesc')}
        >
          <Toggle checked={saveHistory} onChange={setSaveHistory} />
        </SettingRow>
        <div className="border-t border-gray-100 dark:border-gray-700" />
        <SettingRow
          label={t('settings.general.clearCache')}
          description={t('settings.general.clearCacheDesc')}
        >
          <button
            onClick={() => console.log('[Settings] Clear cache requested')}
            className="rounded-lg px-3 py-1 text-xs text-red-500 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-300"
          >
            {t('settings.general.clear')}
          </button>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
