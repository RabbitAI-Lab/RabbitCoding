import { useRef, useState } from 'react';
import { ChevronDown, Check, Loader2, Cloud } from 'lucide-react';
import Popover from './Popover';
import { useI18n } from '../../i18n/useI18n';
import { isOnlineModelId } from '../../utils/portalClient';

export interface ModelOption {
  id: string;
  label: string;
}

interface ModelSelectorProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  /** 当没有可用模型时，点击触发跳转配置页 */
  onConfigure?: () => void;
  /** 线上（最新）模型列表 */
  onlineModels?: ModelOption[];
  /** 线上模型加载中 */
  onlineLoading?: boolean;
}

type Tab = 'latest' | 'custom';

export default function ModelSelector({
  value,
  options,
  onChange,
  onConfigure,
  onlineModels = [],
  onlineLoading = false,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('latest');
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 是否有任何可用模型（线上 + 自定义）
  const hasOnline = onlineModels.length > 0;
  const hasCustom = options.length > 0;
  const isEmpty = !hasOnline && !hasCustom;

  // 当前选中项的 label
  const customOption = options.find(o => o.id === value);
  const isOnlineSelected = isOnlineModelId(value);
  const onlineOption = isOnlineSelected ? onlineModels.find(o => o.id === value) : undefined;
  const currentLabel = isEmpty
    ? t('modelSelector.pleaseConfigure')
    : (customOption?.label ?? onlineOption?.label ?? t('modelSelector.selectModel'));

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  // 当前 tab 没有内容时自动切到另一个 tab
  const activeTabHasContent = tab === 'latest' ? hasOnline : hasCustom;
  const effectiveTab: Tab = activeTabHasContent ? tab : (hasOnline ? 'latest' : 'custom');

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          if (isEmpty) {
            onConfigure?.();
          } else {
            setOpen(prev => !prev);
          }
        }}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] leading-none rounded transition-colors ${
          isEmpty
            ? 'text-[#646261] hover:text-[#141414] dark:text-gray-400 dark:hover:text-gray-200'
            : 'text-[#666666] hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
        }`}
      >
        {isOnlineSelected && <Cloud size={10} className="shrink-0 text-[var(--brand-primary)]" />}
        <span className="truncate max-w-[140px]">{currentLabel}</span>
        {!isEmpty && <ChevronDown size={11} />}
      </button>
      {!isEmpty && (
        <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 px-1 pt-0.5">
            <button
              onClick={() => setTab('latest')}
              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors border-b-2 ${
                effectiveTab === 'latest'
                  ? 'text-[var(--brand-primary)] border-[var(--brand-primary)]'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('modelSelector.latestModels')}
            </button>
            <button
              onClick={() => setTab('custom')}
              className={`flex-1 px-2 py-1 text-[11px] font-medium transition-colors border-b-2 ${
                effectiveTab === 'custom'
                  ? 'text-[var(--brand-primary)] border-[var(--brand-primary)]'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('modelSelector.customModels')}
            </button>
          </div>

          {/* Tab 内容 */}
          <div className="min-w-[200px] max-h-[260px] overflow-y-auto py-0.5">
            {effectiveTab === 'latest' ? (
              onlineLoading ? (
                <div className="flex items-center justify-center gap-1.5 px-2.5 py-3 text-[11px] text-gray-400 dark:text-gray-500">
                  <Loader2 size={12} className="animate-spin" />
                  {t('modelSelector.loadingModels')}
                </div>
              ) : hasOnline ? (
                onlineModels.map(option => (
                  <div
                    key={option.id}
                    onClick={() => handleSelect(option.id)}
                    className={`flex items-center justify-between px-2.5 py-1 text-[11px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                      option.id === value
                        ? 'text-[var(--brand-primary)] font-medium'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <Cloud size={9} className="shrink-0 opacity-60" />
                      <span className="truncate">{option.label}</span>
                    </span>
                    {option.id === value && <Check size={11} className="shrink-0" />}
                  </div>
                ))
              ) : (
                <div className="px-2.5 py-3 text-[11px] text-gray-400 dark:text-gray-500 text-center">
                  {t('modelSelector.noOnlineModels')}
                </div>
              )
            ) : (
              hasCustom ? (
                options.map(option => (
                  <div
                    key={option.id}
                    onClick={() => handleSelect(option.id)}
                    className={`flex items-center justify-between px-2.5 py-1 text-[11px] cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                      option.id === value
                        ? 'text-blue-600 dark:text-blue-400 font-medium'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span>{option.label}</span>
                    {option.id === value && <Check size={11} />}
                  </div>
                ))
              ) : (
                <div className="px-2.5 py-3 text-[11px] text-gray-400 dark:text-gray-500 text-center">
                  {t('modelSelector.pleaseConfigure')}
                </div>
              )
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
