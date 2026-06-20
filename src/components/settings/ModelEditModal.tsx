/**
 * ModelEditModal 组件
 *
 * 模型配置编辑弹窗：新增 / 编辑。
 * 选择厂商时自动填充预设的 baseUrl / modelId / apiKeyEnvVar。
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, AlertCircle, Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';
import Modal from '../common/Modal';
import { useI18n } from '../../i18n/useI18n';
import { useModelTest } from '../../hooks/useModelTest';
import { generateId } from '../../utils/id';
import { PROVIDER_PRESETS, getPreset } from '../../constants/providers';
import type { ModelConfig, ModelProvider } from '../../types';

interface ModelEditModalProps {
  open: boolean;
  config: ModelConfig | null; // null = 新增模式
  onClose: () => void;
  onSave: (config: ModelConfig) => void;
}

interface FormState {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  apiKeyEnvVar: string;
  envVars: { key: string; value: string }[];
  enabled: boolean;
  createdAt: number;
}

/** 从 ModelConfig 创建表单状态 */
function configToForm(config: ModelConfig | null): FormState {
  if (config) {
    return {
      id: config.id,
      name: config.name,
      provider: config.provider,
      modelId: config.modelId,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiKeyEnvVar: config.apiKeyEnvVar,
      envVars: Object.entries(config.envVars).map(([key, value]) => ({ key, value })),
      enabled: config.enabled,
      createdAt: config.createdAt,
    };
  }
  // 新增模式：默认 GLM 预设
  const preset = getPreset('glm');
  return {
    id: '',
    name: 'GLM',
    provider: 'glm',
    modelId: preset.defaultModelId,
    baseUrl: preset.baseUrl,
    apiKey: '',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    envVars: [],
    enabled: true,
    createdAt: 0,
  };
}

