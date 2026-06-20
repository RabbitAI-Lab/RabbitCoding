/**
 * VoicePanel - 语音模型管理面板
 *
 * 功能：
 * - 查看所有可用语音模型及下载状态
 * - 下载/切换模型
 * - 切换下载镜像源
 */

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Mic, Download, Loader2, Check, Globe, RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { SettingSection } from './settingsShared';

interface FileInfo {
  filename: string;
  approxSize: number;
}

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  languages: string;
  modelType: string;
  downloaded: boolean;
  files: FileInfo[];
}

interface MirrorInfo {
  id: string;
  name: string;
}

interface ModelListResult {
  models: ModelInfo[];
  mirrors: MirrorInfo[];
  activeModelId: string;
  mirrorId: string;
}

interface DownloadProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  downloaded: number;
  total: number;
  percent: number;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function VoicePanel() {
  const { t } = useI18n();
  const [data, setData] = useState<ModelListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);

  /** 刷新模型列表 */
  const refresh = useCallback(async () => {
    try {
      const result = await invoke<ModelListResult>('asr_list_models');
      setData(result);
    } catch (e) {
      console.error('[VoicePanel] Failed to list models:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 监听下载进度和状态事件
  useEffect(() => {
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenStatus: UnlistenFn | null = null;

    (async () => {
      unlistenProgress = await listen<DownloadProgress>(
        'asr://download_progress',
        (event) => {
          setDownloadProgress(event.payload);
        },
      );

      unlistenStatus = await listen<{ state: string; error?: string }>(
        'asr://status',
        (event) => {
          const { state, error: errMsg } = event.payload;
          if (state === 'ready') {
            setDownloading(false);
            setDownloadProgress(null);
            refresh();
          } else if (state === 'download_error') {
            setDownloading(false);
            setDownloadProgress(null);
            setError(errMsg || 'Download failed');
            refresh();
          }
        },
      );
    })();

    return () => {
      unlistenProgress?.();
      unlistenStatus?.();
    };
  }, [refresh]);

  /** 下载模型 */
  const handleDownload = useCallback(
    async (modelId: string) => {
      setError(null);
      setDownloading(true);
      setDownloadProgress(null);
      try {
        // 先切换到目标模型（确保下载的是用户选的模型）
        await invoke('asr_set_config', { activeModelId: modelId });
        await invoke('asr_ensure_model');
        // 进度和完成由事件监听处理
      } catch (e) {
        setDownloading(false);
        setDownloadProgress(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  /** 重新下载模型 */
  const handleRedownload = useCallback(
    async (modelId: string) => {
      setError(null);
      setDownloading(true);
      setDownloadProgress(null);
      try {
        await invoke('asr_redownload_model', { modelId });
      } catch (e) {
        setDownloading(false);
        setDownloadProgress(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  /** 切换激活模型 */
  const handleSetActive = useCallback(
    async (modelId: string) => {
      setSwitchingModel(modelId);
      setError(null);
      try {
        await invoke('asr_set_config', { activeModelId: modelId });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSwitchingModel(null);
      }
    },
    [refresh],
  );

  /** 切换镜像源 */
  const handleSetMirror = useCallback(
    async (mirrorId: string) => {
      setError(null);
      try {
        await invoke('asr_set_config', { mirrorId });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-10 text-center text-sm text-gray-400">
        {t('voice.loadFailed')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 模型管理 */}
      <SettingSection title={t('voice.modelManagement')} description={t('voice.modelManagementDesc')}>
        {error && (
          <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {data.models.map((model) => {
            const isActive = model.id === data.activeModelId;
            const totalSize = model.files.reduce((sum, f) => sum + f.approxSize, 0);

            return (
              <div
                key={model.id}
                className={`rounded-lg border p-3 transition-colors ${
                  isActive
                    ? 'border-[var(--brand-soft-border)] bg-[var(--brand-soft-bg)]'
                    : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                {/* 行1：图标 + 名称 + 状态徽标 */}
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800">
                    <Mic size={16} className="text-gray-600 dark:text-gray-300" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#333333] dark:text-gray-100">
                        {model.name}
                      </span>
                      {/* 激活徽标 */}
                      {isActive && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-[var(--brand-soft-bg)] text-[var(--brand-primary)]">
                          <Check size={10} />
                          {t('voice.active')}
                        </span>
                      )}
                      {/* 下载状态徽标 */}
                      {model.downloaded ? (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          {t('voice.downloaded')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-600" />
                          {t('voice.notDownloaded')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      {model.description}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                      {t('voice.languages')}: {model.languages} · ~{formatSize(totalSize)}
                    </p>
                  </div>
                </div>

                {/* 行2：操作按钮 */}
                <div className="mt-2 flex items-center justify-end gap-2 pl-[48px]">
                  {/* 下载进度条 */}
                  {downloading && isActive && downloadProgress && (
                    <div className="flex-1 mr-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {downloadProgress.fileName} ({downloadProgress.fileIndex}/{downloadProgress.totalFiles})
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {downloadProgress.percent.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-200"
                          style={{ width: `${downloadProgress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 下载中指示器 */}
                  {downloading && isActive && (
                    <Loader2 size={14} className="animate-spin text-blue-500" />
                  )}

                  {/* 下载按钮（未下载时显示） */}
                  {!model.downloaded && !downloading && (
                    <button
                      onClick={() => handleDownload(model.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-white bg-blue-500 hover:bg-blue-600 transition-colors"
                    >
                      <Download size={12} />
                      {t('voice.download')}
                    </button>
                  )}

                  {/* 设为当前按钮（已下载且非当前激活时显示） */}
                  {model.downloaded && !isActive && !switchingModel && (
                    <button
                      onClick={() => handleSetActive(model.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-[var(--brand-primary)] border border-[var(--brand-soft-border)] hover:bg-[var(--brand-soft-bg)] transition-colors"
                    >
                      {t('voice.setActive')}
                    </button>
                  )}

                  {/* 重新下载按钮（已下载且非下载中时显示） */}
                  {model.downloaded && !downloading && (
                    <button
                      onClick={() => handleRedownload(model.id)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <RefreshCw size={12} />
                      {t('voice.redownload')}
                    </button>
                  )}

                  {/* 切换中 */}
                  {switchingModel === model.id && (
                    <Loader2 size={14} className="animate-spin text-gray-400" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SettingSection>

      {/* 镜像源选择 */}
      <SettingSection title={t('voice.mirrorSource')} description={t('voice.mirrorSourceDesc')}>
        <div className="flex flex-col gap-2">
          {data.mirrors.map((mirror) => {
            const isActive = mirror.id === data.mirrorId;
            return (
              <label
                key={mirror.id}
                className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  isActive
                    ? 'border-[var(--brand-soft-border)] bg-[var(--brand-soft-bg)]'
                    : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="mirror"
                  checked={isActive}
                  onChange={() => handleSetMirror(mirror.id)}
                  className="h-3.5 w-3.5 accent-[var(--brand-primary)]"
                />
                <Globe size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
                <span className="text-xs text-[#333333] dark:text-gray-200">
                  {mirror.name}
                </span>
                {isActive && (
                  <Check size={12} className="ml-auto text-[var(--brand-primary)]" />
                )}
              </label>
            );
          })}
        </div>
      </SettingSection>
    </div>
  );
}
