/**
 * GitHubConnectModal 组件
 *
 * 实现 GitHub OAuth Device Flow 有状态弹窗：
 * 1. 弹窗打开 → 请求 device code
 * 2. 显示 user_code → 自动打开浏览器
 * 3. 轮询 token → 成功后获取用户信息
 *
 * 注意：React StrictMode 会导致 useEffect 双重执行，
 * 必须使用 cancelled 标志和定时器清理防止竞态。
 */

import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Loader2, ExternalLink, Copy, Check, AlertCircle, RefreshCw } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { generateId } from '../../utils/id';
import Modal from '../common/Modal';
import type { IntegrationConfig } from '../../types';

// ---- Rust 后端返回结构 ----
interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface TokenPollResponse {
  status: 'success' | 'pending' | 'slow_down' | 'expired' | 'error';
  accessToken?: string;
  error?: string;
}

interface GitHubUserInfo {
  login: string;
  avatarUrl: string;
  name?: string;
}

type FlowState = 'requesting' | 'awaiting' | 'polling' | 'success' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onConnected: (config: IntegrationConfig) => void;
}

/** GitHub Logo 内联 SVG */
function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.73-1.34-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.79 2.81 1.27 3.5.97.11-.76.42-1.27.76-1.56-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.21.96-.26 1.98-.39 3-.4 1.02.01 2.04.14 3 .4 2.28-1.53 3.29-1.21 3.29-1.21.66 1.64.24 2.86.12 3.16.77.83 1.24 1.88 1.24 3.17 0 4.53-2.81 5.53-5.49 5.82.43.36.81 1.08.81 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.21.68.83.56C20.57 21.89 24 17.49 24 12.29 24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