export default function ModelEditModal({ open, config, onClose, onSave }: ModelEditModalProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => configToForm(config));
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState('');
  const { state: testState, runTest, reset: resetTest } = useModelTest();

  // open 切换时重新初始化表单
  useEffect(() => {
    if (open) {
      setForm(configToForm(config));
      setShowApiKey(false);
      setError('');
      resetTest();
    }
  }, [open, config, resetTest]);

  /** 厂商切换：自动填充预设 */
  const handleProviderChange = (provider: ModelProvider) => {
    const preset = getPreset(provider);
    setForm(prev => ({
      ...prev,
      provider,
      name: provider === 'custom' ? '' : provider,
      baseUrl: preset.baseUrl,
      modelId: preset.defaultModelId,
    }));
  };

  /** 更新表单字段 */
  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  /** 环境变量操作 */
  const addEnvVar = () => {
    setForm(prev => ({ ...prev, envVars: [...prev.envVars, { key: '', value: '' }] }));
  };
  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    setForm(prev => ({
      ...prev,
      envVars: prev.envVars.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };
  const removeEnvVar = (index: number) => {
    setForm(prev => ({
      ...prev,
      envVars: prev.envVars.filter((_, i) => i !== index),
    }));
  };

  /** 校验 */
  const validate = (): string | null => {
    if (!form.name.trim()) return t('settings.models.error.nameRequired');
    if (!form.modelId.trim()) return t('settings.models.error.modelIdRequired');
    if (!form.baseUrl.trim()) return t('settings.models.error.baseUrlRequired');
    if (!form.apiKey.trim()) return t('settings.models.error.apiKeyRequired');

    return null;
  };

  /** 保存 */
  const handleSave = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    // 过滤掉空 key 的环境变量
    const envVarsMap: Record<string, string> = {};
    for (const item of form.envVars) {
      const key = item.key.trim();
      if (key) {
        envVarsMap[key] = item.value;
      }
    }

    const result: ModelConfig = {
      id: form.id || generateId(),
      name: form.name.trim(),
      provider: form.provider,
      modelId: form.modelId.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      envVars: envVarsMap,
      enabled: form.enabled,
      createdAt: form.createdAt || Date.now(),
    };
    onSave(result);
  };

  /** 测试连接：用当前草稿参数发起测试（无需先保存） */
  const handleTest = () => {
    runTest({
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      modelId: form.modelId,
    });
  };

  /** 输入框样式 */
  const inputClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-3 py-2 text-sm text-[#141414] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 focus:border-[var(--brand-primary)] transition-colors';

  /** 标签样式 */
  const labelClass = 'block text-xs font-medium text-[#333333] dark:text-gray-200 mb-1';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config ? t('settings.models.editModel') : t('settings.models.addModel')}
      widthClassName="w-[520px]"
    >
      <div className="flex flex-col gap-4">
        {/* 厂商选择器 */}
        <div>
          <label className={labelClass}>{t('settings.models.field.provider')}</label>
          <div className="flex flex-wrap gap-1.5">
            {PROVIDER_PRESETS.map(preset => (
              <button
                key={preset.provider}
                onClick={() => handleProviderChange(preset.provider)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  form.provider === preset.provider
                    ? 'bg-[var(--brand-solid)] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {t(preset.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 名称 */}
        <div>
          <label className={labelClass}>
            {t('settings.models.field.name')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={e => updateField('name', e.target.value)}
            placeholder={t('settings.models.field.namePlaceholder')}
            className={inputClass}
            autoFocus
          />
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {t('settings.models.field.nameDesc')}
          </p>
        </div>

        {/* 模型 ID */}
        <div>
          <label className={labelClass}>
            {t('settings.models.field.modelId')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.modelId}
            onChange={e => updateField('modelId', e.target.value)}
            placeholder={t('settings.models.field.modelIdPlaceholder')}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {t('settings.models.field.modelIdDesc')}
          </p>
        </div>

        {/* Base URL */}
        <div>
          <label className={labelClass}>
            {t('settings.models.field.baseUrl')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.baseUrl}
            onChange={e => updateField('baseUrl', e.target.value)}
            placeholder={t('settings.models.field.baseUrlPlaceholder')}
            className={inputClass}
          />
        </div>

        {/* API Key */}
        <div>
          <label className={labelClass}>
            {t('settings.models.field.apiKey')} <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={e => updateField('apiKey', e.target.value)}
              placeholder={t('settings.models.field.apiKeyPlaceholder')}
              className={`${inputClass} pr-10`}
            />
            <button
              onClick={() => setShowApiKey(prev => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* 额外环境变量 */}
        <div>
          <label className={labelClass}>{t('settings.models.field.envVars')}</label>
          <div className="flex flex-col gap-2">
            {form.envVars.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.key}
                  onChange={e => updateEnvVar(index, 'key', e.target.value)}
                  placeholder={t('settings.models.field.envVarKeyPlaceholder')}
                  className={`${inputClass} flex-1`}
                />
                <input
                  type="text"
                  value={item.value}
                  onChange={e => updateEnvVar(index, 'value', e.target.value)}
                  placeholder={t('settings.models.field.envVarValuePlaceholder')}
                  className={`${inputClass} flex-1`}
                />
                <button
                  onClick={() => removeEnvVar(index)}
                  className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={addEnvVar}
              className="flex items-center gap-1 text-xs text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)] transition-colors"
            >
              <Plus size={14} />
              {t('settings.models.field.addEnvVar')}
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* 测试连接结果 */}
        {testState.status === 'success' && testState.result && (
          <div className="flex items-start gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{t('settings.models.testSuccess')}</span>
              <span className="text-[11px] text-green-600/80 dark:text-green-400/80">
                {t('settings.models.testLatency')}: {testState.result.latencyMs ?? '-'} ms
                {testState.result.modelEcho
                  ? ` · ${t('settings.models.testModelEcho')}: ${testState.result.modelEcho}`
                  : ''}
              </span>
            </div>
          </div>
        )}
        {testState.status === 'error' && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            <XCircle size={14} className="mt-0.5 shrink-0" />
            <div className="flex flex-col">
              <span className="font-medium">{t('settings.models.testFailed')}</span>
              {testState.error && (
                <span className="mt-0.5 whitespace-pre-wrap break-all text-[11px] text-red-500/90 dark:text-red-400/90">
                  {testState.error}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={handleTest}
            disabled={testState.status === 'loading'}
            className="mr-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--brand-primary)] border border-[var(--brand-soft-border)] hover:bg-[var(--brand-soft-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testState.status === 'loading' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Zap size={13} />
            )}
            {testState.status === 'loading'
              ? t('settings.models.testing')
              : t('settings.models.testConnection')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg text-xs text-white bg-[var(--brand-solid)] hover:bg-[var(--brand-solid-hover)] transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
