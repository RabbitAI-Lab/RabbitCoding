/**
 * ModelsPanel 组件
 *
 * 模型管理列表面板：展示已配置的模型，支持新增/编辑/删除/启用切换。
 */

import { useState } from 'react';
import { Plus, Pencil, Trash2, Cpu } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { SettingSection, Toggle } from './settingsShared';
import ModelEditModal from './ModelEditModal';
import ModelTestInline from './ModelTestInline';
import type { ModelConfig } from '../../types';

export default function ModelsPanel() {
  const { t } = useI18n();
  const [configs, setConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ModelConfig | null>(null);

  /** 新增模型 */
  const handleAdd = () => {
    setEditingConfig(null);
    setModalOpen(true);
  };

  /** 编辑模型 */
  const handleEdit = (config: ModelConfig) => {
    setEditingConfig(config);
    setModalOpen(true);
  };

  /** 保存（新增或更新） */
  const handleSave = (config: ModelConfig) => {
    setConfigs(prev => {
      const exists = prev.some(c => c.id === config.id);
      return exists ? prev.map(c => (c.id === config.id ? config : c)) : [...prev, config];
    });
    setModalOpen(false);
  };

  /** 删除模型 */
  const handleDelete = (id: string) => {
    if (window.confirm(t('settings.models.confirmDelete'))) {
      setConfigs(prev => prev.filter(c => c.id !== id));
    }
  };

  /** 切换启用/禁用 */
  const handleToggle = (id: string, enabled: boolean) => {
    setConfigs(prev => prev.map(c => (c.id === id ? { ...c, enabled } : c)));
  };

  return (
    <div className="flex flex-col gap-4">
      <SettingSection title={t('settings.models.title')}>
        {/* 右上角添加按钮 + 描述 */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.models.description')}</p>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <Plus size={14} />
            {t('settings.models.addModel')}
          </button>
        </div>

        {/* 空状态 */}
        {configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Cpu size={32} className="text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.models.empty')}</p>
            <button
              onClick={handleAdd}
              className="mt-3 flex items-center gap-1 px-3 py-1.5 rounded-md text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <Plus size={14} />
              {t('settings.models.addModel')}
            </button>
          </div>
        ) : (
          /* 模型列表 */
          <div className="flex flex-col gap-1">
            {configs.map(config => (
              <div
                key={config.id}
                className="group rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                {/* 第一行：名称 + 操作按钮 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-medium text-[#333333] dark:text-gray-100 truncate">
                      {config.name}
                    </span>
                    {/* 厂商标签 */}
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      {t(`settings.models.provider.${config.provider}`)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {/* Toggle */}
                    <Toggle
                      checked={config.enabled}
                      onChange={(v) => handleToggle(config.id, v)}
                    />
                    {/* 测试连接 */}
                    <ModelTestInline config={config} />
                    {/* 编辑 */}
                    <button
                      onClick={() => handleEdit(config)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    {/* 删除 */}
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {/* 第二行：modelId + baseUrl */}
                <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
                  <span className="truncate">{config.modelId}</span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="truncate flex-1">{config.baseUrl}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingSection>

      {/* 编辑弹窗 */}
      <ModelEditModal
        open={modalOpen}
        config={editingConfig}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
