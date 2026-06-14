import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sender } from '@ant-design/x';
import { FolderOpen, Code2, PanelRightOpen, PanelRightClose } from 'lucide-react';
import type { useWorkspaces } from '../hooks/useWorkspaces';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useResizable } from '../hooks/useResizable';
import { useAgentContext } from '../hooks/useAgentContext';
import AddRepoModal from './common/AddRepoModal';
import ModelSelector, { type ModelOption } from './common/ModelSelector';
import ContextIndicator from './common/ContextIndicator';
import WorkspaceSwitcher from './common/WorkspaceSwitcher';
import RightPanel from './RightPanel';
import AgentChat from './agent/AgentChat';
import ApiKeyModal from './settings/ApiKeyModal';
import Modal from './common/Modal';
import type { AgentQueryOptions, AgentMessage, UserMessage, ModelConfig, ProxyConfig, Repo, SpecGeneratingMessage, SpecConfirmationMessage } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../hooks/useTheme';
import { proxyConfigToEnvVars, proxyConfigFingerprint, DEFAULT_PROXY_CONFIG } from '../utils/proxy';
import { generateSpec, generateSpecFileName, extractSpecSummary } from '../utils/specGenerator';

interface ContentAreaProps {
  store: ReturnType<typeof useWorkspaces>;
  /** 打开设置页，可选指定子页面 section */
  onOpenSettings?: (section?: string) => void;
}


