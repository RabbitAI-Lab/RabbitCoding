/**
 * VoiceInputButton - 语音输入按钮组件
 *
 * 集成到 Sender footer 工具栏，点击开始/停止语音识别。
 * 识别结果通过 onText 回调填入输入框。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Loader2, Download } from 'lucide-react';
import Tooltip from './Tooltip';
import Modal from './Modal';
import { useVoiceInput, type DownloadProgress } from '../../hooks/useVoiceInput';
import { useI18n } from '../../i18n/useI18n';
import { isWindowsArm64 } from '../../utils/platform';

interface VoiceInputButtonProps {
  /** 收到识别文本时回填输入框（text 为包含已有内容的完整文本） */
  onText: (text: string, isFinal: boolean) => void;
  /** 当前输入框已有文本，语音开始时作为初始前缀 */
  currentText: string;
}

export default function VoiceInputButton({ onText, currentText }: VoiceInputButtonProps) {
  // Windows ARM64 不支持 sherpa-onnx，隐藏语音按钮（在所有 hooks 之前 return）
  if (isWindowsArm64) return null;

  const { t } = useI18n();
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const prefixRef = useRef('');

  const handleText = useCallback(
    (text: string, isFinal: boolean) => {
      if (isFinal) {
        // 整句确认：追加到 prefix
        prefixRef.current = prefixRef.current + text;
        onText(prefixRef.current, true);
      } else {
        // partial：替换当前句
        onText(prefixRef.current + text, false);
      }
    },
    [onText],
  );

  const handleDownloadProgress = useCallback((progress: DownloadProgress) => {
    setDownloadProgress(progress);
  }, []);

  const { status, error, modelState, start, stop, ensureModel } = useVoiceInput({
    onText: handleText,
    onDownloadProgress: handleDownloadProgress,
  });

  const isListening = status === 'listening';
  const isRequesting = status === 'requesting';

  // 检查模型状态，首次点击时可能需要下载
  const handleClick = useCallback(async () => {
    if (isListening) {
      stop();
      return;
    }

    // 以当前输入框内容作为前缀，语音识别结果追加其后
    prefixRef.current = currentText || '';

    // 如果模型未下载，弹出下载确认
    if (modelState === 'not_downloaded') {
      setShowDownloadModal(true);
      return;
    }

    try {
      await start();
    } catch (e) {
      console.error('[VoiceInputButton] Failed to start:', e);
    }
  }, [isListening, modelState, start, stop, currentText]);

  // 处理下载确认
  const handleConfirmDownload = useCallback(async () => {
    setDownloadError(null);
    // 立即设置一个初始进度状态，让按钮马上进入 loading 态
    setDownloadProgress({
      fileName: '',
      fileIndex: 0,
      totalFiles: 0,
      downloaded: 0,
      total: 0,
      percent: 0,
    });
    try {
      console.log('[VoiceInputButton] Starting model download...');
      await ensureModel();
      console.log('[VoiceInputButton] asr_ensure_model invoked, waiting for progress events...');
      // 弹窗由 modelState === 'ready' 的 useEffect 自动关闭
    } catch (e) {
      console.error('[VoiceInputButton] Download failed:', e);
      setDownloadError(e instanceof Error ? e.message : String(e));
      setDownloadProgress(null);
    }
  }, [ensureModel]);

  // 监听 modelState 变化，下载完成后自动关闭弹窗
  useEffect(() => {
    if (modelState === 'ready' && showDownloadModal) {
      setShowDownloadModal(false);
      setDownloadProgress(null);
    }
  }, [modelState, showDownloadModal]);

  const tooltipContent = error
    ? error
    : isListening
      ? t('contentArea.voiceInputStop')
      : isRequesting
        ? t('contentArea.voiceInputListening')
        : modelState === 'not_downloaded'
          ? t('contentArea.voiceInputDownloadModel')
          : t('contentArea.voiceInputStart');

  return (
    <>
      <Tooltip content={tooltipContent}>
        <button
          type="button"
          onClick={handleClick}
          disabled={isRequesting}
          className={`flex items-center justify-center transition-colors ${
            isListening
              ? 'text-red-500'
              : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          {isRequesting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isListening ? (
            <Mic size={14} className="animate-pulse" />
          ) : (
            <Mic size={14} />
          )}
        </button>
      </Tooltip>

      {/* 模型下载确认弹窗 */}
      <Modal
        open={showDownloadModal}
        onClose={() => !downloadProgress && setShowDownloadModal(false)}
      >
          <div className="p-6">
            <h2 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">
              {t('contentArea.voiceInputDownloadModel')}
            </h2>

            {downloadError && (
              <p className="text-sm text-red-500 mb-3">{downloadError}</p>
            )}

            {downloadProgress && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {downloadProgress.fileName || '...'}{' '}
                    {downloadProgress.totalFiles > 0 && `(${downloadProgress.fileIndex}/${downloadProgress.totalFiles})`}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {downloadProgress.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-200"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowDownloadModal(false)}
                disabled={!!downloadProgress}
                className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-40"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmDownload}
                disabled={!!downloadProgress}
                className="px-4 py-1.5 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {downloadProgress ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    {t('contentArea.voiceInputDownloading')}
                  </>
                ) : (
                  <>
                    <Download size={12} />
                    {t('common.save')}
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
    </>
  );
}