export default function GitHubConnectModal({ open, onClose, onConnected }: Props) {
  const { t } = useI18n();
  const [flowState, setFlowState] = useState<FlowState>('requesting');
  const [deviceData, setDeviceData] = useState<DeviceCodeResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // ---- refs：避免闭包陷阱 & StrictMode 竞态 ----
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceCodeRef = useRef<string>('');
  const intervalRef = useRef<number>(5);
  const expiresAtRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const successRef = useRef<boolean>(false);

  // 最新回调的 ref（避免 useCallback 依赖问题）
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tRef = useRef(t);
  tRef.current = t;

  /** 清除所有定时器 */
  const clearAllTimers = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (initialTimerRef.current) {
      clearTimeout(initialTimerRef.current);
      initialTimerRef.current = null;
    }
  };

  /** 轮询 token */
  const doPoll = async () => {
    // 如果已取消或已成功，不再继续
    if (cancelledRef.current || successRef.current) return;

    // 检查是否过期
    if (Date.now() > expiresAtRef.current) {
      if (!cancelledRef.current && !successRef.current) {
        setFlowState('error');
        setErrorMsg(tRef.current('settings.integration.deviceFlow.expired'));
      }
      return;
    }

    if (!cancelledRef.current && !successRef.current) {
      setFlowState(prev => (prev === 'awaiting' ? 'polling' : prev));
    }

    try {
      const resp = await invoke<TokenPollResponse>('github_device_poll', {
        deviceCode: deviceCodeRef.current,
      });

      console.log('[GitHubConnectModal] poll result:', resp);

      // 异步返回后再次检查取消标志
      if (cancelledRef.current || successRef.current) return;

      if (resp.status === 'success' && resp.accessToken) {
        successRef.current = true;

        // 获取用户信息
        try {
          const user = await invoke<GitHubUserInfo>('github_get_user', {
            token: resp.accessToken,
          });

          if (cancelledRef.current) return;

          const config: IntegrationConfig = {
            id: generateId(),
            provider: 'github',
            connected: true,
            accountName: user.login,
            avatarUrl: user.avatarUrl,
            token: resp.accessToken,
            connectedAt: Date.now(),
          };

          setFlowState('success');
          setTimeout(() => {
            if (!cancelledRef.current) {
              onConnectedRef.current(config);
              onCloseRef.current();
            }
          }, 800);
        } catch (userErr) {
          console.error('[GitHubConnectModal] github_get_user failed:', userErr);
          if (!cancelledRef.current) {
            successRef.current = false; // 回滚，允许重试
            setFlowState('error');
            setErrorMsg(typeof userErr === 'string' ? userErr : JSON.stringify(userErr));
          }
        }
        return;
      }

      if (resp.status === 'expired') {
        if (!cancelledRef.current && !successRef.current) {
          setFlowState('error');
          setErrorMsg(tRef.current('settings.integration.deviceFlow.expired'));
        }
        return;
      }

      if (resp.status === 'error') {
        if (!cancelledRef.current && !successRef.current) {
          setFlowState('error');
          setErrorMsg(resp.error || tRef.current('settings.integration.deviceFlow.failed'));
        }
        return;
      }

      // pending 或 slow_down → 继续轮询
      if (resp.status === 'slow_down') {
        intervalRef.current += 5;
      }

      if (!cancelledRef.current && !successRef.current) {
        setFlowState('awaiting');
        pollTimerRef.current = setTimeout(() => doPoll(), intervalRef.current * 1000);
      }
    } catch (e) {
      console.error('[GitHubConnectModal] poll error:', e);
      if (!cancelledRef.current && !successRef.current) {
        setFlowState('error');
        setErrorMsg(typeof e === 'string' ? e : (e instanceof Error ? e.message : JSON.stringify(e)));
      }
    }
  };

  /** 请求 device code */
  const requestDeviceCode = async () => {
    if (cancelledRef.current) return;

    setFlowState('requesting');
    setErrorMsg('');
    setDeviceData(null);
    successRef.current = false;

    try {
      const resp = await invoke<DeviceCodeResponse>('github_device_code');

      // 异步返回后检查取消标志（StrictMode 可能在 await 期间取消）
      if (cancelledRef.current) return;

      deviceCodeRef.current = resp.deviceCode;
      intervalRef.current = resp.interval;
      expiresAtRef.current = Date.now() + resp.expiresIn * 1000;
      setDeviceData(resp);
      setFlowState('awaiting');

      console.log('[GitHubConnectModal] device code obtained, user_code:', resp.userCode);

      // 自动打开浏览器
      openUrl(resp.verificationUri).catch(() => {});

      // 启动轮询
      initialTimerRef.current = setTimeout(() => doPoll(), intervalRef.current * 1000);
    } catch (e) {
      console.error('[GitHubConnectModal] requestDeviceCode error:', e);
      if (!cancelledRef.current) {
        setFlowState('error');
        setErrorMsg(typeof e === 'string' ? e : (e instanceof Error ? e.message : JSON.stringify(e)));
      }
    }
  };

  // 弹窗打开时自动启动 — 使用 cancelled 标志防止 StrictMode 竞态
  useEffect(() => {
    if (open) {
      // 设置 cancelled = false，开始新一轮
      cancelledRef.current = false;
      successRef.current = false;
      requestDeviceCode();
    }

    // cleanup：StrictMode 卸载或弹窗关闭时执行
    return () => {
      cancelledRef.current = true;
      clearAllTimers();
      if (!open) {
        setFlowState('requesting');
        setDeviceData(null);
        setErrorMsg('');
        setCopied(false);
      }
    };
  }, [open]);

  /** 复制 user_code */
  const handleCopy = async () => {
    if (!deviceData) return;
    try {
      await navigator.clipboard.writeText(deviceData.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  /** 重试 */
  const handleRetry = () => {
    clearAllTimers();
    cancelledRef.current = false;
    successRef.current = false;
    requestDeviceCode();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('settings.integration.connect')} widthClassName="w-[440px]">
      <div className="flex flex-col items-center gap-4 py-2">
        {/* GitHub Logo */}
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800">
          <GitHubLogo className="h-7 w-7 text-gray-800 dark:text-gray-100" />
        </div>

        {/* requesting 状态 */}
        {flowState === 'requesting' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('settings.integration.deviceFlow.requesting')}
            </p>
          </div>
        )}

        {/* awaiting / polling 状态 */}
        {(flowState === 'awaiting' || flowState === 'polling') && deviceData && (
          <div className="flex w-full flex-col items-center gap-4">
            <p className="text-center text-xs text-gray-500 dark:text-gray-400">
              {t('settings.integration.deviceFlow.enterCode')}
            </p>

            {/* user_code 展示框 */}
            <div className="flex items-center gap-2">
              <div className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-6 py-3">
                <span className="text-2xl font-bold font-mono tracking-widest text-[#333333] dark:text-gray-100">
                  {deviceData.userCode}
                </span>
              </div>
              <button
                onClick={handleCopy}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                title={t('settings.integration.deviceFlow.copyCode')}
              >
                {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              </button>
            </div>

            {/* 打开浏览器按钮 */}
            <button
              onClick={() => openUrl(deviceData.verificationUri).catch(() => {})}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <ExternalLink size={14} />
              {t('settings.integration.deviceFlow.openBrowser')}
            </button>

            {/* 轮询中提示 */}
            <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              {flowState === 'polling' && <Loader2 className="h-3 w-3 animate-spin" />}
              <span>{t('settings.integration.deviceFlow.waiting')}</span>
            </div>
            <p className="text-[11px] text-gray-300 dark:text-gray-600">
              {t('settings.integration.deviceFlow.pollingHint')}
            </p>
          </div>
        )}

        {/* success 状态 */}
        {flowState === 'success' && (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              {t('settings.integration.deviceFlow.success')}
            </p>
          </div>
        )}

        {/* error 状态 */}
        {flowState === 'error' && (
          <div className="flex w-full flex-col items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertCircle className="h-5 w-5 text-red-500" />
            </div>
            <p className="text-sm font-medium text-red-500 dark:text-red-400">
              {t('settings.integration.deviceFlow.failed')}
            </p>
            {errorMsg && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center break-all max-w-[360px]">
                {errorMsg}
              </p>
            )}
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <RefreshCw size={14} />
              {t('settings.integration.connect')}
            </button>
          </div>
        )}

        {/* 底部取消按钮 */}
        {flowState !== 'success' && (
          <button
            onClick={onClose}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mt-2"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </Modal>
  );
}
