/**
 * useVoiceInput Hook
 *
 * 封装实时语音识别的采集、状态管理和文本回调。
 * 流程：getUserMedia → AudioWorklet 分帧 → invoke('asr_feed_chunk') → listen('asr://final')
 *
 * 状态机：idle → requesting → listening → idle
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type VoiceStatus = 'idle' | 'requesting' | 'listening' | 'error';

export interface AsrStatus {
  modelState: string; // 'not_downloaded' | 'downloading' | 'ready'
  modelDir: string;
  listening: boolean;
}

export interface DownloadProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  downloaded: number;
  total: number;
  percent: number;
}

interface UseVoiceInputOptions {
  /** 收到识别文本时的回调 */
  onText: (text: string, isFinal: boolean) => void;
  /** 模型下载进度回调 */
  onDownloadProgress?: (progress: DownloadProgress) => void;
  /** 状态变化回调 */
  onStatusChange?: (status: VoiceStatus) => void;
}

interface UseVoiceInputReturn {
  status: VoiceStatus;
  error: string | null;
  modelState: string;
  start: () => Promise<void>;
  stop: () => void;
  ensureModel: () => Promise<void>;
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn {
  const { onText, onDownloadProgress, onStatusChange } = options;
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<string>('unknown');

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const unlistenFnsRef = useRef<UnlistenFn[]>([]);
  const statusRef = useRef<VoiceStatus>('idle');
  const onTextRef = useRef(onText);
  const onDownloadProgressRef = useRef(onDownloadProgress);

  // 保持 ref 最新
  onTextRef.current = onText;
  onDownloadProgressRef.current = onDownloadProgress;

  // --- 组件挂载时即注册全局事件监听（download_progress / status）---
  // 这些事件与录音生命周期无关，必须在下载触发前就监听
  useEffect(() => {
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenStatus: UnlistenFn | null = null;

    (async () => {
      unlistenProgress = await listen<DownloadProgress>(
        'asr://download_progress',
        (event) => {
          onDownloadProgressRef.current?.(event.payload);
        },
      );

      unlistenStatus = await listen<{ state: string; error?: string }>(
        'asr://status',
        (event) => {
          const { state, error: errMsg } = event.payload;
          console.log('[voice] status event:', state);
          if (state === 'ready') {
            setModelState('ready');
          } else if (state === 'downloading') {
            setModelState('downloading');
          } else if (state === 'download_error') {
            setModelState('not_downloaded');
            if (errMsg) {
              console.error('[voice] download error:', errMsg);
            }
          }
        },
      );
    })();

    return () => {
      unlistenProgress?.();
      unlistenStatus?.();
    };
  }, []);

  const updateStatus = useCallback((newStatus: VoiceStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  /** 查询模型状态 */
  const checkStatus = useCallback(async () => {
    try {
      const result = await invoke<AsrStatus>('asr_status');
      setModelState(result.modelState);
      return result.modelState;
    } catch (e) {
      console.error('[voice] Failed to check ASR status:', e);
      return 'unknown';
    }
  }, []);

  /** 确保模型已下载 */
  const ensureModel = useCallback(async () => {
    const state = await checkStatus();
    console.log('[voice] ensureModel: current state =', state);
    if (state === 'ready') return;
    // 立即标记为 downloading，避免 UI 空窗
    setModelState('downloading');
    console.log('[voice] ensureModel: invoking asr_ensure_model...');
    await invoke('asr_ensure_model');
    console.log('[voice] ensureModel: invoke returned, download running in background');
  }, [checkStatus]);

  /** 开始语音识别 */
  const start = useCallback(async () => {
    if (statusRef.current === 'listening' || statusRef.current === 'requesting') {
      return;
    }

    try {
      updateStatus('requesting');
      setError(null);

      // 1. 检查模型是否就绪
      const state = await checkStatus();
      if (state !== 'ready') {
        throw new Error('Model not ready. Please download the voice model first.');
      }

      // 2. 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 3. 创建 AudioContext + 加载 AudioWorklet
      const audioContext = new AudioContext({ sampleRate: 48000 });
      await audioContext.audioWorklet.addModule('/voice-processor.js');
      audioContextRef.current = audioContext;

      // 4. 连接音频图
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const workletNode = new AudioWorkletNode(audioContext, 'voice-processor');
      workletNodeRef.current = workletNode;

      // 5. 监听 Worklet 消息（音频块）→ 发送给 Rust
      workletNode.port.onmessage = (event) => {
        const byteBuffer = event.data as ArrayBuffer;
        const samples = new Uint8Array(byteBuffer);
        invoke('asr_feed_chunk', { samples }).catch((e) => {
          console.error('[voice] Failed to feed audio chunk:', e);
        });
      };

      sourceNode.connect(workletNode);
      // 不连接到 destination，避免音频回放（啸叫）

      // 6. 注册 Tauri 事件监听
      const unlistenPartial = await listen<{ text: string; isFinal: boolean }>(
        'asr://partial',
        (event) => {
          const { text, isFinal } = event.payload;
          if (text) {
            onTextRef.current(text, isFinal);
          }
        },
      );

      const unlistenFinal = await listen<{ text: string }>(
        'asr://final',
        (event) => {
          const { text } = event.payload;
          if (text) {
            onTextRef.current(text, true);
          }
        },
      );

      unlistenFnsRef.current = [unlistenPartial, unlistenFinal];

      // 7. 通知 Rust 开始识别会话
      await invoke('asr_start');

      updateStatus('listening');
      console.log('[voice] Voice input started');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[voice] Failed to start:', msg);
      setError(msg);
      updateStatus('error');

      // 清理部分初始化的资源
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    }
  }, [checkStatus, updateStatus]);

  /** 停止语音识别 */
  const stop = useCallback(() => {
    // 断开音频图
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // 取消事件监听
    unlistenFnsRef.current.forEach((fn) => fn());
    unlistenFnsRef.current = [];

    // 通知 Rust 停止
    invoke('asr_stop').catch((e) => {
      console.error('[voice] Failed to stop ASR:', e);
    });

    updateStatus('idle');
    console.log('[voice] Voice input stopped');
  }, [updateStatus]);

  return {
    status,
    error,
    modelState,
    start,
    stop,
    ensureModel,
  };
}
