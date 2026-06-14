import type { ModelProvider } from '../types';

/** 厂商预设：选择厂商时自动填充 baseUrl / modelId / apiKeyEnvVar */
export interface ProviderPreset {
  provider: ModelProvider;
  /** i18n 键后缀，实际键为 settings.models.provider.{suffix} */
  labelKey: string;
  baseUrl: string;
  defaultModelId: string;
  apiKeyEnvVar: string;
}

/** 厂商预设列表 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    provider: 'glm',
    labelKey: 'settings.models.provider.glm',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultModelId: 'glm-5.1',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  {
    provider: 'minimax',
    labelKey: 'settings.models.provider.minimax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModelId: 'MiniMax-M3',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  {
    provider: 'aliyun',
    labelKey: 'settings.models.provider.aliyun',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    defaultModelId: 'glm-5',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  {
    provider: 'kimi',
    labelKey: 'settings.models.provider.kimi',
    baseUrl: 'https://api.kimi.com/coding',
    defaultModelId: 'kimi-for-coding',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  {
    provider: 'deepseek',
    labelKey: 'settings.models.provider.deepseek',
    baseUrl: 'https://api.deepseek.com/v1/',
    defaultModelId: 'deepseek-v4-pro',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
  {
    provider: 'custom',
    labelKey: 'settings.models.provider.custom',
    baseUrl: '',
    defaultModelId: '',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
];

/** 根据厂商获取预设 */
export function getPreset(provider: ModelProvider): ProviderPreset {
  return PROVIDER_PRESETS.find(p => p.provider === provider) ?? PROVIDER_PRESETS[5];
}
