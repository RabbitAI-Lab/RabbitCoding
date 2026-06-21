/**
 * 查询当前平台是否支持语音识别（后端 cfg! 编译期判定）
 *
 * 后端在 Windows ARM64 上不编译 sherpa-onnx，返回 false；
 * 其余平台（macOS x86/ARM、Windows x86）返回 true。
 * 前端据此隐藏语音输入按钮和语音设置页。
 */

import { invoke } from '@tauri-apps/api/core';

let cached: boolean | null = null;

/** 同步获取缓存值（首次调用前为 true，避免闪烁） */
export function isVoiceSupportedSync(): boolean {
  return cached !== false;
}

/** 异步查询后端，结果缓存到模块级变量 */
export async function checkVoiceSupported(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = await invoke<boolean>('voice_supported');
  } catch {
    cached = true; // 后端命令不存在时默认支持
  }
  return cached;
}
