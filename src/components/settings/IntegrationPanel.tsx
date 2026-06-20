/**
 * IntegrationPanel 组件
 *
 * 集成设置面板：展示第三方服务连接卡片。
 * 当前支持 GitHub OAuth Device Flow 连接。
 */

import { useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { formatRelativeTime } from '../../utils/time';
import { SettingSection } from './settingsShared';
import GitHubConnectModal from './GitHubConnectModal';
import type { IntegrationConfig } from '../../types';

/** GitHub Logo 内联 SVG */
function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.79 2.81 1.27 3.5.97.11-.76.42-1.27.76-1.56-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.21.96-.26 1.98-.39 3-.4 1.02.01 2.04.14 3 .4 2.28-1.53 3.29-1.21 3.29-1.21.66 1.64.24 2.86.12 3.16.77.83 1.24 1.88 1.24 3.17 0 4.53-2.81 5.53-5.49 5.82.43.36.81 1.08.81 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.21.68.83.56C20.57 21.89 24 17.49 24 12.29 24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

export default function IntegrationPanel() {
  const { t, language } = useI18n();
  const [configs, setConfigs] = useLocalStorage<IntegrationConfig[]>('integration-configs', []);
  const [modalOpen, setModalOpen] = useState(false);

  // 查找 GitHub 连接配置
  const githubConfig = configs.find(c => c.provider === 'github' && c.connected);

  /** 连接成功回调 */
  const handleConnected = (config: IntegrationConfig) => {
    setConfigs(prev => [...prev.filter(c => c.provider !== 'github'), config]);
    setModalOpen(false);
  };

  /** 断开连接 */
  const handleDisconnect = () => {
    if (window.confirm(t('settings.integration.confirmDisconnect'))) {
      setConfigs(prev => prev.filter(c => c.provider !== 'github'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingSection title={t('settings.integration.title')}>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          {t('settings.integration.description')}
        </p>

        {/* GitHub 服务卡片 */}
        <div className="group rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
          {/* 行1：Logo + 名称 + 状态 */}
          <div className="flex items-center gap-3">
            {/* Logo */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800">
              <GitHubLogo className="h-5 w-5 text-gray-800 dark:text-gray-100" />
            </div>

            {/* 名称 + 描述 */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#333333] dark:text-gray-100">
                  {t('settings.integration.github.name')}
                </span>
                {/* 状态徽标 */}
                {githubConfig ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    {t('settings.integration.connected')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-600" />
                    {t('settings.integration.notConnected')}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                {t('settings.integration.github.description')}
              </p>
            </div>
          </div>

          {/* 行2：已连接信息 / 操作按钮 */}
          <div className="mt-3 flex items-center justify-between pl-[52px]">
            {githubConfig ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  {/* GitHub 头像 */}
                  <img
                    src={githubConfig.avatarUrl}
                    alt={githubConfig.accountName}
                    className="h-5 w-5 rounded-full"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                    {githubConfig.accountName}
                  </span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {formatRelativeTime(githubConfig.connectedAt, language)}
                  </span>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                >
                  {t('settings.integration.disconnect')}
                </button>
              </>
            ) : (
              <div className="flex w-full justify-end">
                <button
                  onClick={() => setModalOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-[var(--brand-primary)] border border-[var(--brand-soft-border)] hover:bg-[var(--brand-soft-bg)] transition-colors"
                >
                  {t('settings.integration.connect')}
                </button>
              </div>
            )}
          </div>
        </div>
      </SettingSection>

      {/* Device Flow 连接弹窗 */}
      <GitHubConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConnected={handleConnected}
      />
    </div>
  );
}
