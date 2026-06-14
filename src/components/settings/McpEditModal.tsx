/**
 * McpEditModal 组件
 *
 * MCP 服务配置编辑弹窗：新增 / 编辑。
 * 支持三种传输类型（stdio / http / sse），根据类型动态显示不同表单字段。
 * 支持两种输入模式：表单填写 / JSON 导入。
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import Modal from '../common/Modal';
import { useI18n } from '../../i18n/useI18n';
import { generateId } from '../../utils/id';
import type { McpServerConfig, McpServerType } from '../../types';

interface McpEditModalProps {
  open: boolean;
  config: McpServerConfig | null; // null = 新增模式
  onClose: () => void;
  onSave: (config: McpServerConfig) => void;
}

type EditMode = 'form' | 'json';

interface FormState {
  id: string;
  name: string;
  type: McpServerType;
  // stdio 字段
  command: string;
  argsText: string;
  envVars: { key: string; value: string }[];
  // http / sse 字段
  url: string;
  headers: { key: string; value: string }[];
  // 通用
  enabled: boolean;
  createdAt: number;
}

/** MCP 类型列表 */
const MCP_TYPES: McpServerType[] = ['stdio', 'http', 'sse'];

/** 从 McpServerConfig 创建表单状态 */
function configToForm(config: McpServerConfig | null): FormState {
  if (config) {
    return {
      id: config.id,
      name: config.name,
      type: config.type,
      command: config.command ?? '',
      argsText: (config.args ?? []).join('\n'),
      envVars: Object.entries(config.env ?? {}).map(([key, value]) => ({ key, value })),
      url: config.url ?? '',
      headers: Object.entries(config.headers ?? {}).map(([key, value]) => ({ key, value })),
      enabled: config.enabled,
      createdAt: config.createdAt,
    };
  }
  // 新增模式：默认 stdio
  return {
    id: '',
    name: '',
    type: 'stdio',
    command: '',
    argsText: '',
    envVars: [],
    url: '',
    headers: [],
    enabled: true,
    createdAt: 0,
  };
}

