/**
 * useModelTest Hook
 *
 * 封装模型连接测试的调用与状态管理（idle / loading / success / error）。
 * 供 ModelEditModal（草稿测试）与 ModelTestInline（列表项测试）复用，避免重复实现。
 *
 * 状态机：idle → loading → success | error
 */

import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ModelTestResult } from '../types';

export type ModelTestStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ModelTestState {
  status: ModelTestStatus;
  result: ModelTestResult | null;
  error: string | null;
}

/** 测试输入（调用方传入，hook 内部转为 payload 的 snake_case 键） */
export interface ModelTestInput {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

const INITIAL_STATE: ModelTestState = {
  status: 'idle',
  result: null,
  error: null,
};

export function useModelTest() {
  const [state, setState] = useState<ModelTestState>(INITIAL_STATE);

  /**
   * 发起一次连接测试。
   * 缺参、鉴权失败、端点错误等均落到 error 态，错误信息透传 Rust 返回的中文描述。
   */
  const runTest = useCallback(async (input: ModelTestInput) => {
    setState({ status: 'loading', result: null, error: null });
    try {
      const result = await invoke<ModelTestResult>('test_model_connection', {
        payload: {
          base_url: input.baseUrl.trim(),
          api_key: input.apiKey.trim(),
          model_id: input.modelId.trim(),
        },
      });
      setState(
        result.success
          ? { status: 'success', result, error: null }
          : { status: 'error', result, error: result.error ?? '测试失败' },
      );
    } catch (e) {
      setState({
        status: 'error',
        result: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  /** 重置为初始态（弹窗 open 切换或重新测试时调用） */
  const reset = useCallback(() => setState(INITIAL_STATE), []);

  return { state, runTest, reset };
}
