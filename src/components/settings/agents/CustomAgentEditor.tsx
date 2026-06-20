/**
 * CustomAgentEditor 组件
 *
 * 自定义子智能体的编辑弹窗（Modal）。
 * 可配置：名称、描述、模型、工具（芯片多选）、系统提示词。
 * 内部维护草稿状态，确认后才回写。
 */

import { useEffect, useState } from 'react';
import Modal from '../../common/Modal';
import { useI18n } from '../../../i18n/useI18n';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { TOOL_OPTIONS } from './agentConstants';
import type { CustomAgentConfig, ModelConfig } from '../../../types';

interface CustomAgentEditorProps {
  open: boolean;
  config: CustomAgentConfig;
  onClose: () => void;
  onSave: (config: CustomAgentConfig) => void;
}

export default function CustomAgentEditor({ open, config, onClose, onSave }: CustomAgentEditorProps) {
  const { t } = useI18n();
  const [modelConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);

  // 草稿状态
  const [draft, setDraft] = useState<CustomAgentConfig>(config);

  // open 切换时同步草稿
  useEffect(() => {
    if (open) {
      setDraft(config);
    }
  }, [open, config]);

  const inputClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-3 py-2 text-xs text-[#333333] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 focus:border-[var(--brand-primary)] transition-colors';

  const labelClass = 'block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1';

  /** 切换工具选择 */
  const toggleTool = (tool: string) => {
    const selected = draft.tools.includes(tool);
    const tools = selected
      ? draft.tools.filter((t) => t !== tool)
      : [...draft.tools, tool];
    setDraft({ ...draft, tools });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.agents.custom.title')}
      widthClassName="w-[460px]"
    >
      <div className="flex flex-col gap-4">
        {/* 名称 */}
        <div>
          <label className={labelClass}>
            {t('settings.agents.field.name')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t('settings.agents.field.namePlaceholder')}
            className={inputClass}
            autoFocus
          />
        </div>

        {/* 描述 */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.description')}</label>
          <input
            type="text"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={t('settings.agents.field.descriptionPlaceholder')}
            className={inputClass}
          />
        </div>

        {/* 关联模型 */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.model')}</label>
          <select
            value={draft.modelId}
            onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
            className={inputClass}
          >
            <option value="">{t('settings.agents.field.defaultModel')}</option>
            {modelConfigs.filter((m) => m.enabled).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* 工具（芯片多选） */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.tools')}</label>
          <div className="flex flex-wrap gap-1.5">
            {TOOL_OPTIONS.map((tool) => {
              const selected = draft.tools.includes(tool);
              return (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  className={`px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                    selected
                      ? 'bg-[var(--brand-solid)] text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {tool}
                </button>
              );
            })}
          </div>
        </div>

        {/* 系统提示词 */}
        <div>
          <label className={labelClass}>{t('settings.agents.field.systemPrompt')}</label>
          <textarea
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value.slice(0, 10000) })}
            placeholder={t('settings.agents.field.systemPromptPlaceholder')}
            rows={4}
            maxLength={10000}
            className={`${inputClass} resize-none`}
          />
          <p className="mt-1 text-right text-[10px] text-gray-300 dark:text-gray-600">
            {draft.systemPrompt.length}/10000
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
            className="px-4 py-1.5 rounded-lg text-xs text-white bg-[var(--brand-solid)] hover:bg-[var(--brand-solid-hover)] transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
