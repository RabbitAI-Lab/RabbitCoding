/**
 * CustomAgentSection 组件
 *
 * 自定义智能体分区：添加 / 列表 / 删除管理，点击弹出编辑弹窗。
 */

import { useState } from 'react';
import { Plus, Trash2, ChevronRight, Bot } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';
import { useAgentConfigs } from '../../../hooks/useAgentConfigs';
import { SettingSection, Toggle } from '../settingsShared';
import CustomAgentEditor from './CustomAgentEditor';

interface CustomAgentSectionProps {
  scope: string;
}

export default function CustomAgentSection({ scope }: CustomAgentSectionProps) {
  const { t } = useI18n();
  const { getScopeConfig, addCustomAgent, updateCustomAgent, deleteCustomAgent } = useAgentConfigs();
  const config = getScopeConfig(scope);
  const [editingId, setEditingId] = useState<string | null>(null);

  /** 添加新智能体，自动弹出编辑 */
  const handleAdd = () => {
    const id = addCustomAgent(scope);
    setEditingId(id);
  };

  /** 删除智能体 */
  const handleDelete = (id: string) => {
    if (window.confirm(t('settings.agents.custom.confirmDelete'))) {
      deleteCustomAgent(scope, id);
      if (editingId === id) setEditingId(null);
    }
  };

  // 当前编辑的配置项
  const editingConfig = editingId
    ? config.customAgents.find((a) => a.id === editingId)
    : null;

  return (
    <SettingSection
      title={t('settings.agents.custom.title')}
      description={t('settings.agents.custom.description')}
    >
      {/* 右上角添加按钮 */}
      <div className="flex justify-end mb-2">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <Plus size={14} />
          {t('settings.agents.custom.add')}
        </button>
      </div>

      {/* 空状态 */}
      {config.customAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Bot size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t('settings.agents.custom.empty')}
          </p>
        </div>
      ) : (
        /* 列表 */
        <div className="flex flex-col">
          {config.customAgents.map((agent, index) => (
            <div key={agent.id}>
              {index > 0 && <div className="border-t border-gray-100 dark:border-gray-800" />}
              {/* 行头（点击弹出弹窗） */}
              <div className="flex items-center gap-2.5 py-2.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <button
                  onClick={() => setEditingId(agent.id)}
                  className="flex flex-1 items-center gap-2 text-left min-w-0"
                >
                  <Bot size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="text-xs font-medium text-[#333333] dark:text-gray-200 truncate">
                    {agent.name || t('settings.agents.custom.untitled')}
                  </span>
                  {agent.description && (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                      {agent.description}
                    </span>
                  )}
                </button>
                {/* Toggle */}
                <Toggle
                  checked={agent.enabled}
                  onChange={(v) => updateCustomAgent(scope, { ...agent, enabled: v })}
                />
                {/* 删除 */}
                <button
                  onClick={() => handleDelete(agent.id)}
                  className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
                {/* 弹窗箭头 */}
                <button
                  onClick={() => setEditingId(agent.id)}
                  className="shrink-0 p-1"
                >
                  <ChevronRight
                    size={14}
                    className="text-gray-300 dark:text-gray-600"
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editingConfig && (
        <CustomAgentEditor
          open={editingId !== null}
          config={editingConfig}
          onClose={() => setEditingId(null)}
          onSave={(updated) => {
            updateCustomAgent(scope, updated);
            setEditingId(null);
          }}
        />
      )}
    </SettingSection>
  );
}