export default function McpEditModal({ open, config, onClose, onSave }: McpEditModalProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => configToForm(config));
  const [error, setError] = useState('');
  const [mode, setMode] = useState<EditMode>('form');
  const [jsonText, setJsonText] = useState('');

  // open 切换时重新初始化表单
  useEffect(() => {
    if (open) {
      setForm(configToForm(config));
      setError('');
      setMode('form');
      setJsonText('');
    }
  }, [open, config]);

  /** 更新表单字段 */
  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  // ---- 环境变量操作 ----
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
    setForm(prev => ({ ...prev, envVars: prev.envVars.filter((_, i) => i !== index) }));
  };

  // ---- Headers 操作 ----
  const addHeader = () => {
    setForm(prev => ({ ...prev, headers: [...prev.headers, { key: '', value: '' }] }));
  };
  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    setForm(prev => ({
      ...prev,
      headers: prev.headers.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };
  const removeHeader = (index: number) => {
    setForm(prev => ({ ...prev, headers: prev.headers.filter((_, i) => i !== index) }));
  };

  /**
   * 解析 JSON 文本并填充表单
   *
   * 支持以下格式：
   * 1. 标准 mcpServers 包裹格式: { "mcpServers": { "name": { ... } } }
   * 2. 直接服务名映射格式: { "name": { "command": ... } }
   * 3. 单个服务配置: { "command": ... } / { "url": ... }
   */
  const handleJsonImport = () => {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;

      let serverName = '';
      let serverConfig: Record<string, unknown> | null = null;

      // 格式1: { mcpServers: { name: { ... } } }
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        const entries = Object.entries(parsed.mcpServers as Record<string, unknown>);
        if (entries.length === 0) {
          setError(t('settings.mcp.error.jsonNoServer'));
          return;
        }
        serverName = entries[0][0];
        serverConfig = entries[0][1] as Record<string, unknown>;
      } else {
        // 遍历顶层 key，找到第一个值是对象的条目
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const val = value as Record<string, unknown>;
            // 判断是服务名映射还是直接的服务配置
            if (val.command || val.url || val.type) {
              // 格式2: { name: { command/url... } }
              serverName = key;
              serverConfig = val;
              break;
            }
          }
        }
        // 格式3: 直接的服务配置 { command: ..., args: [...] }
        if (!serverConfig && (parsed.command || parsed.url)) {
          serverConfig = parsed;
        }
      }

      if (!serverConfig || typeof serverConfig !== 'object') {
        setError(t('settings.mcp.error.jsonNoServer'));
        return;
      }

      // 判断类型
      let detectedType: McpServerType = 'stdio';
      if (typeof serverConfig.type === 'string') {
        detectedType = (['stdio', 'http', 'sse'].includes(serverConfig.type) ? serverConfig.type : 'stdio') as McpServerType;
      } else if (serverConfig.url) {
        detectedType = 'http';
      }

      // 构建新的表单状态
      const newForm: FormState = {
        id: form.id,
        name: serverName || form.name,
        type: detectedType,
        command: typeof serverConfig.command === 'string' ? serverConfig.command : '',
        argsText: Array.isArray(serverConfig.args)
          ? serverConfig.args.map((a: unknown) => String(a)).join('\n')
          : '',
        envVars: serverConfig.env && typeof serverConfig.env === 'object'
          ? Object.entries(serverConfig.env).map(([key, value]) => ({ key, value: String(value ?? '') }))
          : [],
        url: typeof serverConfig.url === 'string' ? serverConfig.url : '',
        headers: serverConfig.headers && typeof serverConfig.headers === 'object'
          ? Object.entries(serverConfig.headers).map(([key, value]) => ({ key, value: String(value ?? '') }))
          : [],
        enabled: form.enabled,
        createdAt: form.createdAt,
      };

      setForm(newForm);
      setMode('form');
      setError('');
    } catch {
      setError(t('settings.mcp.error.jsonInvalid'));
    }
  };

  /** 校验 */
  const validate = (): string | null => {
    if (!form.name.trim()) return t('settings.mcp.error.nameRequired');
    if (form.type === 'stdio') {
      if (!form.command.trim()) return t('settings.mcp.error.commandRequired');
    } else {
      if (!form.url.trim()) return t('settings.mcp.error.urlRequired');
    }
    return null;
  };

  /** 保存 */
  const handleSave = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }

    // stdio: 按换行拆分 args，过滤空行
    const args = form.argsText
      .split('\n')
      .map(a => a.trim())
      .filter(Boolean);

    // env: 过滤空 key，组装 Record
    const envMap: Record<string, string> = {};
    for (const item of form.envVars) {
      const key = item.key.trim();
      if (key) envMap[key] = item.value;
    }

    // headers: 过滤空 key，组装 Record
    const headersMap: Record<string, string> = {};
    for (const item of form.headers) {
      const key = item.key.trim();
      if (key) headersMap[key] = item.value;
    }

    const result: McpServerConfig = {
      id: form.id || generateId(),
      name: form.name.trim(),
      type: form.type,
      enabled: form.enabled,
      createdAt: form.createdAt || Date.now(),
      ...(form.type === 'stdio'
        ? {
            command: form.command.trim(),
            args,
            env: envMap,
          }
        : {
            url: form.url.trim(),
            headers: headersMap,
          }),
    };
    onSave(result);
  };

  /** 输入框样式 */
  const inputClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-3 py-2 text-sm text-[#141414] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors';

  /** 标签样式 */
  const labelClass = 'block text-xs font-medium text-[#333333] dark:text-gray-200 mb-1';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config ? t('settings.mcp.editServer') : t('settings.mcp.addServer')}
      widthClassName="w-[520px]"
    >
      <div className="flex flex-col gap-4">
        {/* 模式切换 Tab */}
        <div className="flex gap-1 border-b border-gray-100 dark:border-gray-800 -mt-1">
          <button
            onClick={() => { setMode('form'); setError(''); }}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              mode === 'form'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            {t('settings.mcp.json.modeForm')}
          </button>
          <button
            onClick={() => { setMode('json'); setError(''); }}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              mode === 'json'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
          >
            {t('settings.mcp.json.modeJson')}
          </button>
        </div>

        {/* JSON 导入模式 */}
        {mode === 'json' && (
          <>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {t('settings.mcp.json.desc')}
            </p>
            <textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder={t('settings.mcp.json.placeholder')}
              rows={12}
              autoFocus
              className={`${inputClass} resize-none font-mono text-xs`}
            />

            {/* 错误提示 */}
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleJsonImport}
                disabled={!jsonText.trim()}
                className="px-4 py-1.5 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('settings.mcp.json.import')}
              </button>
            </div>
          </>
        )}

        {/* 表单填写模式 */}
        {mode === 'form' && (
          <>
        {/* 类型选择器 */}
        <div>
          <label className={labelClass}>{t('settings.mcp.field.type')}</label>
          <div className="flex flex-wrap gap-1.5">
            {MCP_TYPES.map(type => (
              <button
                key={type}
                onClick={() => updateField('type', type)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  form.type === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {t(`settings.mcp.type.${type}`)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {t('settings.mcp.field.typeDesc')}
          </p>
        </div>

        {/* 名称 */}
        <div>
          <label className={labelClass}>
            {t('settings.mcp.field.name')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={e => updateField('name', e.target.value)}
            placeholder={t('settings.mcp.field.namePlaceholder')}
            className={inputClass}
            autoFocus
          />
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {t('settings.mcp.field.nameDesc')}
          </p>
        </div>

        {/* stdio 类型字段 */}
        {form.type === 'stdio' && (
          <>
            {/* Command */}
            <div>
              <label className={labelClass}>
                {t('settings.mcp.field.command')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.command}
                onChange={e => updateField('command', e.target.value)}
                placeholder={t('settings.mcp.field.commandPlaceholder')}
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {t('settings.mcp.field.commandDesc')}
              </p>
            </div>

            {/* Arguments */}
            <div>
              <label className={labelClass}>{t('settings.mcp.field.args')}</label>
              <textarea
                value={form.argsText}
                onChange={e => updateField('argsText', e.target.value)}
                placeholder={t('settings.mcp.field.argsPlaceholder')}
                rows={3}
                className={`${inputClass} resize-none font-mono`}
              />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {t('settings.mcp.field.argsDesc')}
              </p>
            </div>

            {/* 环境变量 */}
            <div>
              <label className={labelClass}>{t('settings.mcp.field.envVars')}</label>
              <div className="flex flex-col gap-2">
                {form.envVars.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.key}
                      onChange={e => updateEnvVar(index, 'key', e.target.value)}
                      placeholder={t('settings.mcp.field.envVarKeyPlaceholder')}
                      className={`${inputClass} flex-1 font-mono`}
                    />
                    <input
                      type="text"
                      value={item.value}
                      onChange={e => updateEnvVar(index, 'value', e.target.value)}
                      placeholder={t('settings.mcp.field.envVarValuePlaceholder')}
                      className={`${inputClass} flex-1 font-mono`}
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
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  <Plus size={14} />
                  {t('settings.mcp.field.addEnvVar')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* http / sse 类型字段 */}
        {form.type !== 'stdio' && (
          <>
            {/* URL */}
            <div>
              <label className={labelClass}>
                {t('settings.mcp.field.url')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.url}
                onChange={e => updateField('url', e.target.value)}
                placeholder={t('settings.mcp.field.urlPlaceholder')}
                className={`${inputClass} font-mono`}
              />
            </div>

            {/* Headers */}
            <div>
              <label className={labelClass}>{t('settings.mcp.field.headers')}</label>
              <div className="flex flex-col gap-2">
                {form.headers.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.key}
                      onChange={e => updateHeader(index, 'key', e.target.value)}
                      placeholder={t('settings.mcp.field.headerKeyPlaceholder')}
                      className={`${inputClass} flex-1`}
                    />
                    <input
                      type="text"
                      value={item.value}
                      onChange={e => updateHeader(index, 'value', e.target.value)}
                      placeholder={t('settings.mcp.field.headerValuePlaceholder')}
                      className={`${inputClass} flex-1`}
                    />
                    <button
                      onClick={() => removeHeader(index)}
                      className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addHeader}
                  className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  <Plus size={14} />
                  {t('settings.mcp.field.addHeader')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
          </>
        )}
      </div>
    </Modal>
  );
}
