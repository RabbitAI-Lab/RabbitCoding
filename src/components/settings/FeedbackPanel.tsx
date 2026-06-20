/**
 * FeedbackPanel 组件
 *
 * 问题反馈面板：截图、问题描述、系统信息、性能分析、提交。
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Send, CheckCircle2, XCircle, Cpu, MemoryStick, Activity, Camera } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { SettingSection, SettingRow, Toggle } from './settingsShared';
import ScreenshotUploader from './feedback/ScreenshotUploader';
import {
  buildConfigSummary,
  collectWebviewMetrics,
  validateEmail,
  stripDataUrl,
  toISOString,
  nowDatetimeLocal,
} from './feedback/feedbackUtils';
import type {
  ScreenCaptureResult,
  FeedbackSystemInfo,
  ConfigSummary,
  FeedbackPerformanceMetrics,
  FeedbackSubmitResult,
  FeedbackPayload,
} from '../../types';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

/** 键值行（只读信息展示） */
function InfoRow({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 min-w-[90px]">{label}</span>
      <span className="text-[11px] text-gray-700 dark:text-gray-300 font-mono break-all flex-1">
        {children ?? '—'}
      </span>
    </div>
  );
}

export default function FeedbackPanel({ autoCapture = true }: { autoCapture?: boolean }) {
  const { t } = useI18n();

  // 截图状态
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [hasAutoCaptured, setHasAutoCaptured] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // 表单状态
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowDatetimeLocal());
  const [email, setEmail] = useState('');
  const [includePerformance, setIncludePerformance] = useState(false);

  // 系统信息
  const [systemInfo, setSystemInfo] = useState<FeedbackSystemInfo | null>(null);
  const [configSummary, setConfigSummary] = useState<ConfigSummary | null>(null);

  // 提交状态
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitMessage, setSubmitMessage] = useState('');
  const [validationError, setValidationError] = useState('');

  // ---------- 截图 ----------

  /** 调用 Rust 截取应用窗口 */
  const doCapture = useCallback(async (): Promise<string | null> => {
    setCapturing(true);
    try {
      const result = await invoke<ScreenCaptureResult>('capture_app_window');
      return `data:image/jpeg;base64,${result.base64Png}`;
    } catch (err) {
      console.error('[Feedback] capture failed:', err);
      return null;
    } finally {
      setCapturing(false);
    }
  }, []);

  /** 重新截取（替换第一张） */
  const handleRecapture = useCallback(async () => {
    const dataUrl = await doCapture();
    if (dataUrl) {
      setScreenshots(prev => {
        if (prev.length === 0) return [dataUrl];
        return [dataUrl, ...prev.slice(1)];
      });
      setHasAutoCaptured(true);
    }
  }, [doCapture]);

  /** 添加截图（追加到末尾） */
  const handleAdd = useCallback(async () => {
    const dataUrl = await doCapture();
    if (dataUrl) {
      setScreenshots(prev => [...prev, dataUrl]);
    }
  }, [doCapture]);

  /** 删除截图 */
  const handleRemove = useCallback((index: number) => {
    setScreenshots(prev => prev.filter((_, i) => i !== index));
    // 如果删除的是第一张（自动截取），清除标记
    if (index === 0) setHasAutoCaptured(false);
  }, []);

  // ---------- 初始化 ----------

  useEffect(() => {
    // 仅在 autoCapture 为 true 时自动截取第一张
    if (autoCapture) {
      doCapture().then(dataUrl => {
        if (dataUrl) {
          setScreenshots([dataUrl]);
          setHasAutoCaptured(true);
        }
      });
    }

    // 收集系统信息
    invoke<FeedbackSystemInfo>('collect_system_info')
      .then(setSystemInfo)
      .catch(err => console.error('[Feedback] system info failed:', err));

    // 组装配置摘要
    setConfigSummary(buildConfigSummary());
  }, [doCapture, autoCapture]);

  // ---------- 提交 ----------

  const handleSubmit = useCallback(async () => {
    setValidationError('');

    // 表单验证
    if (!steps.trim()) {
      setValidationError(t('settings.feedback.submit.validation.stepsRequired'));
      return;
    }
    if (!email.trim()) {
      setValidationError(t('settings.feedback.submit.validation.emailRequired'));
      return;
    }
    if (!validateEmail(email)) {
      setValidationError(t('settings.feedback.submit.validation.emailInvalid'));
      return;
    }
    if (!systemInfo || !configSummary) {
      setValidationError(t('settings.feedback.submit.systemInfoNotReady'));
      return;
    }

    setSubmitState('submitting');
    setSubmitMessage('');

    try {
      // 如果勾选性能分析，收集性能指标
      let performanceMetrics: FeedbackPerformanceMetrics | undefined;
      if (includePerformance) {
        const webviewMetrics = collectWebviewMetrics();
        try {
          performanceMetrics = await invoke<FeedbackPerformanceMetrics>(
            'collect_performance_metrics',
            { webviewMetrics }
          );
        } catch (err) {
          console.error('[Feedback] performance metrics failed:', err);
        }
      }

      const payload: FeedbackPayload = {
        screenshots: screenshots.map(stripDataUrl),
        description: {
          steps: steps.trim(),
          expected: expected.trim(),
          occurredAt: toISOString(occurredAt),
          email: email.trim(),
        },
        systemInfo,
        configSummary,
        performanceMetrics,
      };

      const result = await invoke<FeedbackSubmitResult>('submit_feedback', { payload });

      if (result.success) {
        setSubmitState('success');
        setSubmitMessage(
          result.ticketId
            ? t('settings.feedback.submit.successWithTicket').replace('${ticketId}', result.ticketId)
            : t('settings.feedback.submit.success')
        );
      } else {
        setSubmitState('error');
        setSubmitMessage(result.message);
      }
    } catch (err) {
      setSubmitState('error');
      setSubmitMessage(String(err));
    }
  }, [steps, email, expected, occurredAt, systemInfo, configSummary, includePerformance, screenshots, t]);

  // ---------- 渲染辅助 ----------

  /** 渲染性能指标标签 */
  const renderMetric = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{label}:</span>
      <span className="text-[11px] text-gray-700 dark:text-gray-300 font-mono">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部说明 */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t('settings.feedback.description')}
      </p>

      {/* ① 截图区 */}
      <SettingSection title={t('settings.feedback.screenshots.title')}>
        <div className="mb-3">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {t('settings.feedback.screenshots.description')}
          </p>
        </div>
        {screenshots.length === 0 && !capturing ? (
          <button
            onClick={handleRecapture}
            disabled={capturing}
            className="flex aspect-video w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] dark:text-gray-500 dark:hover:border-[var(--brand-primary)] dark:hover:text-[var(--brand-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Camera size={20} />
            <span className="text-xs">{t('settings.feedback.screenshots.captureApp')}</span>
          </button>
        ) : (
          <ScreenshotUploader
            screenshots={screenshots}
            hasAutoCaptured={hasAutoCaptured}
            capturing={capturing}
            maxCount={5}
            onCapture={handleRecapture}
            onRemove={handleRemove}
            onAdd={handleAdd}
          />
        )}
      </SettingSection>

      {/* ② 问题描述 */}
      <SettingSection title={t('settings.feedback.issueForm.title')}>
        <div className="flex flex-col gap-3">
          {/* 操作步骤 */}
          <div>
            <label className="text-xs text-[#333333] dark:text-gray-200">
              {t('settings.feedback.issueForm.steps')}
            </label>
            <textarea
              value={steps}
              onChange={e => setSteps(e.target.value)}
              placeholder={t('settings.feedback.issueForm.stepsPlaceholder')}
              rows={4}
              className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none dark:border-gray-600 dark:bg-[#2a2a2a] dark:text-gray-200 dark:placeholder:text-gray-500"
            />
          </div>

          {/* 期望结果 */}
          <div>
            <label className="text-xs text-[#333333] dark:text-gray-200">
              {t('settings.feedback.issueForm.expected')}
            </label>
            <textarea
              value={expected}
              onChange={e => setExpected(e.target.value)}
              placeholder={t('settings.feedback.issueForm.expectedPlaceholder')}
              rows={3}
              className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none dark:border-gray-600 dark:bg-[#2a2a2a] dark:text-gray-200 dark:placeholder:text-gray-500"
            />
          </div>

          {/* 发生时间 + 联系邮箱（同行） */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#333333] dark:text-gray-200">
                {t('settings.feedback.issueForm.occurredAt')}
              </label>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={e => setOccurredAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 focus:border-[var(--brand-primary)] focus:outline-none dark:border-gray-600 dark:bg-[#2a2a2a] dark:text-gray-200"
              />
            </div>
            <div>
              <label className="text-xs text-[#333333] dark:text-gray-200">
                {t('settings.feedback.issueForm.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('settings.feedback.issueForm.emailPlaceholder')}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-[var(--brand-primary)] focus:outline-none dark:border-gray-600 dark:bg-[#2a2a2a] dark:text-gray-200 dark:placeholder:text-gray-500"
              />
            </div>
          </div>
        </div>
      </SettingSection>

      {/* ③ 系统信息（只读） */}
      <SettingSection
        title={t('settings.feedback.systemInfo.title')}
        description={t('settings.feedback.systemInfo.description')}
      >
        {systemInfo ? (
          <div className="flex flex-col gap-3">
            {/* 系统信息 */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
              <InfoRow label={t('settings.feedback.systemInfo.os')}>{systemInfo.os}</InfoRow>
              <InfoRow label={t('settings.feedback.systemInfo.osVersion')}>{systemInfo.osVersion}</InfoRow>
              <InfoRow label={t('settings.feedback.systemInfo.arch')}>{systemInfo.arch}</InfoRow>
              <InfoRow label={t('settings.feedback.systemInfo.appVersion')}>{systemInfo.appVersion}</InfoRow>
              <InfoRow label={t('settings.feedback.systemInfo.cpuBrand')}>{systemInfo.cpuBrand}</InfoRow>
              <InfoRow label={t('settings.feedback.systemInfo.cpuCores')}>{systemInfo.cpuCores}</InfoRow>
              <InfoRow label={t('settings.feedback.systemInfo.totalMemory')}>{systemInfo.totalMemoryMb} MB</InfoRow>
            </div>

            {/* 启用插件（MCP 服务） */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                {t('settings.feedback.systemInfo.enabledPlugins')}
              </p>
              {configSummary && configSummary.enabledMcpServers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {configSummary.enabledMcpServers.map((mcp, i) => (
                    <span
                      key={i}
                      className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-gray-300 font-mono"
                    >
                      {mcp.name} ({mcp.serverType})
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {t('settings.feedback.systemInfo.noPlugins')}
                </span>
              )}
            </div>

            {/* 配置信息 */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">
                {t('settings.feedback.systemInfo.modelConfigs')}
              </p>
              {configSummary && configSummary.models.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {configSummary.models.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${m.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      <span className="text-[11px] text-gray-600 dark:text-gray-300 font-mono">
                        {m.name} ({m.provider})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">—</span>
              )}
              <div className="mt-1.5 pt-1.5 border-t border-gray-50 dark:border-gray-800">
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {t('settings.feedback.systemInfo.proxyStatus')}:{' '}
                </span>
                <span className="text-[11px] text-gray-700 dark:text-gray-300">
                  {configSummary?.proxy.enabled
                    ? t('settings.feedback.systemInfo.proxyEnabled')
                    : t('settings.feedback.systemInfo.proxyDisabled')}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="text-[var(--brand-primary)] animate-spin" />
          </div>
        )}
      </SettingSection>

      {/* ④ 性能分析 */}
      <SettingSection
        title={t('settings.feedback.performance.title')}
        description={t('settings.feedback.performance.description')}
      >
        <SettingRow label={t('settings.feedback.performance.enable')}>
          <Toggle checked={includePerformance} onChange={setIncludePerformance} />
        </SettingRow>
        {includePerformance && (
          <div className="mt-3 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {renderMetric(
              <MemoryStick size={12} className="text-gray-400" />,
              t('settings.feedback.performance.appMemory'),
              '—'
            )}
            {renderMetric(
              <Cpu size={12} className="text-gray-400" />,
              t('settings.feedback.performance.appCpu'),
              '—'
            )}
            {renderMetric(
              <Activity size={12} className="text-gray-400" />,
              t('settings.feedback.performance.sysMemory'),
              '—'
            )}
            <p className="text-[10px] text-gray-400 dark:text-gray-500 w-full mt-1">
              {t('settings.feedback.performance.hint')}
            </p>
          </div>
        )}
      </SettingSection>

      {/* 验证错误提示 */}
      {validationError && (
        <div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
          <XCircle size={14} />
          <span>{validationError}</span>
        </div>
      )}

      {/* 提交结果 */}
      {submitState === 'success' && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle2 size={14} />
          <span>{submitMessage}</span>
        </div>
      )}
      {submitState === 'error' && (
        <div className="flex items-start gap-1.5 text-xs text-red-500 dark:text-red-400">
          <XCircle size={14} className="shrink-0 mt-0.5" />
          <span className="break-all">{submitMessage}</span>
        </div>
      )}

      {/* 提交按钮 */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleSubmit}
          disabled={submitState === 'submitting'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs text-white bg-[var(--brand-solid)] hover:bg-[var(--brand-solid-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitState === 'submitting' ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t('settings.feedback.submit.submitting')}
            </>
          ) : (
            <>
              <Send size={14} />
              {t('settings.feedback.submit.button')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
