/**
 * BuiltinAgentEditor 组件
 *
 * 内置专家团子智能体的编辑弹窗（Modal）。
 * 可配置：关联模型、技能（标签输入）、MCP（标签输入）、追加提示词。
 * 内部维护草稿状态，确认后才回写。
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Modal from '../../common/Modal';
import { useI18n } from '../../../i18n/useI18n';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import type { BuiltinAgentConfig, ModelConfig } from '../../../types';

interface BuiltinAgentEditorProps {
  open: boolean;
  title: string;
  description?: string;
  config: BuiltinAgentConfig;
  onClose: () => void;
  onSave: (config: BuiltinAgentConfig) => void;
}

/** 标签输入子组件（内联实现） */
function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
      }
      setInput('');
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-2 py-1.5 min-h-[34px]">
      {value.map((tag, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 text-[11px] text-blue-600 dark:text-blue-400"
        >
          {tag}
          <button
            onClick={() => handleRemove(i)}
            className="hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent text-xs text-[#333333] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none"
      />
    </div>
  );
}

export default function BuiltinAgentEditor({
  open,
  title,
  description,
  config,
  onClose,
  onSave,
}: BuiltinAgentEditorProps) {
  const { t } = useI18n();
  const [modelConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);
  const enabledModels = modelConfigs.filter((m) => m.enabled);

  // 草稿状态
  const [draft, setDraft] = useState<BuiltinAgentConfig>(config);

  // open 切换时同步草稿
  useEffect(() => {
    if (open) {
      setDraft(config);
    }
  }, [open, config]);

  const inputClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-3 py-2 text-xs text-[#333333] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors';

  const labelClass = 'block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1';

  return (
    <Modal open={open} onClose={onClose} title={title} widthClassName="w-[460px]">
      {/* 子智能体描述 */}
      {description && (
        <p className="mb-4 text-[11px] text-gray-400 dark:text-gray-500">{description}</p>
      )}

      <div className="flex flex-col gap-4">
        {/* 关联模型 */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.model')}</label>
          <select
            value={draft.modelId}
            onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
            className={inputClass}
          >
            <option value="">{t('settings.agents.field.defaultModel')}</option>
            {enabledModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* 技能 */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.skills')}</label>
          <TagInput
            value={draft.skills}
            onChange={(skills) => setDraft({ ...draft, skills })}
            placeholder={t('settings.agents.field.skillsPlaceholder')}
          />
        </div>

        {/* MCP */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.mcp')}</label>
          <TagInput
            value={draft.mcp}
            onChange={(mcp) => setDraft({ ...draft, mcp })}
            placeholder={t('settings.agents.field.mcpPlaceholder')}
          />
        </div>

        {/* 追加提示词 */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.additionalPrompt')}</label>
          <textarea
            value={draft.additionalPrompt}
            onChange={(e) => setDraft({ ...draft, additionalPrompt: e.target.value.slice(0, 10000) })}
            placeholder={t('settings.agents.field.additionalPromptPlaceholder')}
            rows={4}
            maxLength={10000}
            className={`${inputClass} resize-none`}
          />
          <p className="mt-1 text-right text-[10px] text-gray-300 dark:text-gray-600">
            {draft.additionalPrompt.length}/10000
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onSave(draft)}
            className="px-4 py-1.5 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
