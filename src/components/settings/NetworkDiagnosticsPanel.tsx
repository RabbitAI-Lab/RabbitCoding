/**
 * NetworkDiagnosticsPanel 组件
 *
 * 网络诊断面板：支持 DNS、HTTP、Ping、Marketplace 四种诊断类型。
 * 点击"开始诊断"按钮后并行执行所有诊断，渐进式展示结果。
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Play, CheckCircle2, XCircle, Activity } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { SettingSection } from './settingsShared';
import type {
  DnsResult,
  HttpResult,
  PingResult,
  MarketplaceResult,
  ProxyInfo,
} from '../../types';

type DiagStatus = 'idle' | 'loading' | 'done' | 'error';

interface DiagState<T> {
  status: DiagStatus;
  data: T | null;
  error: string | null;
}

// ============================================================
// 辅助渲染组件
// ============================================================

/** 状态徽标 */
function StatusBadge({ status }: { status: string }) {
  const isOk = status === 'ok';
  return (
    <span
      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
        isOk
          ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
          : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
      }`}
    >
      {isOk ? 'OK' : 'FAIL'}
    </span>
  );
}

/** 代理信息显示 */
function ProxyBadge({ proxy }: { proxy: ProxyInfo }) {
  if (!proxy.enabled) {
    return (
      <span className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">Direct</span>
    );
  }
  return (
    <span className="text-[11px] text-orange-500 dark:text-orange-400 font-mono truncate">
      {proxy.address || proxy.source || 'Proxy'}
    </span>
  );
}

/** 键值行 */
function FieldRow({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 min-w-[90px]">
        {label}
      </span>
      <span className="text-[11px] text-gray-700 dark:text-gray-300 font-mono break-all flex-1">
        {children ?? '—'}
      </span>
    </div>
  );
}

/** 区块加载状态 */
function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 size={16} className="text-[var(--brand-primary)] animate-spin" />
    </div>
  );
}

/** 区块空闲状态 */
function SectionIdle({ hint }: { hint: string }) {
  return (
    <div className="flex items-center justify-center py-6">
      <Activity size={20} className="text-gray-300 dark:text-gray-600 mb-1" />
      <p className="text-xs text-gray-400 dark:text-gray-500 ml-2">{hint}</p>
    </div>
  );
}

// ============================================================
// DNS 结果区块
// ============================================================

function DnsSection({ state }: { state: DiagState<DnsResult[]> }) {
  const { t } = useI18n();
  const c = 'settings.networkDiagnostics.dns.columns';

  if (state.status === 'idle') return <SectionIdle hint={t('settings.networkDiagnostics.resultHint')} />;
  if (state.status === 'loading') return <SectionLoading />;
  if (state.status === 'error' || !state.data) {
    return <div className="text-xs text-red-500 dark:text-red-400 py-4 text-center">{state.error}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 全局 Proxy 信息 */}
      {state.data[0] && (
        <div className="text-[11px] text-gray-400 dark:text-gray-500">
          <span className="mr-1">{t(`${c}.proxy`)}:</span>
          <ProxyBadge proxy={state.data[0].proxy} />
        </div>
      )}
      {state.data.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[#333333] dark:text-gray-100 font-mono truncate">
              {item.host}
            </span>
            <StatusBadge status={item.status} />
          </div>
          {item.status === 'ok' ? (
            <>
              <FieldRow label={t(`${c}.servers`)}>{item.server ?? 'system'}</FieldRow>
              <FieldRow label={t(`${c}.resolvedIps`)}>
                {item.resolvedIps.length > 0 ? item.resolvedIps.join(', ') : '—'}
              </FieldRow>
              <FieldRow label={t(`${c}.resolutionTime`)}>
                {item.resolutionMs != null ? `${item.resolutionMs}ms` : '—'}
              </FieldRow>
            </>
          ) : (
            <p className="text-[11px] text-red-500 dark:text-red-400">{item.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// HTTP 结果区块
// ============================================================

function HttpSection({ state }: { state: DiagState<HttpResult[]> }) {
  const { t } = useI18n();
  const c = 'settings.networkDiagnostics.http.columns';

  if (state.status === 'idle') return <SectionIdle hint={t('settings.networkDiagnostics.resultHint')} />;
  if (state.status === 'loading') return <SectionLoading />;
  if (state.status === 'error' || !state.data) {
    return <div className="text-xs text-red-500 dark:text-red-400 py-4 text-center">{state.error}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state.data[0] && (
        <div className="text-[11px] text-gray-400 dark:text-gray-500">
          <span className="mr-1">{t(`${c}.proxy`)}:</span>
          <ProxyBadge proxy={state.data[0].proxy} />
        </div>
      )}
      {state.data.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[#333333] dark:text-gray-100 font-mono truncate flex-1 mr-2">
              {item.endpoint}
            </span>
            <StatusBadge status={item.status} />
          </div>
          {item.status === 'ok' ? (
            <>
              <FieldRow label={t(`${c}.method`)}>{item.method}</FieldRow>
              <FieldRow label={t(`${c}.protocol`)}>{item.httpVersion ?? '—'}</FieldRow>
              <FieldRow label={t(`${c}.tlsVersion`)}>{item.tlsVersion ?? '—'}</FieldRow>
              <FieldRow label={t(`${c}.status`)}>
                {item.statusCode != null ? `${item.statusCode}` : '—'}
              </FieldRow>
              <FieldRow label={t(`${c}.responseTime`)}>
                {item.responseTimeMs != null ? `${item.responseTimeMs}ms` : '—'}
              </FieldRow>
              <FieldRow label={t(`${c}.contentType`)}>{item.contentType ?? '—'}</FieldRow>
            </>
          ) : (
            <p className="text-[11px] text-red-500 dark:text-red-400">{item.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Ping 结果区块
// ============================================================

function PingSection({ state }: { state: DiagState<PingResult[]> }) {
  const { t } = useI18n();
  const c = 'settings.networkDiagnostics.ping.columns';

  if (state.status === 'idle') return <SectionIdle hint={t('settings.networkDiagnostics.resultHint')} />;
  if (state.status === 'loading') return <SectionLoading />;
  if (state.status === 'error' || !state.data) {
    return <div className="text-xs text-red-500 dark:text-red-400 py-4 text-center">{state.error}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state.data.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[#333333] dark:text-gray-100 font-mono truncate">
              {item.target}
            </span>
            <StatusBadge status={item.status} />
          </div>
          {item.status === 'ok' ? (
            <>
              <FieldRow label={t(`${c}.ip`)}>{item.ip ?? '—'}</FieldRow>
              <FieldRow label={t(`${c}.packets`)}>
                {item.packetsSent != null && item.packetsReceived != null
                  ? `sent=${item.packetsSent}, received=${item.packetsReceived}, lost=${item.packetLossPercent ?? 0}%`
                  : '—'}
              </FieldRow>
              <FieldRow label={t(`${c}.rtt`)}>
                {item.rttMinMs != null && item.rttAvgMs != null && item.rttMaxMs != null
                  ? `min=${item.rttMinMs}ms, max=${item.rttMaxMs}ms, avg=${item.rttAvgMs}ms`
                  : '—'}
              </FieldRow>
            </>
          ) : (
            <p className="text-[11px] text-red-500 dark:text-red-400">{item.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Marketplace 结果区块
// ============================================================

function MarketplaceSection({ state }: { state: DiagState<MarketplaceResult> }) {
  const { t } = useI18n();

  if (state.status === 'idle') return <SectionIdle hint={t('settings.networkDiagnostics.resultHint')} />;
  if (state.status === 'loading') return <SectionLoading />;
  if (state.status === 'error' || !state.data) {
    return <div className="text-xs text-red-500 dark:text-red-400 py-4 text-center">{state.error}</div>;
  }

  const item = state.data;
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[#333333] dark:text-gray-100 font-mono truncate flex-1 mr-2">
          {item.endpoint}
        </span>
        <StatusBadge status={item.status} />
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        {/* Connection 状态 */}
        <div className="flex items-center gap-1">
          {item.connectionOk ? (
            <CheckCircle2 size={13} className="text-green-500 dark:text-green-400" />
          ) : (
            <XCircle size={13} className="text-red-500 dark:text-red-400" />
          )}
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('settings.networkDiagnostics.marketplace.connection')}:{' '}
            {item.connectionOk ? 'OK' : 'Failed'}
          </span>
        </div>
        {/* API 状态 */}
        <div className="flex items-center gap-1">
          {item.apiAvailable ? (
            <CheckCircle2 size={13} className="text-green-500 dark:text-green-400" />
          ) : (
            <XCircle size={13} className="text-red-500 dark:text-red-400" />
          )}
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('settings.networkDiagnostics.marketplace.api')}:{' '}
            {item.apiAvailable ? 'Available' : 'Unavailable'}
          </span>
        </div>
      </div>
      {item.responseTimeMs != null && (
        <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 font-mono">
          {t('settings.networkDiagnostics.marketplace.responseTime')}: {item.responseTimeMs}ms
        </div>
      )}
      {item.status === 'error' && item.error && (
        <p className="mt-1 text-[11px] text-red-500 dark:text-red-400">{item.error}</p>
      )}
    </div>
  );
}

// ============================================================
// 主面板组件
// ============================================================

export default function NetworkDiagnosticsPanel() {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);

  const [dnsState, setDnsState] = useState<DiagState<DnsResult[]>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [httpState, setHttpState] = useState<DiagState<HttpResult[]>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [pingState, setPingState] = useState<DiagState<PingResult[]>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const [marketState, setMarketState] = useState<DiagState<MarketplaceResult>>({
    status: 'idle',
    data: null,
    error: null,
  });

  const runDiagnostics = useCallback(() => {
    setRunning(true);

    // 设置所有区块为 loading
    setDnsState({ status: 'loading', data: null, error: null });
    setHttpState({ status: 'loading', data: null, error: null });
    setPingState({ status: 'loading', data: null, error: null });
    setMarketState({ status: 'loading', data: null, error: null });

    // 并行执行四个诊断
    invoke<DnsResult[]>('diag_dns')
      .then(data => setDnsState({ status: 'done', data, error: null }))
      .catch(err => setDnsState({ status: 'error', data: null, error: String(err) }));

    invoke<HttpResult[]>('diag_http')
      .then(data => setHttpState({ status: 'done', data, error: null }))
      .catch(err => setHttpState({ status: 'error', data: null, error: String(err) }));

    invoke<MarketplaceResult>('diag_marketplace')
      .then(data => setMarketState({ status: 'done', data, error: null }))
      .catch(err => setMarketState({ status: 'error', data: null, error: String(err) }));

    // 所有诊断完成后重置 running（Ping 通常最慢）
    invoke<PingResult[]>('diag_ping')
      .then(data => setPingState({ status: 'done', data, error: null }))
      .catch(err => setPingState({ status: 'error', data: null, error: String(err) }))
      .finally(() => setRunning(false));
  }, []);

  const hasResults =
    dnsState.status !== 'idle' ||
    httpState.status !== 'idle' ||
    pingState.status !== 'idle' ||
    marketState.status !== 'idle';

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('settings.networkDiagnostics.description')}
        </p>
        <button
          onClick={runDiagnostics}
          disabled={running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white bg-[var(--brand-solid)] hover:bg-[var(--brand-solid-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t('settings.networkDiagnostics.running')}
            </>
          ) : (
            <>
              <Play size={14} />
              {hasResults
                ? t('settings.networkDiagnostics.rerun')
                : t('settings.networkDiagnostics.run')}
            </>
          )}
        </button>
      </div>

      {/* 四个诊断区块 */}
      <SettingSection title={t('settings.networkDiagnostics.dns.title')}>
        <DnsSection state={dnsState} />
      </SettingSection>

      <SettingSection title={t('settings.networkDiagnostics.http.title')}>
        <HttpSection state={httpState} />
      </SettingSection>

      <SettingSection title={t('settings.networkDiagnostics.ping.title')}>
        <PingSection state={pingState} />
      </SettingSection>

      <SettingSection title={t('settings.networkDiagnostics.marketplace.title')}>
        <MarketplaceSection state={marketState} />
      </SettingSection>
    </div>
  );
}
