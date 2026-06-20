/**
 * useOptimizePrompt Hook
 *
 * 封装提示词优化的调用与状态管理（idle / loading / success / error）。
 * 直接通过 Tauri invoke 调用 Rust 的 optimize_prompt 命令，不走 sidecar。
 *
 * 状态机：idle → loading → success | error
 */

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { OptimizePromptResult } from '../types';

export type OptimizeStatus = 'idle' | 'loading' | 'success' | 'error';

export interface OptimizePromptState {
  status: OptimizeStatus;
  optimizedPrompt: string | null;
  error: string | null;
}

/** 优化输入（调用方传入，hook 内部转为 payload 的 snake_case 键） */
export interface OptimizePromptInput {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  prompt: string;
}

const INITIAL_STATE: OptimizePromptState = {
  status: 'idle',
  optimizedPrompt: null,
  error: null,
};

export function useOptimizePrompt() {
  const [state, setState] = useState<OptimizePromptState>(INITIAL_STATE);

  /**
   * 发起一次提示词优化。
   * 缺参、鉴权失败、端点错误等均落到 error 态，错误信息透传 Rust 返回的中文描述。
   * 返回值便于调用方在 await 后直接判断结果，无需依赖状态闭包。
   */
  const runOptimize = useCallback(async (input: OptimizePromptInput): Promise<OptimizePromptResult> => {
    setState({ status: 'loading', optimizedPrompt: null, error: null });
    try {
      const result = await invoke<OptimizePromptResult>('optimize_prompt', {
        payload: {
          base_url: input.baseUrl.trim(),
          api_key: input.apiKey.trim(),
          model_id: input.modelId.trim(),
          prompt: input.prompt,
        },
      });
      setState(
        result.success
          ? { status: 'success', optimizedPrompt: result.optimizedPrompt, error: null }
          : { status: 'error', optimizedPrompt: null, error: result.error ?? '优化失败' },
      );
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', optimizedPrompt: null, error: msg });
      return {
        success: false,
        optimizedPrompt: null,
        latencyMs: null,
        error: msg,
      };
    }
  }, []);

  /** 重置为初始态 */
  const reset = useCallback(() => setState(INITIAL_STATE), []);

  return { state, runOptimize, reset };
}
