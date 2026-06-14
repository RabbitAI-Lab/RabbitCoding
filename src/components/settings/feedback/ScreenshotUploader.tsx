import { Loader2, X, Plus, Camera } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';

interface ScreenshotUploaderProps {
  /** data URL 数组 */
  screenshots: string[];
  /** 第一张是否自动截取（显示标记） */
  hasAutoCaptured: boolean;
  /** 截图中 loading */
  capturing: boolean;
  /** 最大数量 */
  maxCount: number;
  /** 重新截取（替换第一张） */
  onCapture: () => void;
  /** 删除指定索引 */
  onRemove: (index: number) => void;
  /** 添加截图（追加到末尾） */
  onAdd: () => void;
}

export default function ScreenshotUploader({
  screenshots,
  hasAutoCaptured,
  capturing,
  maxCount,
  onCapture,
  onRemove,
  onAdd,
}: ScreenshotUploaderProps) {
  const { t } = useI18n();
  const canAddMore = screenshots.length < maxCount;

  return (
    <div>
      {/* 缩略图网格 */}
      <div className="grid grid-cols-3 gap-3">
        {screenshots.map((img, i) => (
          <div
            key={i}
            className="group relative aspect-video overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
          >
            <img src={img} alt={`screenshot-${i + 1}`} className="h-full w-full object-cover" />
            {/* 自动截取标记 */}
            {hasAutoCaptured && i === 0 && (
              <span className="absolute left-1 top-1 rounded bg-blue-600/80 px-1 py-0.5 text-[9px] font-medium text-white">
                {t('settings.feedback.screenshots.autoCaptured')}
              </span>
            )}
            {/* 删除按钮（hover 显示） */}
            <button
              onClick={() => onRemove(i)}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* 添加按钮（未满时显示） */}
        {canAddMore && (
          <button
            onClick={onAdd}
            disabled={capturing}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:text-gray-500 dark:hover:border-blue-400 dark:hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {capturing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Plus size={18} />
            )}
          </button>
        )}
      </div>

      {/* 操作栏 */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onCapture}
          disabled={capturing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {capturing ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          {capturing
            ? t('settings.feedback.screenshots.capturing')
            : t('settings.feedback.screenshots.recapture')}
        </button>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {screenshots.length}/{maxCount}
        </span>
      </div>
    </div>
  );
}
