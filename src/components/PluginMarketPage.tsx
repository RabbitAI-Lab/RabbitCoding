/**
 * PluginMarketPage — 插件市场全页面
 *
 * 展示可用插件列表，支持一键安装。
 * 含「市场」和「已安装」两个 Tab。
 */

import { useState, useMemo } from 'react';
import {
  Store,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PackageOpen,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { usePlugins, type PluginId, type PluginState } from '../hooks/usePlugins';

// 产品真实图标
import gitnexusLogo from '../assets/gitnexus-logo.png';
import context7Logo from '../assets/context7-logo.png';
import eccLogo from '../assets/ecc-logo.png';

// ============================================================
// 插件元数据
// ============================================================

interface PluginMeta {
  id: PluginId;
  name: string;
  logo: string;
  descKey: string;
}

const PLUGINS: PluginMeta[] = [
  {
    id: 'gitnexus',
    name: 'GitNexus',
    logo: gitnexusLogo,
    descKey: 'pluginMarket.gitnexusDesc',
  },
  {
    id: 'context7',
    name: 'Context7',
    logo: context7Logo,
    descKey: 'pluginMarket.context7Desc',
  },
  {
    id: 'ecc',
    name: 'ECC 2.0',
    logo: eccLogo,
    descKey: 'pluginMarket.eccDesc',
  },
];

// ============================================================
// 插件卡片
// ============================================================

function PluginCard({ meta, showUninstall, pluginStates, installPlugin, uninstallPlugin }: {
  meta: PluginMeta;
  showUninstall: boolean;
  pluginStates: Record<PluginId, PluginState>;
  installPlugin: (id: PluginId) => Promise<void>;
  uninstallPlugin: (id: PluginId) => Promise<void>;
}) {
  const { t } = useI18n();

  const state = pluginStates[meta.id];
  const isInstalled = state?.installed ?? false;
  const status = state?.status ?? 'idle';
  const message = state?.message;

  const isInstalling = status === 'installing';
  const isError = status === 'error';

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-[#2a2a2a] transition-shadow hover:shadow-md">
      {/* 顶部：图标 + 名称 */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg overflow-hidden">
          <img src={meta.logo} alt={meta.name} className="h-10 w-10 object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{meta.name}</h3>
        </div>
      </div>

      {/* 描述 */}
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 flex-1 leading-relaxed">
        {t(meta.descKey)}
      </p>

      {/* 安装中实时日志 */}
      {isInstalling && message && (
        <div className="mb-3 rounded-md bg-blue-50 dark:bg-blue-900/20 px-2 py-1.5">
          <p className="text-[11px] text-blue-600 dark:text-blue-400 truncate font-mono">{message}</p>
        </div>
      )}

      {/* 错误信息 */}
      {isError && message && (
        <div className="mb-3 flex items-start gap-1.5 rounded-md bg-red-50 dark:bg-red-900/20 px-2 py-1.5">
          <AlertCircle size={12} className="shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
          <p className="text-[11px] text-red-600 dark:text-red-400 break-all line-clamp-2">{message}</p>
        </div>
      )}

      {/* 底部操作区 */}
      <div className="flex items-center justify-between">
        {isInstalled && !isInstalling && !isError && !showUninstall ? (
          /* 市场 Tab：已安装状态默认只显示徽章 */
          <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 size={14} />
            {t('pluginMarket.installed')}
          </span>
        ) : isInstalling ? (
          <span className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            <Loader2 size={14} className="animate-spin" />
            {t('pluginMarket.installing')}
          </span>
        ) : isError ? null : (
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('pluginMarket.notInstalled')}</span>
        )}

        {/* 按钮 */}
        {isError ? (
          <button
            onClick={() => installPlugin(meta.id)}
            className="flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Download size={13} />
            {t('pluginMarket.retry')}
          </button>
        ) : isInstalling ? (
          <button
            disabled
            className="flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-blue-600 text-white opacity-50 cursor-not-allowed"
          >
            <Loader2 size={13} className="animate-spin" />
            {t('pluginMarket.installing')}
          </button>
        ) : !isInstalled ? (
          <button
            onClick={() => installPlugin(meta.id)}
            className="flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors"
          >
            <Download size={13} />
            {t('pluginMarket.install')}
          </button>
        ) : showUninstall ? (
          /* 已安装 Tab：始终显示重新安装 + 卸载 */
          <div className="flex items-center gap-2">
            <button
              onClick={() => installPlugin(meta.id)}
              className="flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={13} />
              {t('pluginMarket.reinstall')}
            </button>
            <button
              onClick={() => uninstallPlugin(meta.id)}
              className="flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={13} />
              {t('pluginMarket.uninstall')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export default function PluginMarketPage() {
  const { t } = useI18n();
  const { pluginStates, installPlugin, uninstallPlugin } = usePlugins();
  const [activeTab, setActiveTab] = useState<'market' | 'installed'>('market');

  // 已安装列表
  const installedPlugins = useMemo(
    () => PLUGINS.filter(p => pluginStates[p.id]?.installed),
    [pluginStates],
  );

  const displayPlugins = activeTab === 'market' ? PLUGINS : installedPlugins;

  return (
    <main className="flex flex-1 flex-col overflow-hidden rounded-tl-xl rounded-bl-xl border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]">
      {/* 标题栏 */}
      <div data-tauri-drag-region className="flex h-[42px] shrink-0 items-center pl-4">
        <span data-tauri-drag-region className="text-sm font-medium text-[#333333] dark:text-gray-100 flex items-center gap-1.5">
          <Store size={15} className="text-[#646261] dark:text-gray-400" />
          {t('pluginMarket.title')}
        </span>
      </div>
      <div className="h-px bg-gray-200 dark:bg-gray-700" />

      {/* 滚动内容 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {/* 标题 + 副标题 */}
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
            {t('pluginMarket.heroTitle')}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            {t('pluginMarket.heroSubtitle')}
          </p>

          {/* Tab 切换 */}
          <div className="mt-6 flex gap-1 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab('market')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'market'
                  ? 'border-[#141414] text-[#141414] dark:border-gray-100 dark:text-gray-100'
                  : 'border-transparent text-[#646261] hover:text-[#141414] dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <Store size={14} />
              {t('pluginMarket.tabMarket')}
            </button>
            <button
              onClick={() => setActiveTab('installed')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'installed'
                  ? 'border-[#141414] text-[#141414] dark:border-gray-100 dark:text-gray-100'
                  : 'border-transparent text-[#646261] hover:text-[#141414] dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <CheckCircle2 size={14} />
              {t('pluginMarket.tabInstalled')}
              {installedPlugins.length > 0 && (
                <span className={`ml-1 rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] ${
                  activeTab === 'installed' ? 'text-[#141414] dark:text-gray-100' : 'text-[#646261] dark:text-gray-400'
                }`}>
                  {installedPlugins.length}
                </span>
              )}
            </button>
          </div>

          {/* 插件卡片网格 */}
          <div className="mt-6">
            {displayPlugins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <PackageOpen size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-xs text-gray-400 dark:text-gray-500">{t('pluginMarket.empty')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {displayPlugins.map(plugin => (
                  <PluginCard key={plugin.id} meta={plugin} showUninstall={activeTab === 'installed'} pluginStates={pluginStates} installPlugin={installPlugin} uninstallPlugin={uninstallPlugin} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
