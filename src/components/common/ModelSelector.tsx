import { useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import Popover from './Popover';
import { useI18n } from '../../i18n/useI18n';

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
}

export default function ModelSelector({ value, options, onChange, onConfigure }: ModelSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isEmpty = options.length === 0;
  const current = options.find(o => o.id === value);
  const currentLabel = isEmpty
    ? t('modelSelector.pleaseConfigure')
    : (current?.label ?? t('modelSelector.selectModel'));

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

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
        {currentLabel}
        {!isEmpty && <ChevronDown size={11} />}
      </button>
      {!isEmpty && (
        <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
          {options.map(option => (
            <div
              key={option.id}
              onClick={() => handleSelect(option.id)}
              className={`flex items-center justify-between px-2.5 py-1 text-[11px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                option.id === value ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              <span>{option.label}</span>
              {option.id === value && <Check size={11} />}
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}
