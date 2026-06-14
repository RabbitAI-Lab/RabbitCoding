import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLocalStorage } from './useLocalStorage';
import { useCodebaseIndex } from './useCodebaseIndex';
import { generateId } from '../utils/id';
import type { McpServerConfig } from '../types';

// ============================================================
// 类型定义
// ============================================================

export type PluginId = 'gitnexus' | 'context7' | 'ecc';
export type PluginInstallStatus = 'idle' | 'installing' | 'installed' | 'error';

export interface PluginState {
  installed: boolean;
  status: PluginInstallStatus;
  message?: string;
}

interface EccCheckResult {
  installed: boolean;
  version?: string;
}

interface EccProgress {
  status: string;
  message: string;
  timestamp: number;
}

interface UsePluginReturn {
  pluginStates: Record<PluginId, PluginState>;
  installPlugin: (id: PluginId) => Promise<void>;
  uninstallPlugin: (id: PluginId) => Promise<void>;
}

// ============================================================
// Context7 检测辅助
// ============================================================

function isContext7Installed(configs: McpServerConfig[]): boolean {
  return configs.some(
    c => c.args?.includes('@upstash/context7-mcp') || c.name.toLowerCase().includes('context7'),
  );
}

// ============================================================
// Hook
// ============================================================

export function usePlugins(): UsePluginReturn {
  const { gitnexusAvailable, installStatus: gitnexusInstallStatus, installMessage: gitnexusInstallMessage, installGitnexus, refreshStatus } = useCodebaseIndex();
  const [mcpConfigs, setMcpConfigs] = useLocalStorage<McpServerConfig[]>('mcp-server-configs', []);

  const [eccInstalled, setEccInstalled] = useState(false);
  const [eccInstallStatus, setEccInstallStatus] = useState<PluginInstallStatus>('idle');
  const [eccInstallMessage, setEccInstallMessage] = useState('');

  // ---- ECC 初始化检测 ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<EccCheckResult>('ecc_check');
        if (cancelled) return;
        setEccInstalled(result.installed);
        if (result.installed) {
          setEccInstallStatus('installed');
        }
      } catch (err) {
        console.error('[usePlugins] ecc_check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- 监听 ECC 安装进度事件 ----
  useEffect(() => {
    let unlistenFn: UnlistenFn | null = null;
    listen<EccProgress>('ecc-install-progress', (event) => {
      const { status, message } = event.payload;
      if (status === 'running') {
        setEccInstallStatus('installing');
        setEccInstallMessage(message);
      } else if (status === 'done') {
        setEccInstallStatus('installed');
        setEccInstalled(true);
        setEccInstallMessage(message);
      } else if (status === 'error') {
        setEccInstallStatus('error');
        setEccInstallMessage(message);
      }
    }).then(fn => { unlistenFn = fn; });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // ---- 构建 pluginStates ----
  const gitnexusInstalled = gitnexusAvailable?.installed ?? false;
  const context7Installed = isContext7Installed(mcpConfigs);

  const pluginStates: Record<PluginId, PluginState> = {
    gitnexus: {
      installed: gitnexusInstalled,
      status: gitnexusInstallStatus as PluginInstallStatus,
      message: gitnexusInstallMessage,
    },
    context7: {
      installed: context7Installed,
      status: context7Installed ? 'installed' : 'idle',
    },
    ecc: {
      installed: eccInstalled,
      status: eccInstallStatus,
      message: eccInstallMessage,
    },
  };

  // ---- installPlugin ----
  const installPlugin = useCallback(async (id: PluginId) => {
    if (id === 'gitnexus') {
      await installGitnexus();
      return;
    }

    if (id === 'context7') {
      // 检查是否已存在
      if (isContext7Installed(mcpConfigs)) return;
      const newConfig: McpServerConfig = {
        id: generateId(),
        name: 'context7',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        enabled: true,
        createdAt: Date.now(),
      };
      setMcpConfigs(prev => [...prev, newConfig]);
      return;
    }

    if (id === 'ecc') {
      setEccInstallStatus('installing');
      setEccInstallMessage('');
      try {
        await invoke('ecc_install');
        // done 事件会更新状态，这里保底
      } catch (err) {
        setEccInstallStatus('error');
        setEccInstallMessage(String(err));
      }
      return;
    }
  }, [installGitnexus, mcpConfigs, setMcpConfigs]);

  // ---- uninstallPlugin ----
  const uninstallPlugin = useCallback(async (id: PluginId) => {
    if (id === 'gitnexus') {
      try {
        await invoke('gitnexus_uninstall');
        await refreshStatus();
      } catch (err) {
        console.error('[usePlugins] gitnexus_uninstall failed:', err);
      }
      return;
    }

    if (id === 'context7') {
      setMcpConfigs(prev => prev.filter(c =>
        !c.args?.includes('@upstash/context7-mcp') && !c.name.toLowerCase().includes('context7'),
      ));
      return;
    }

    if (id === 'ecc') {
      try {
        await invoke('ecc_uninstall');
        setEccInstalled(false);
        setEccInstallStatus('idle');
        setEccInstallMessage('');
      } catch (err) {
        console.error('[usePlugins] ecc_uninstall failed:', err);
        setEccInstallMessage(String(err));
      }
      return;
    }
  }, [mcpConfigs, setMcpConfigs, refreshStatus]);

  return { pluginStates, installPlugin, uninstallPlugin };
}
