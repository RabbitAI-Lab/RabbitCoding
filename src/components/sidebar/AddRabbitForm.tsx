import { useRef, useCallback } from 'react';
import { useI18n } from '../../i18n/useI18n';

interface AddRabbitFormProps {
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export default function AddRabbitForm({ onSubmit, onCancel }: AddRabbitFormProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = e.currentTarget.value.trim();
      if (value) {
        onSubmit(value);
        e.currentTarget.value = '';
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }, [onSubmit, onCancel]);

  const handleBlur = useCallback(() => {
    const value = inputRef.current?.value.trim();
    if (value) {
      onSubmit(value);
    }
    onCancel();
  }, [onSubmit, onCancel]);

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-300 dark:border-gray-600" />
      <input
        ref={inputRef}
        autoFocus
        placeholder={t('sidebar.addRabbitForm.placeholder')}
        className="flex-1 bg-transparent px-1 py-0 text-xs text-gray-700 dark:text-gray-300 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  );
}
