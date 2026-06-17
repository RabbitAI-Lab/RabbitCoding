/**
 * ModelTestInline 组件
 *
 * 模型列表项内的「测试连接」行内控件：图标按钮 + 状态徽标。
 * 每个列表项独立实例化（各自持有 useModelTest 状态），互不干扰。
 */

import { Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useModelTest } from '../../hooks/useModelTest';
import type { ModelConfig } from '../../types';

interface ModelTestInlineProps {
  config: ModelConfig;
}

export default function ModelTestInline({ config }: ModelTestInlineProps) {
  const { t } = useI18n();
  const { state, runTest } = useModelTest();

  const isLoading = state.status === 'loading';

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() =>
          runTest({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            modelId: config.modelId,
          })
        }
        disabled={isLoading}
        title={t('settings.models.testConnection')}
        className="p-1.5 rounded-md text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
      </button>

      {/* 行内状态指示：成功绿勾 / 失败红叉（hover 显示错误详情） */}
      {state.status === 'success' && (
        <span
          title={
            state.result?.latencyMs != null
              ? `${t('settings.models.testSuccess')} · ${state.result.latencyMs}ms`
              : t('settings.models.testSuccess')
          }
          className="shrink-0 text-green-500 dark:text-green-400"
        >
          <CheckCircle2 size={13} />
        </span>
      )}
      {state.status === 'error' && (
        <span
          title={state.error ?? t('settings.models.testFailed')}
          className="shrink-0 text-red-500 dark:text-red-400 cursor-help"
        >
          <XCircle size={13} />
        </span>
      )}
    </div>
  );
}