export default function ContentArea({ store, onOpenSettings }: ContentAreaProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [senderValue, setSenderValue] = useState('');

  // SendButton / LoadingButton 统一配色（兔子主题：胡萝卜橙）
  const sendBtnBg = senderValue.trim()
    ? (isDark ? '#F5824C' : '#E8702A')
    : (isDark ? '#555555' : '#C4C4C4');
  const sendBtnColor = '#ffffff';
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<Repo | null>(null);
  // 模型配置：从 localStorage 动态读取
  const [modelConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);
  const [selectedModelConfigId, setSelectedModelConfigId] = useLocalStorage<string>('selected-model-config-id', '');
  const [specEnabled, setSpecEnabled] = useState(false);
  const [specTabSignal, setSpecTabSignal] = useState(0);
  const [rightPanelVisible, setRightPanelVisible] = useLocalStorage<boolean>('right-panel-visible', false);
  const [rightPanelMaximized, setRightPanelMaximized] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
    const [noModelOpen, setNoModelOpen] = useState(false);
  // 存储当前待发送的查询，sidecar 就绪后自动发送
  const pendingQueryRef = useRef<(() => void) | null>(null);
  const [apiKey, setApiKey] = useLocalStorage<string>('anthropic-api-key', '');
  // 网络代理配置
  const [proxyConfig] = useLocalStorage<ProxyConfig>('proxy-config', DEFAULT_PROXY_CONFIG);
  // 记录 sidecar 启动时使用的代理指纹，用于检测变更触发重启
  const [appliedProxyFingerprint, setAppliedProxyFingerprint] = useLocalStorage<string>('proxy-applied-fingerprint', '');
  const { width: rightPanelWidth, isResizing: isPanelResizing, handleProps: panelHandleProps } = useResizable({
    storageKey: 'right-panel-width',
    defaultWidth: 500,
    minWidth: 500,
    maxWidthRatio: Infinity,
    reverse: true,
  });
  const selectedWorkspace = store.workspaces.find(p => p.id === store.selectedWorkspaceId);
  const selectedRabbit = selectedWorkspace?.rabbits.find(r => r.id === store.selectedRabbitId);

  // 派生：模型选择器选项（仅 enabled 的模型）
  const modelOptions: ModelOption[] = useMemo(
    () => modelConfigs
      .filter(c => c.enabled)
      .map(c => ({ id: c.id, label: c.name })),
    [modelConfigs]
  );

  // 当前选中的模型配置对象
  const selectedModelConfig = modelConfigs.find(c => c.id === selectedModelConfigId);

  // 传给 Agent SDK 的 model 字符串
  const effectiveModel = selectedModelConfig?.modelId ?? '';

  // selectedModelConfigId 失效回退（删除模型后自动选第一个）
  useEffect(() => {
    if (!selectedModelConfig && modelOptions.length > 0) {
      setSelectedModelConfigId(modelOptions[0].id);
    }
  }, [selectedModelConfig, modelOptions, setSelectedModelConfigId]);

  // 从全局 AgentProvider 获取 agent API（listener 在 App 层级，页面切换不丢失）
  const agent = useAgentContext();

  /**
   * 确保 sidecar 正在运行，然后执行查询
   * 优先使用模型配置中的 API Key 和环境变量；向后兼容旧 apiKey
   */
  const ensureSidecarAndQuery = useCallback(async (queryFn: () => void) => {
    // 1. 确定要使用的 API Key 和环境变量
    let effectiveApiKey = '';
    let effectiveBaseUrl: string | undefined;
    let effectiveEnvVars: Record<string, string> | undefined;

    if (selectedModelConfig) {
      // 使用模型配置
      effectiveApiKey = selectedModelConfig.apiKey;
      effectiveBaseUrl = selectedModelConfig.baseUrl;
      effectiveEnvVars = {
        [selectedModelConfig.apiKeyEnvVar]: selectedModelConfig.apiKey,
        ...selectedModelConfig.envVars,
      };
    } else {
      // 向后兼容：使用旧的全局 apiKey
      effectiveApiKey = apiKey;
    }

    // 2. 检查 API Key
    if (!effectiveApiKey) {
      pendingQueryRef.current = queryFn;
      setApiKeyModalOpen(true);
      return;
    }

    // 3. 合并代理环境变量（代理变量在前，模型配置 envVars 可覆盖）
    const proxyEnvVars = proxyConfigToEnvVars(proxyConfig);
    effectiveEnvVars = { ...proxyEnvVars, ...effectiveEnvVars };

    const currentProxyFingerprint = proxyConfigFingerprint(proxyConfig);

    // 4. 如果 sidecar 已在运行
    if (agent.sidecarStatus === 'running') {
      // 检测代理配置是否发生变化
      if (appliedProxyFingerprint && appliedProxyFingerprint !== currentProxyFingerprint) {
        // 代理配置已变更，需要重启 sidecar
        try {
          await agent.stopSidecar();
        } catch (err) {
          console.error('[ContentArea] Failed to stop sidecar for proxy change:', err);
        }
      } else {
        // 代理未变化，直接执行查询
        queryFn();
        return;
      }
    }

    // 5. 启动 sidecar
    try {
      await agent.startSidecar({
        apiKey: effectiveApiKey,
        baseUrl: effectiveBaseUrl,
        envVars: effectiveEnvVars,
      });
      // 记录当前代理指纹
      setAppliedProxyFingerprint(currentProxyFingerprint);
      // sidecar 就绪，执行查询
      queryFn();
    } catch (err) {
      console.error('[ContentArea] Failed to start sidecar:', err);
      // 标记错误到当前 rabbit
      const wsId = selectedWorkspace?.id;
      const rId = store.selectedRabbitId;
      if (wsId && rId) {
        store.updateRabbitAgent(wsId, rId, {
          status: 'error',
          error: `${t('contentArea.sidecarFailed')}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }, [apiKey, selectedModelConfig, agent, selectedWorkspace, store, t, proxyConfig, appliedProxyFingerprint, setAppliedProxyFingerprint]);

  /** API Key 弹窗关闭后，如果有 pending query 则执行 */
  const handleApiKeyModalClose = useCallback(() => {
    setApiKeyModalOpen(false);
    // 如果用户关闭弹窗但还没输入 key，清理 pending
    if (!apiKey) {
      pendingQueryRef.current = null;
    }
  }, [apiKey]);

  // 当 API Key 保存后，自动启动 sidecar 并执行 pending query
  const handleApiKeySavedAndStart = useCallback(async (key: string) => {
    setApiKey(key);
    setApiKeyModalOpen(false);
    const pending = pendingQueryRef.current;
    if (pending) {
      pendingQueryRef.current = null;
      try {
        await agent.startSidecar({ apiKey: key, envVars: proxyConfigToEnvVars(proxyConfig) });
        setAppliedProxyFingerprint(proxyConfigFingerprint(proxyConfig));
        pending();
      } catch (err) {
        console.error('[ContentArea] Failed to start sidecar after API key save:', err);
      }
    }
  }, [setApiKey, agent, proxyConfig]);

  /** 存储等待 Spec 确认的编码查询参数 */
  const pendingCodingQueryRef = useRef<Map<string, { prompt: string; cwd: string; model: string; specSessionId?: string }>>(new Map());

  /** Spec 确认后启动编码查询：resume spec 生成会话，保留完整探索上下文 */
  const handleSpecRun = useCallback((rabbitId: string) => {
    const params = pendingCodingQueryRef.current.get(rabbitId);
    if (!params || !selectedWorkspace) return;
    pendingCodingQueryRef.current.delete(rabbitId);

    store.updateRabbitAgent(selectedWorkspace.id, rabbitId, { status: 'running' });

    const options: AgentQueryOptions = {
      model: params.model,
      allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'],
      permissionMode: 'acceptEdits',
      maxTurns: 30,
    };

    ensureSidecarAndQuery(() => {
      if (params.specSessionId) {
        // Resume spec 生成会话：Agent 已有 spec 探索上下文，直接开始编码
        const implPrompt = 'The specification document has been confirmed. Now implement the full specification according to the plan described above. Use the available tools to create and edit files.';
        agent.resumeQuery(rabbitId, params.specSessionId, implPrompt, params.cwd, options);
      } else {
        // Fallback：spec 会话 ID 缺失时，使用原始 prompt 启动新查询
        agent.startQuery(rabbitId, params.prompt, params.cwd, options);
      }
    });
  }, [selectedWorkspace, store, agent, ensureSidecarAndQuery]);

  /**
   * Spec 生成期间的流式消息处理：将 AI 的输出（文本、思考、工具调用）追加到聊天流
   * 复用与 useAgentContext 相同的 delta 合并逻辑
   */
  const handleSpecStream = useCallback((wsId: string, rabbitId: string, msg: AgentMessage) => {
    switch (msg.type) {
      case 'assistant':
        if (msg.subtype === 'text_delta' || msg.subtype === 'thinking_delta') {
          store.appendDeltaToLastMessage(wsId, rabbitId, msg as any);
        } else if (msg.subtype === 'thinking_done') {
          store.updateThinkingDuration(wsId, rabbitId, (msg as any).durationMs);
        } else if (msg.subtype !== 'text_done') {
          // text / thinking / tool_use 等完整消息
          store.appendRabbitMessage(wsId, rabbitId, msg);
        }
        break;
      case 'tool_result':
        store.appendRabbitMessage(wsId, rabbitId, msg);
        break;
      case 'ask_user_question':
        // AskUserQuestion：追加到聊天流，AskUserQuestionBlock 组件会渲染交互卡片
        // respondToQuestion/cancelQuestion 通过 requestId 匹配 sidecar，与 queryId 无关
        store.appendRabbitMessage(wsId, rabbitId, msg);
        break;
      // system / result / error / 其他类型不转发到聊天流
    }
  }, [store]);

  const handleSubmit = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!selectedWorkspace || !trimmed) return;

    // 守卫：没有可用模型时拦截，弹出引导配置弹窗
    if (modelOptions.length === 0) {
      setNoModelOpen(true);
      return;
    }

    if (selectedRabbit && selectedRabbit.sessionId) {
      // Follow-up：恢复已有会话
      const wsId = selectedWorkspace.id;
      const rId = selectedRabbit.id;
      const model = effectiveModel;
      // 追加用户消息到聊天流
      const userMsg: UserMessage = { type: 'user', text: trimmed };
      store.appendRabbitMessage(wsId, rId, userMsg);
      store.updateRabbitAgent(wsId, rId, { status: 'running' });
      const cwd = selectedWorkspace.path || '.';
      ensureSidecarAndQuery(() => {
        const options: AgentQueryOptions = {
          model,
          allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'],
          permissionMode: 'acceptEdits',
          maxTurns: 30,
        };
        if (specEnabled) {
          // Spec 优先：仅生成 Spec，编码延迟到用户确认后
          const fileName = generateSpecFileName(trimmed);
          const specFilePath = `${cwd}/.rabbit/specs/${fileName}`;
          // 先显示 Spec 生成中状态
          const generatingMsg: SpecGeneratingMessage = { type: 'spec_generating' };
          store.appendRabbitMessage(wsId, rId, generatingMsg);
          const fallbackCoding = () => {
            store.updateRabbitAgent(wsId, rId, { status: 'running' });
            agent.resumeQuery(rId, selectedRabbit.sessionId!, trimmed, cwd, options);
          };
          invoke('ensure_rabbit_specs_dir', { path: cwd }).then(() => {
            generateSpec(agent.startQuery, trimmed, specFilePath, cwd, model, (msg: AgentMessage) => {
              handleSpecStream(wsId, rId, msg);
            }).then(({ content: specContent, sessionId: specSessionId, specFilePath: actualSpecFilePath }) => {
              console.log('[ContentArea] generateSpec resolved (follow-up):', { hasContent: !!specContent, actualSpecFilePath, fallbackSpecFilePath: specFilePath });
              if (specContent) {
                const finalSpecFilePath = actualSpecFilePath || specFilePath;
                const finalFileName = finalSpecFilePath.split('/').pop() || fileName;
                console.log('[ContentArea] Setting specFilePath on rabbit:', rId, finalSpecFilePath);
                pendingCodingQueryRef.current.set(rId, { prompt: trimmed, cwd, model, specSessionId: specSessionId ?? undefined });
                store.updateRabbitAgent(wsId, rId, { status: 'idle' });
                store.appendSpecPath(wsId, rId, finalSpecFilePath);
                const specMsg: SpecConfirmationMessage = {
                  type: 'spec_confirmation',
                  specFilePath: finalSpecFilePath,
                  specFileName: finalFileName,
                  specSummary: extractSpecSummary(specContent),
                };
                store.appendRabbitMessage(wsId, rId, specMsg);
                setRightPanelVisible(true);
                setSpecTabSignal(prev => prev + 1);
              } else {
                fallbackCoding();
              }
            }).catch(() => { fallbackCoding(); });
          }).catch(() => { fallbackCoding(); });
        } else {
          agent.resumeQuery(rId, selectedRabbit.sessionId!, trimmed, cwd, options);
        }
      });
    } else {
      // 新建 Rabbit + 启动 Agent
      const wsId = selectedWorkspace.id;
      const model = effectiveModel;
      const rabbitId = store.addRabbit(wsId, trimmed, model);
      // addRabbit 已内部调用 setSelectedRabbitId，无需再 selectRabbit
      // 追加用户消息到聊天流
      const userMsg: UserMessage = { type: 'user', text: trimmed };
      store.appendRabbitMessage(wsId, rabbitId, userMsg);
      store.updateRabbitAgent(wsId, rabbitId, { status: 'running' });
      const cwd = selectedWorkspace.path || '.';
      ensureSidecarAndQuery(() => {
        const options: AgentQueryOptions = {
          model,
          allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'],
          permissionMode: 'acceptEdits',
          maxTurns: 30,
        };
        if (specEnabled) {
          // Spec 优先：仅生成 Spec，编码延迟到用户确认后
          const fileName = generateSpecFileName(trimmed);
          const specFilePath = `${cwd}/.rabbit/specs/${fileName}`;
          // 先显示 Spec 生成中状态
          const generatingMsg: SpecGeneratingMessage = { type: 'spec_generating' };
          store.appendRabbitMessage(wsId, rabbitId, generatingMsg);
          const fallbackCoding = () => {
            store.updateRabbitAgent(wsId, rabbitId, { status: 'running' });
            agent.startQuery(rabbitId, trimmed, cwd, options);
          };
          invoke('ensure_rabbit_specs_dir', { path: cwd }).then(() => {
            generateSpec(agent.startQuery, trimmed, specFilePath, cwd, model, (msg: AgentMessage) => {
              handleSpecStream(wsId, rabbitId, msg);
            }).then(({ content: specContent, sessionId: specSessionId, specFilePath: actualSpecFilePath }) => {
              console.log('[ContentArea] generateSpec resolved (new rabbit):', { hasContent: !!specContent, actualSpecFilePath, fallbackSpecFilePath: specFilePath });
              if (specContent) {
                const finalSpecFilePath = actualSpecFilePath || specFilePath;
                const finalFileName = finalSpecFilePath.split('/').pop() || fileName;
                console.log('[ContentArea] Setting specFilePath on rabbit:', rabbitId, finalSpecFilePath);
                pendingCodingQueryRef.current.set(rabbitId, { prompt: trimmed, cwd, model, specSessionId: specSessionId ?? undefined });
                store.updateRabbitAgent(wsId, rabbitId, { status: 'idle' });
                store.appendSpecPath(wsId, rabbitId, finalSpecFilePath);
                const specMsg: SpecConfirmationMessage = {
                  type: 'spec_confirmation',
                  specFilePath: finalSpecFilePath,
                  specFileName: finalFileName,
                  specSummary: extractSpecSummary(specContent),
                };
                store.appendRabbitMessage(wsId, rabbitId, specMsg);
                setRightPanelVisible(true);
                setSpecTabSignal(prev => prev + 1);
              } else {
                fallbackCoding();
              }
            }).catch(() => { fallbackCoding(); });
          }).catch(() => { fallbackCoding(); });
        } else {
          agent.startQuery(rabbitId, trimmed, cwd, options);
        }
      });
    }
    setSenderValue('');
  }, [selectedWorkspace, selectedRabbit, effectiveModel, store, agent, ensureSidecarAndQuery, modelOptions, specEnabled]);

  const handleChange = useCallback((value: string) => {
    setSenderValue(value);
  }, []);

  /** 手动触发会话压缩 */
  const handleCompact = useCallback(() => {
    if (!selectedRabbit?.sessionId || !selectedWorkspace) return;
    const cwd = selectedWorkspace.path || '.';
    const options: AgentQueryOptions = {
      model: effectiveModel,
      allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'],
      permissionMode: 'acceptEdits',
      maxTurns: 30,
    };
    ensureSidecarAndQuery(() => {
      agent.compactQuery(selectedRabbit.id, selectedRabbit.sessionId!, cwd, options);
    });
  }, [selectedRabbit, selectedWorkspace, effectiveModel, agent, ensureSidecarAndQuery]);

  if (!selectedWorkspace) {
    return (
      <main className="flex-1 overflow-auto">
        <div data-tauri-drag-region className="h-[34px] shrink-0" />
        <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
          <p>{t('contentArea.selectWorkspace')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden rounded-tl-xl rounded-bl-xl border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]">
      {/* 标题栏 */}
      <div data-tauri-drag-region className="h-[42px] shrink-0 relative flex items-center">
        {selectedRabbit && (
          <>
            <span data-tauri-drag-region className="pl-4 text-[13px] font-semibold text-[#141414] dark:text-gray-200 truncate max-w-[60%]">{selectedRabbit.title}</span>
            {selectedWorkspace && (
              <span data-tauri-drag-region className="ml-3 text-xs text-[#959595] dark:text-gray-400 truncate flex items-center gap-1"><FolderOpen size={12} className="shrink-0" />{selectedWorkspace.name || t('common.unnamedWorkspace')}</span>
            )}
          </>
        )}
        <button
          onClick={() => {
            setRightPanelVisible(prev => !prev);
            setRightPanelMaximized(false);
          }}
          onMouseDown={e => e.stopPropagation()}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
        >
          {rightPanelVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </div>
      {/* 标题栏与内容区分割线 */}
      {rightPanelVisible && <div className="h-px bg-gray-200 dark:bg-gray-700" />}

      {/* 双栏容器 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：主内容区 */}
        <div className={`flex-1 min-w-[400px] flex flex-col ${
          rightPanelMaximized ? 'hidden' : ''
        }`}>
          {selectedRabbit ? (
            // 选中 Rabbit 时：显示 AgentChat
            <>
              {/* Agent 对话流 */}
              <div className="flex-1 overflow-hidden">
                <AgentChat rabbit={selectedRabbit} onSpecRun={handleSpecRun} />
              </div>

              {/* 底部输入框（follow-up） */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <Sender
                  value={senderValue}
                  onChange={handleChange}
                  onSubmit={handleSubmit}
                  loading={selectedRabbit?.status === 'running'}
                  onCancel={() => {
                    if (selectedRabbit) {
                      // 发送取消命令（context cancelQuery 内部已包含标记逻辑，过滤后续 abort 消息）
                      agent.cancelQuery(selectedRabbit.id);
                      // 置为 idle 停止生成，保留所有已有会话记录（含 AI 的部分回复）
                      // result 消息会被 cancelledQueryIdsRef 过滤，状态不会自动更新，因此手动置 idle
                      store.updateRabbitAgent(selectedWorkspace.id, selectedRabbit.id, {
                        status: 'idle',
                      });
                    }
                  }}
                  placeholder={t('contentArea.followUpPlaceholder')}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  suffix={false}
                  styles={{ footer: { paddingBottom: 6 } }}
                  footer={(_, { components: { SendButton, LoadingButton } }) => (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-0">
                        <ModelSelector value={selectedModelConfigId} options={modelOptions} onChange={setSelectedModelConfigId} onConfigure={() => onOpenSettings?.('models')} />
                        <div className="h-3 w-px bg-gray-200 dark:bg-gray-600 mx-1.5" />
                        <Sender.Switch
                          value={specEnabled}
                          onChange={setSpecEnabled}
                          unCheckedChildren={null}
                          checkedChildren="Spec"
                          icon={<Code2 size={11} />}
                          styles={{
                            root: { fontSize: 11, lineHeight: 1, transition: 'none' },
                            content: {
                              fontSize: 11,
                              lineHeight: 1,
                              padding: specEnabled ? '0 4px 0 2px' : '0',
                              height: 22,
                              minHeight: 22,
                              border: 'none',
                              background: 'transparent',
                              boxShadow: 'none',
                              transition: 'none',
                            },
                            icon: { fontSize: 11, marginRight: -4, transition: 'none' },
                            title: { fontSize: 11, transition: 'none' },
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ContextIndicator
                          tokenUsage={selectedRabbit?.currentUsage}
                          maxContextTokens={selectedModelConfig?.maxContextTokens}
                          compactionPhase={selectedRabbit?.compactionPhase}
                          status={selectedRabbit?.status}
                          onCompact={handleCompact}
                        />
                        {selectedRabbit?.status === 'running' ? (
                          <LoadingButton style={{ width: 22, height: 22, minWidth: 22, fontSize: 12, padding: 0, backgroundColor: sendBtnBg, color: sendBtnColor, border: 'none' }} />
                        ) : (
                          <SendButton style={{ width: 22, height: 22, minWidth: 22, backgroundColor: sendBtnBg, color: sendBtnColor, border: 'none' }} />
                        )}
                      </div>
                    </div>
                  )}
                />
              </div>
            </>
          ) : (
            // 未选中 Rabbit 时：显示欢迎页 + Sender
            <div className="flex-1 flex flex-col items-center justify-center px-6 pt-4 overflow-auto">
              <div className="w-full max-w-2xl flex flex-col items-center gap-3">
                <p className="text-lg font-medium text-[#141414] dark:text-gray-100 tracking-widest">
                  Hop On, Ship Out
                </p>
                <WorkspaceSwitcher
                  workspaces={store.workspaces}
                  selectedWorkspaceId={store.selectedWorkspaceId!}
                  onSelect={(id) => store.selectWorkspace(id)}
                />
              </div>
              <div className="w-full max-w-2xl mt-3">
                <Sender
                  value={senderValue}
                  onChange={handleChange}
                  onSubmit={handleSubmit}
                  placeholder={t('contentArea.inputPlaceholder')}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  suffix={false}
                  styles={{ footer: { paddingBottom: 6 } }}
                  footer={(_, { components: { SendButton } }) => (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-0">
                        <ModelSelector value={selectedModelConfigId} options={modelOptions} onChange={setSelectedModelConfigId} onConfigure={() => onOpenSettings?.('models')} />
                        <div className="h-3 w-px bg-gray-200 dark:bg-gray-600 mx-1.5" />
                        <Sender.Switch
                          value={specEnabled}
                          onChange={setSpecEnabled}
                          unCheckedChildren={null}
                          checkedChildren="Spec"
                          icon={<Code2 size={11} />}
                          styles={{
                            root: { fontSize: 11, lineHeight: 1, transition: 'none' },
                            content: {
                              fontSize: 11,
                              lineHeight: 1,
                              padding: specEnabled ? '0 4px 0 2px' : '0',
                              height: 22,
                              minHeight: 22,
                              border: 'none',
                              background: 'transparent',
                              boxShadow: 'none',
                              transition: 'none',
                            },
                            icon: { fontSize: 11, marginRight: -4, transition: 'none' },
                            title: { fontSize: 11, transition: 'none' },
                          }}
                        />
                      </div>
                      <SendButton style={{ width: 22, height: 22, minWidth: 22, backgroundColor: sendBtnBg, color: sendBtnColor, border: 'none' }} />
                    </div>
                  )}
                />
              </div>

            </div>
          )}
        </div>

        {/* 右侧面板 + 分割线 */}
        {rightPanelVisible && (
          <>
            {!rightPanelMaximized && (
              <div
                {...panelHandleProps}
                className={`w-1 shrink-0 cursor-col-resize transition-colors hover:bg-blue-500/40 ${
                  isPanelResizing ? 'bg-blue-500/40' : ''
                }`
              }
              />
            )}
            <div
              style={{ width: rightPanelMaximized ? '100%' : rightPanelWidth }}
              className={`shrink-0 overflow-auto bg-white dark:bg-[#1e1e1e] border-l border-gray-200 dark:border-gray-700 ${
                rightPanelMaximized ? '' : 'min-w-[500px]'
              }`}
            >
              <RightPanel
                specTabSignal={specTabSignal}
                maximized={rightPanelMaximized}
                onToggleMaximize={() => setRightPanelMaximized(prev => !prev)}
                selectedRabbit={selectedRabbit}
                workspacePath={selectedWorkspace?.path}
                workspaceId={selectedWorkspace?.id}
                onAddRepo={() => { setEditingRepo(null); setAddRepoOpen(true); }}
                onEditRepo={(repo) => { setEditingRepo(repo); setAddRepoOpen(true); }}
                onDeleteRepo={(repoId) => store.deleteRepo(selectedWorkspace.id, repoId)}
              />
            </div>
          </>
        )}
      </div>

      <AddRepoModal
        open={addRepoOpen}
        repo={editingRepo}
        onClose={() => setAddRepoOpen(false)}
        onSubmit={(name, path) => {
          if (editingRepo) {
            store.updateRepo(selectedWorkspace.id, editingRepo.id, { name, path });
          } else {
            store.addRepo(selectedWorkspace.id, name, path);
          }
        }}
      />

      <ApiKeyModal
        open={apiKeyModalOpen}
        onClose={handleApiKeyModalClose}
        onSave={handleApiKeySavedAndStart}
      />

      {/* 无可用模型提示弹窗 */}
      <Modal open={noModelOpen} onClose={() => setNoModelOpen(false)} title={t('noModelModal.title')} widthClassName="w-[400px]">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {t('noModelModal.description')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setNoModelOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
            >
              {t('noModelModal.cancel')}
            </button>
            <button
              onClick={() => {
                setNoModelOpen(false);
                onOpenSettings?.('models');
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
            >
              {t('noModelModal.goConfig')}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
