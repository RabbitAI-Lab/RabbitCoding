import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sender } from '@ant-design/x';
import { FolderOpen, Code2, PanelRightOpen, PanelRightClose, Wand2, Loader2 } from 'lucide-react';
import type { useWorkspaces } from '../hooks/useWorkspaces';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useResizable } from '../hooks/useResizable';
import { useAgentContext } from '../hooks/useAgentContext';
import { useOptimizePrompt } from '../hooks/useOptimizePrompt';
import AddRepoModal from './common/AddRepoModal';
import ModelSelector, { type ModelOption } from './common/ModelSelector';
import Tooltip from './common/Tooltip';
import ContextIndicator from './common/ContextIndicator';
import WorkspaceSwitcher from './common/WorkspaceSwitcher';
import ModeSwitcher, { type WorktreeMode } from './common/ModeSwitcher';
import VoiceInputButton from './common/VoiceInputButton';
import RightPanel from './RightPanel';
import AgentChat from './agent/AgentChat';
import ApiKeyModal from './settings/ApiKeyModal';
import Modal from './common/Modal';
import type { AgentQueryOptions, AgentMessage, UserMessage, ModelConfig, ProxyConfig, Repo, SpecGeneratingMessage, SpecConfirmationMessage, KnowledgeBaseConfig, WorktreeInfo, CreateWorktreeInput, CreateWorktreeOutput } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from '../i18n/useI18n';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useOnlineModels } from '../hooks/useOnlineModels';
import { isOnlineModelId, buildOnlineModelConfig, extractModelIdFromOnline, NOT_AUTHENTICATED } from '../utils/portalClient';
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

  // SendButton / LoadingButton 统一配色（兔子主题：胡萝卜橙，接入 CSS 变量）
  const sendBtnBg = senderValue.trim()
    ? 'var(--brand-solid)'
    : (isDark ? '#555555' : '#C4C4C4');
  const sendBtnColor = '#ffffff';
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<Repo | null>(null);
  // 模型配置：从 localStorage 动态读取
  const [modelConfigs] = useLocalStorage<ModelConfig[]>('model-configs', []);
  const [selectedModelConfigId, setSelectedModelConfigId] = useLocalStorage<string>('selected-model-config-id', '');
  const [knowledgeBaseConfigs] = useLocalStorage<Record<string, KnowledgeBaseConfig>>('knowledge-base-configs', {});
  const [specEnabled, setSpecEnabled] = useState(false);
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [specTabSignal, setSpecTabSignal] = useState(0);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [rightPanelMaximized, setRightPanelMaximized] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
    const [noModelOpen, setNoModelOpen] = useState(false);
    // 线上模型登录引导弹窗
    const [loginGuideOpen, setLoginGuideOpen] = useState(false);
    // 获取 AI 转发 Key 失败提示
    const [getKeyErrorOpen, setGetKeyErrorOpen] = useState(false);
  // 存储当前待发送的查询，sidecar 就绪后自动发送
  const pendingQueryRef = useRef<(() => void) | null>(null);

  // 跟踪 IME 输入法刚结束的状态
  // macOS WebKit 下 compositionend 先于 keydown(Enter) 触发，导致 isComposing 已变 false
  // 通过监听 compositionend 并延迟重置，让后续的 Enter keydown 仍能检测到 IME 刚结束
  const imeJustComposedRef = useRef(false);

  useEffect(() => {
    const handleCompositionEnd = () => {
      imeJustComposedRef.current = true;
      // 延迟重置：确保同一事件循环中紧跟的 Enter keydown 能检测到
      const timer = window.setTimeout(() => {
        imeJustComposedRef.current = false;
      }, 200);
      return () => window.clearTimeout(timer);
    };
    document.addEventListener('compositionend', handleCompositionEnd, true);
    return () => document.removeEventListener('compositionend', handleCompositionEnd, true);
  }, []);
  const [apiKey, setApiKey] = useLocalStorage<string>('anthropic-api-key', '');
  // 线上模型与 AI 转发 Key
  const auth = useAuth();
  const {
    onlineModels,
    loading: onlineModelsLoading,
    aiForwardingKey,
    ensureAiForwardingKey,
    refreshModels: refreshOnlineModels,
  } = useOnlineModels();
  // 网络代理配置
  const [proxyConfig] = useLocalStorage<ProxyConfig>('proxy-config', DEFAULT_PROXY_CONFIG);
  // 记录 sidecar 启动时使用的代理指纹，用于检测变更触发重启
  const [appliedProxyFingerprint, setAppliedProxyFingerprint] = useLocalStorage<string>('proxy-applied-fingerprint', '');
  // 记录 sidecar 启动时使用的模型配置指纹（baseUrl + apiKey 前缀），用于检测模型切换触发重启
  const [appliedModelFingerprint, setAppliedModelFingerprint] = useLocalStorage<string>('applied-model-fingerprint', '');
  const { width: rightPanelWidth, isResizing: isPanelResizing, handleProps: panelHandleProps } = useResizable({
    storageKey: 'right-panel-width',
    defaultWidth: 400,
    minWidth: 400,
    maxWidthRatio: Infinity,
    reverse: true,
  });
  const selectedWorkspace = store.workspaces.find(p => p.id === store.selectedWorkspaceId);
  const selectedRabbit = selectedWorkspace?.rabbits.find(r => r.id === store.selectedRabbitId);

  const withKnowledgeBaseReference = useCallback((prompt: string) => {
    if (!selectedWorkspace?.id || !selectedWorkspace.path) return prompt;
    const config = knowledgeBaseConfigs[selectedWorkspace.id];
    if (!config?.referenceEnabled) return prompt;

    const codeWikiDir = `${selectedWorkspace.path}/.rabbit/codewiki`;
    return `${prompt}

Knowledge base reference:
The workspace Code Wiki is enabled at ${codeWikiDir}. When useful for the task, search and read files in that directory with the available filesystem tools before answering or editing code. Treat those files as project context and cite paths when relying on them.`;
  }, [knowledgeBaseConfigs, selectedWorkspace?.id, selectedWorkspace?.path]);

  // 派生：线上模型选项（最新模型 Tab）
  const onlineModelOptions: ModelOption[] = useMemo(
    () => onlineModels.map(m => ({ id: `__online__:${m.id}`, label: m.displayName || m.id })),
    [onlineModels]
  );

  // 派生：自定义模型选项（仅 enabled 的模型）
  const modelOptions: ModelOption[] = useMemo(
    () => modelConfigs
      .filter(c => c.enabled)
      .map(c => ({ id: c.id, label: c.name })),
    [modelConfigs]
  );

  // 当前选中的模型配置对象（自定义模型 或 线上虚拟模型）
  const selectedModelConfig = useMemo(() => {
    if (isOnlineModelId(selectedModelConfigId)) {
      // 线上虚拟模型：从 onlineModels 找到对应 model，构造虚拟配置
      const modelId = extractModelIdFromOnline(selectedModelConfigId);
      const model = onlineModels.find(m => m.id === modelId);
      if (model) {
        return buildOnlineModelConfig(model, aiForwardingKey);
      }
      return undefined;
    }
    return modelConfigs.find(c => c.id === selectedModelConfigId);
  }, [selectedModelConfigId, onlineModels, aiForwardingKey, modelConfigs]);

  // 传给 Agent SDK 的 model 字符串
  const effectiveModel = selectedModelConfig?.modelId ?? '';

  // selectedModelConfigId 失效回退（删除模型后自动选第一个）
  // 仅当自定义模型与线上模型均无选中时回退到第一个自定义模型
  useEffect(() => {
    if (!selectedModelConfig && modelOptions.length > 0 && !isOnlineModelId(selectedModelConfigId)) {
      setSelectedModelConfigId(modelOptions[0].id);
    }
  }, [selectedModelConfig, modelOptions, selectedModelConfigId, setSelectedModelConfigId]);

  // 是否选中了线上模型
  const isOnlineSelected = isOnlineModelId(selectedModelConfigId);

  // 登录后自动获取 AI 转发 Key（并消费 pending query）
  useEffect(() => {
    if (auth.user?.accessToken && isOnlineSelected && !aiForwardingKey) {
      ensureAiForwardingKey()
        .then(() => {
          console.debug('[ContentArea] AI forwarding key acquired after login');
          // 若有 pending query 则执行
          const pending = pendingQueryRef.current;
          if (pending) {
            pendingQueryRef.current = null;
            pending();
          }
        })
        .catch(err => {
          console.error('[ContentArea] ensureAiForwardingKey after login failed:', err);
          // 401 = Casdoor token 过期 → 弹重新登录引导；其他错误 → 弹获取凭证失败
          if ((err as Error & { code?: string }).code === NOT_AUTHENTICATED) {
            setLoginGuideOpen(true);
          } else {
            setGetKeyErrorOpen(true);
          }
        });
    }
  }, [auth.user, isOnlineSelected, aiForwardingKey, ensureAiForwardingKey]);

  // 从全局 AgentProvider 获取 agent API（listener 在 App 层级，页面切换不丢失）
  const agent = useAgentContext();

  // 提示词优化：直接调用 Provider，不走 sidecar
  const optimize = useOptimizePrompt();

  /**
   * 优化提示词：调用当前选中模型的厂商 API，把输入框内容改写为结构化提示词后直接回填
   */
  const handleOptimizePrompt = useCallback(async () => {
    if (!selectedModelConfig) return;
    const trimmed = senderValue.trim();
    if (!trimmed) return;

    const result = await optimize.runOptimize({
      baseUrl: selectedModelConfig.baseUrl,
      apiKey: selectedModelConfig.apiKey,
      modelId: selectedModelConfig.modelId,
      prompt: trimmed,
    });

    if (result.success && result.optimizedPrompt) {
      setSenderValue(result.optimizedPrompt);
    } else {
      console.error('[ContentArea] Optimize prompt failed:', result.error);
    }
  }, [selectedModelConfig, senderValue, optimize]);

  /**
   * 语音识别文本回填：VoiceInputButton 内部管理前缀累积，这里直接设置 senderValue
   */
  const handleVoiceText = useCallback((text: string, _isFinal: boolean) => {
    setSenderValue(text);
  }, []);

  /**
   * 选中模型：自定义模型直接设置；线上模型选中时自动获取 AI 转发 Key
   */
  const handleSelectModel = useCallback((id: string) => {
    setSelectedModelConfigId(id);
    // 选中的是线上模型 → 确保已有 AI 转发 Key
    if (isOnlineModelId(id)) {
      if (!aiForwardingKey) {
        if (auth.user?.accessToken) {
          // 已登录但未缓存 Key → 用 Casdoor accessToken 换取
          ensureAiForwardingKey().catch(err => {
            console.error('[ContentArea] ensureAiForwardingKey on select failed:', err);
            // 401 = Casdoor token 过期 → 弹重新登录引导；其他错误 → 弹获取凭证失败
            if ((err as Error & { code?: string }).code === NOT_AUTHENTICATED) {
              setLoginGuideOpen(true);
            } else {
              setGetKeyErrorOpen(true);
            }
          });
        } else {
          // 未登录 → 弹出登录引导
          setLoginGuideOpen(true);
        }
      }
      // 刷新线上模型列表，确保选中项有效
      void refreshOnlineModels(true);
    }
  }, [setSelectedModelConfigId, aiForwardingKey, auth.user, ensureAiForwardingKey, refreshOnlineModels]);

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
      // 线上模型无 key → 弹出登录引导（而非旧版 ApiKeyModal）
      if (isOnlineModelId(selectedModelConfigId)) {
        if (auth.user?.accessToken) {
          // 已登录 → 尝试获取 AI 转发 Key
          ensureAiForwardingKey()
            .then(() => {
              const pending = pendingQueryRef.current;
              if (pending) {
                pendingQueryRef.current = null;
                pending();
              }
            })
            .catch(err => {
              console.error('[ContentArea] ensureAiForwardingKey in guard failed:', err);
              // 401 = Casdoor token 过期 → 弹重新登录引导；其他错误 → 弹获取凭证失败
              if ((err as Error & { code?: string }).code === NOT_AUTHENTICATED) {
                setLoginGuideOpen(true);
              } else {
                setGetKeyErrorOpen(true);
              }
            });
        } else {
          // 未登录 → 弹出登录引导
          setLoginGuideOpen(true);
        }
      } else {
        setApiKeyModalOpen(true);
      }
      return;
    }

    // 3. 合并代理环境变量（代理变量在前，模型配置 envVars 可覆盖）
    const proxyEnvVars = proxyConfigToEnvVars(proxyConfig);
    effectiveEnvVars = { ...proxyEnvVars, ...effectiveEnvVars };

    const currentProxyFingerprint = proxyConfigFingerprint(proxyConfig);
    // 模型配置指纹：baseUrl + apiKey 前缀（不含完整 key，安全存储）
    const currentModelFingerprint = `${effectiveBaseUrl ?? ''}::${effectiveApiKey.slice(0, 12)}`;

    // 4. 如果 sidecar 已在运行
    if (agent.sidecarStatus === 'running') {
      // 检测代理配置或模型配置是否发生变化
      const proxyChanged = appliedProxyFingerprint && appliedProxyFingerprint !== currentProxyFingerprint;
      const modelChanged = appliedModelFingerprint && appliedModelFingerprint !== currentModelFingerprint;
      if (proxyChanged || modelChanged) {
        // 配置已变更，需要重启 sidecar
        console.debug('[ContentArea] Restarting sidecar due to config change:', { proxyChanged, modelChanged });
        try {
          await agent.stopSidecar();
        } catch (err) {
          console.error('[ContentArea] Failed to stop sidecar for config change:', err);
        }
      } else {
        // 配置未变化，直接执行查询
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
      // 记录当前代理指纹和模型配置指纹
      setAppliedProxyFingerprint(currentProxyFingerprint);
      setAppliedModelFingerprint(currentModelFingerprint);
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
  }, [apiKey, selectedModelConfig, agent, selectedWorkspace, store, t, proxyConfig, appliedProxyFingerprint, setAppliedProxyFingerprint, appliedModelFingerprint, setAppliedModelFingerprint, selectedModelConfigId, auth.user, ensureAiForwardingKey]);

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
        const baseUrl = selectedModelConfig?.baseUrl;
        await agent.startSidecar({ apiKey: key, baseUrl, envVars: proxyConfigToEnvVars(proxyConfig) });
        setAppliedProxyFingerprint(proxyConfigFingerprint(proxyConfig));
        setAppliedModelFingerprint(`${baseUrl ?? ''}::${key.slice(0, 12)}`);
        pending();
      } catch (err) {
        console.error('[ContentArea] Failed to start sidecar after API key save:', err);
      }
    }
  }, [setApiKey, agent, proxyConfig, selectedModelConfig, setAppliedProxyFingerprint, setAppliedModelFingerprint]);

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
      const cwd = selectedRabbit?.worktree?.basePath || params.cwd;
      if (params.specSessionId) {
        // Resume spec 生成会话：Agent 已有 spec 探索上下文，直接开始编码
        const implPrompt = 'The specification document has been confirmed. Now implement the full specification according to the plan described above. Use the available tools to create and edit files.';
        agent.resumeQuery(rabbitId, params.specSessionId, implPrompt, cwd, options);
      } else {
        // Fallback：spec 会话 ID 缺失时，使用原始 prompt 启动新查询
        agent.startQuery(rabbitId, params.prompt, cwd, options);
      }
    });
  }, [selectedWorkspace, selectedRabbit, store, agent, ensureSidecarAndQuery]);

  /** 跟踪当前编辑的 checkpoint userMessageId（点击 user 消息后设置，发送时消费） */
  const editingCheckpointRef = useRef<string | undefined>(undefined);

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

  /**
   * Worktree 模式下解析 cwd：创建 worktree 镜像并返回镜像路径；
   * 非 worktree 模式返回 workspace 原始路径
   */
  const resolveCwd = useCallback(async (): Promise<{ cwd: string; worktree?: WorktreeInfo }> => {
    if (!worktreeEnabled || !selectedWorkspace?.repos?.length || !selectedWorkspace.path) {
      return { cwd: selectedWorkspace?.path || '.' };
    }
    try {
      const input: CreateWorktreeInput = {
        workspacePath: selectedWorkspace.path,
        repos: selectedWorkspace.repos.map(r => ({ repoId: r.id, repoName: r.name, path: r.path })),
      };
      const result = await invoke<CreateWorktreeOutput>('create_worktree', { input });
      const worktree: WorktreeInfo = {
        basePath: result.basePath,
        branch: result.branch,
        repos: result.repos,
        createdAt: Date.now(),
      };
      return { cwd: result.basePath, worktree };
    } catch (err) {
      console.error('[ContentArea] create_worktree failed, falling back to workspace path:', err);
      return { cwd: selectedWorkspace.path };
    }
  }, [worktreeEnabled, selectedWorkspace]);

  const handleSubmit = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!selectedWorkspace || !trimmed) return;

    // 守卫：没有可用模型时拦截，弹出引导配置弹窗
    if (modelOptions.length === 0) {
      setNoModelOpen(true);
      return;
    }

    const agentPrompt = withKnowledgeBaseReference(trimmed);

    // Checkpoint rewind：从 user 消息编辑重发
    const checkpointUserMessageId = editingCheckpointRef.current;
    editingCheckpointRef.current = undefined;
    const isRewindFromCheckpoint = !!checkpointUserMessageId;

    if (isRewindFromCheckpoint && selectedRabbit && selectedRabbit.sessionId) {
      // 1. 异步恢复文件（fire and forget，rewind_result 通过事件流处理）
      const rewindCwd = selectedRabbit.worktree?.basePath || selectedWorkspace.path || '';
      agent.rewindFiles(selectedRabbit.id, selectedRabbit.sessionId, checkpointUserMessageId, rewindCwd).catch(err => {
        console.error('[ContentArea] rewindFiles failed:', err);
      });
      // 2. 截断该消息及之后所有消息，重置 sessionId
      store.truncateFromMessage(selectedWorkspace.id, selectedRabbit.id, checkpointUserMessageId);
    }

    if (selectedRabbit && (selectedRabbit.sessionId || isRewindFromCheckpoint)) {
      // Follow-up：恢复已有会话
      const wsId = selectedWorkspace.id;
      const rId = selectedRabbit.id;
      const model = effectiveModel;
      // 追加用户消息到聊天流
      const userMsg: UserMessage = { type: 'user', text: trimmed };
      store.appendRabbitMessage(wsId, rId, userMsg);
      store.updateRabbitAgent(wsId, rId, { status: 'running' });
      const specBasePath = selectedWorkspace.path || '.';
      // Worktree：已有 worktree 则复用 basePath，否则按需创建
      let cwd = specBasePath;
      if (selectedRabbit.worktree) {
        cwd = selectedRabbit.worktree.basePath;
      } else if (worktreeEnabled && (selectedWorkspace.repos?.length ?? 0) > 0 && selectedWorkspace.path) {
        try {
          const { cwd: wtCwd, worktree: wt } = await resolveCwd();
          cwd = wtCwd;
          if (wt) store.updateRabbitAgent(wsId, rId, { worktree: wt });
        } catch (err) {
          console.error('[ContentArea] create_worktree failed:', err);
        }
      }
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
          const specFilePath = `${specBasePath}/.rabbit/specs/${fileName}`;
          // 先显示 Spec 生成中状态
          const generatingMsg: SpecGeneratingMessage = { type: 'spec_generating' };
          store.appendRabbitMessage(wsId, rId, generatingMsg);
          const fallbackCoding = () => {
            store.updateRabbitAgent(wsId, rId, { status: 'running' });
            agent.resumeQuery(rId, selectedRabbit.sessionId!, agentPrompt, cwd, options);
          };
          invoke('ensure_rabbit_specs_dir', { path: specBasePath }).then(() => {
            generateSpec(agent.startQuery, agentPrompt, specFilePath, cwd, model, (msg: AgentMessage) => {
              handleSpecStream(wsId, rId, msg);
            }).then(({ content: specContent, sessionId: specSessionId, specFilePath: actualSpecFilePath }) => {
              console.log('[ContentArea] generateSpec resolved (follow-up):', { hasContent: !!specContent, actualSpecFilePath, fallbackSpecFilePath: specFilePath });
              if (specContent) {
                const finalSpecFilePath = actualSpecFilePath || specFilePath;
                const finalFileName = finalSpecFilePath.split('/').pop() || fileName;
                console.log('[ContentArea] Setting specFilePath on rabbit:', rId, finalSpecFilePath);
                pendingCodingQueryRef.current.set(rId, { prompt: agentPrompt, cwd, model, specSessionId: specSessionId ?? undefined });
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
          if (isRewindFromCheckpoint) {
            // Checkpoint rewind 后：sessionId 已重置，用 startQuery 启动新会话
            agent.startQuery(rId, agentPrompt, cwd, options);
          } else {
            agent.resumeQuery(rId, selectedRabbit.sessionId!, agentPrompt, cwd, options);
          }
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
      const specBasePath = selectedWorkspace.path || '.';
      // Worktree：按需创建镜像
      let cwd = specBasePath;
      let worktree: WorktreeInfo | undefined;
      if (worktreeEnabled && (selectedWorkspace.repos?.length ?? 0) > 0 && selectedWorkspace.path) {
        try {
          const result = await resolveCwd();
          cwd = result.cwd;
          worktree = result.worktree;
        } catch (err) {
          console.error('[ContentArea] create_worktree failed:', err);
        }
      }
      store.updateRabbitAgent(wsId, rabbitId, { status: 'running', worktree });
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
          const specFilePath = `${specBasePath}/.rabbit/specs/${fileName}`;
          // 先显示 Spec 生成中状态
          const generatingMsg: SpecGeneratingMessage = { type: 'spec_generating' };
          store.appendRabbitMessage(wsId, rabbitId, generatingMsg);
          const fallbackCoding = () => {
            store.updateRabbitAgent(wsId, rabbitId, { status: 'running' });
            agent.startQuery(rabbitId, agentPrompt, cwd, options);
          };
          invoke('ensure_rabbit_specs_dir', { path: specBasePath }).then(() => {
            generateSpec(agent.startQuery, agentPrompt, specFilePath, cwd, model, (msg: AgentMessage) => {
              handleSpecStream(wsId, rabbitId, msg);
            }).then(({ content: specContent, sessionId: specSessionId, specFilePath: actualSpecFilePath }) => {
              console.log('[ContentArea] generateSpec resolved (new rabbit):', { hasContent: !!specContent, actualSpecFilePath, fallbackSpecFilePath: specFilePath });
              if (specContent) {
                const finalSpecFilePath = actualSpecFilePath || specFilePath;
                const finalFileName = finalSpecFilePath.split('/').pop() || fileName;
                console.log('[ContentArea] Setting specFilePath on rabbit:', rabbitId, finalSpecFilePath);
                pendingCodingQueryRef.current.set(rabbitId, { prompt: agentPrompt, cwd, model, specSessionId: specSessionId ?? undefined });
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
          agent.startQuery(rabbitId, agentPrompt, cwd, options);
        }
      });
    }
    setSenderValue('');
  }, [selectedWorkspace, selectedRabbit, effectiveModel, store, agent, ensureSidecarAndQuery, modelOptions, specEnabled, worktreeEnabled, withKnowledgeBaseReference, resolveCwd]);

  /** 点击 user 消息 inline 编辑后发送 → 直接触发 rewind + 重发 */
  const handleEditUserMessage = useCallback((text: string, userMessageId?: string) => {
    editingCheckpointRef.current = userMessageId;
    handleSubmit(text);
  }, [handleSubmit]);

  const handleChange = useCallback((value: string) => {
    setSenderValue(value);
  }, []);

  // 中文输入法正在输入时，回车用于确认候选词，不发送消息
  const handleSenderKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // IME 刚结束组合（compositionend 刚触发）或仍在组合中 → 阻止发送
      if (imeJustComposedRef.current || e.nativeEvent.isComposing) {
        imeJustComposedRef.current = false;
        return false;
      }
    }
  }, []);

  /** 手动触发会话压缩 */
  const handleCompact = useCallback(() => {
    if (!selectedRabbit?.sessionId || !selectedWorkspace) return;
    const cwd = selectedRabbit?.worktree?.basePath || selectedWorkspace.path || '.';
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

  /** 共享的 Sender footer 渲染函数：底部 Sender 和 inline 编辑 Sender 都复用此函数 */
  const renderSenderFooter = useCallback((
    ctx: { value: string; components: { SendButton: React.ComponentType<any>; LoadingButton: React.ComponentType<any> }; showUsage?: boolean }
  ): React.ReactNode => {
    const { value: footerValue, components: { SendButton, LoadingButton }, showUsage = true } = ctx;
    const footerSendBtnBg = footerValue.trim()
      ? 'var(--brand-solid)'
      : (isDark ? '#555555' : '#C4C4C4');
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0">
          <ModelSelector value={selectedModelConfigId} options={modelOptions} onChange={handleSelectModel} onConfigure={() => onOpenSettings?.('models')} onlineModels={onlineModelOptions} onlineLoading={onlineModelsLoading} />
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
                fontSize: 11, lineHeight: 1,
                padding: specEnabled ? '0 4px 0 2px' : '0',
                height: 22, minHeight: 22,
                border: 'none', background: 'transparent', boxShadow: 'none', transition: 'none',
              },
              icon: { fontSize: 11, marginRight: -4, transition: 'none' },
              title: { fontSize: 11, transition: 'none' },
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {showUsage && (
            <ContextIndicator
              tokenUsage={selectedRabbit?.currentUsage}
              maxContextTokens={selectedModelConfig?.maxContextTokens}
              compactionPhase={selectedRabbit?.compactionPhase}
              status={selectedRabbit?.status}
              onCompact={handleCompact}
            />
          )}
          <Tooltip
            content={
              !footerValue.trim()
                ? t('contentArea.optimizePromptEmpty')
                : !selectedModelConfig || !selectedModelConfig.apiKey
                  ? t('contentArea.optimizePromptNoModel')
                  : t('contentArea.optimizePrompt')
            }
          >
            <button
              type="button"
              onClick={handleOptimizePrompt}
              disabled={!footerValue.trim() || !selectedModelConfig || !selectedModelConfig.apiKey || optimize.state.status === 'loading'}
              className="flex items-center justify-center text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {optimize.state.status === 'loading'
                ? <Loader2 size={14} className="animate-spin" />
                : <Wand2 size={14} />}
            </button>
          </Tooltip>
          <VoiceInputButton onText={handleVoiceText} currentText={footerValue} />
          {selectedRabbit?.status === 'running' ? (
            <LoadingButton style={{ width: 20, height: 20, minWidth: 20, fontSize: 12, padding: 0, backgroundColor: footerSendBtnBg, color: sendBtnColor, border: 'none' }} />
          ) : (
            <SendButton style={{ width: 20, height: 20, minWidth: 20, fontSize: 12, padding: 0, backgroundColor: footerSendBtnBg, color: sendBtnColor, border: 'none' }} />
          )}
        </div>
      </div>
    );
  }, [selectedModelConfigId, modelOptions, specEnabled, selectedRabbit, selectedModelConfig, optimize.state.status, isDark, sendBtnColor, handleCompact, handleOptimizePrompt, handleVoiceText, onOpenSettings, t, handleSelectModel, onlineModelOptions, onlineModelsLoading]);

  /** 清理 worktree 镜像 */
  const handleClearWorktree = useCallback(async () => {
    if (!selectedRabbit?.worktree || !selectedWorkspace?.path) return;
    const wt = selectedRabbit.worktree;
    try {
      await invoke('remove_worktree', {
        input: { workspacePath: selectedWorkspace.path, branch: wt.branch, force: true },
      });
    } catch (err) {
      console.error('[ContentArea] remove_worktree failed:', err);
    }
    store.clearWorktree(selectedWorkspace.id, selectedRabbit.id);
  }, [selectedRabbit, selectedWorkspace, store]);

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
                <AgentChat rabbit={selectedRabbit} onSpecRun={handleSpecRun} onEditUserMessage={handleEditUserMessage} renderSenderFooter={renderSenderFooter} />
              </div>

              {/* 底部输入框（follow-up） */}
              <div className="px-4 py-3">
                <Sender
                  value={senderValue}
                  onChange={handleChange}
                  onSubmit={handleSubmit}
                  onKeyDown={handleSenderKeyDown}
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
                  autoSize={{ minRows: 3, maxRows: 10 }}
                  suffix={false}
                  styles={{ content: { paddingTop: 2 }, footer: { paddingBottom: 6 } }}
                  footer={(_, { components: { SendButton, LoadingButton } }) =>
                    renderSenderFooter({ value: senderValue, components: { SendButton, LoadingButton } })
                  }
                />
              </div>
            </>
          ) : (
            // 未选中 Rabbit 时：显示欢迎页 + Sender
            <div className="flex-1 flex items-center justify-center px-6 overflow-auto">
              <div className="w-full max-w-2xl relative">
                {/* 标题：absolute 脱离文档流，bottom-full 紧贴 Sender 容器顶部上方，mb-3 留间距，不参与居中计算 */}
                <div className="absolute bottom-full left-0 right-0 flex flex-col items-center gap-3 mb-3">
                  <p className="text-2xl font-medium text-[#141414] dark:text-gray-100 tracking-widest">
                    Hop On, Ship Out
                  </p>
                  <div className="flex items-center gap-2">
                    <WorkspaceSwitcher
                      workspaces={store.workspaces}
                      selectedWorkspaceId={store.selectedWorkspaceId!}
                      onSelect={(id) => store.selectWorkspace(id)}
                    />
                    <div style={{ marginLeft: -15 }}>
                      <ModeSwitcher
                        mode={worktreeEnabled ? 'worktree' : 'local'}
                        onChange={(mode: WorktreeMode) => setWorktreeEnabled(mode === 'worktree')}
                        hasRepos={(selectedWorkspace?.repos?.length ?? 0) > 0}
                      />
                    </div>
                  </div>
                </div>
                <Sender
                  value={senderValue}
                  onChange={handleChange}
                  onSubmit={handleSubmit}
                  onKeyDown={handleSenderKeyDown}
                  placeholder={t('contentArea.inputPlaceholder')}
                  autoSize={{ minRows: 3, maxRows: 10 }}
                  suffix={false}
                  styles={{ content: { paddingTop: 2 }, footer: { paddingBottom: 6 } }}
                  footer={(_, { components: { SendButton } }) => (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-0">
                        <ModelSelector value={selectedModelConfigId} options={modelOptions} onChange={handleSelectModel} onConfigure={() => onOpenSettings?.('models')} onlineModels={onlineModelOptions} onlineLoading={onlineModelsLoading} />
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
                        <VoiceInputButton onText={handleVoiceText} currentText={senderValue} />
                        <Tooltip
                          content={
                            !senderValue.trim()
                              ? t('contentArea.optimizePromptEmpty')
                              : !selectedModelConfig || !selectedModelConfig.apiKey
                                ? t('contentArea.optimizePromptNoModel')
                                : t('contentArea.optimizePrompt')
                          }
                        >
                          <button
                            type="button"
                            onClick={handleOptimizePrompt}
                            disabled={!senderValue.trim() || !selectedModelConfig || !selectedModelConfig.apiKey || optimize.state.status === 'loading'}
                            className="flex items-center justify-center text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                          >
                            {optimize.state.status === 'loading'
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Wand2 size={14} />}
                          </button>
                        </Tooltip>
                        <SendButton style={{ width: 20, height: 20, minWidth: 20, fontSize: 12, padding: 0, backgroundColor: sendBtnBg, color: sendBtnColor, border: 'none' }} />
                      </div>
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
                rightPanelMaximized ? '' : 'min-w-[400px]'
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
                onClearWorktree={handleClearWorktree}
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

      {/* 线上模型登录引导弹窗 */}
      <Modal open={loginGuideOpen} onClose={() => setLoginGuideOpen(false)} title={t('modelSelector.loginRequiredTitle')} widthClassName="w-[400px]">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {t('modelSelector.loginRequiredDesc')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setLoginGuideOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
            >
              {t('modelSelector.cancel')}
            </button>
            <button
              onClick={() => {
                setLoginGuideOpen(false);
                auth.login();
              }}
              className="rounded-lg bg-[var(--brand-solid)] px-3 py-1.5 text-sm text-white hover:opacity-90 transition-opacity"
            >
              {t('modelSelector.login')}
            </button>
          </div>
        </div>
      </Modal>

      {/* 获取 AI 转发 Key 失败弹窗 */}
      <Modal open={getKeyErrorOpen} onClose={() => setGetKeyErrorOpen(false)} title={t('modelSelector.getKeyFailedTitle')} widthClassName="w-[400px]">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {t('modelSelector.getKeyFailedDesc')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setGetKeyErrorOpen(false)}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
            >
              {t('modelSelector.cancel')}
            </button>
            <button
              onClick={() => {
                setGetKeyErrorOpen(false);
                if (auth.user?.accessToken) {
                  ensureAiForwardingKey()
                    .then(() => {
                      // 成功后若有 pending query 则执行
                      const pending = pendingQueryRef.current;
                      if (pending) {
                        pendingQueryRef.current = null;
                        pending();
                      }
                    })
                    .catch(err => {
                      console.error('[ContentArea] retry ensureAiForwardingKey failed:', err);
                      // 401 → 弹登录引导；其他 → 重新弹凭证失败
                      if ((err as Error & { code?: string }).code === NOT_AUTHENTICATED) {
                        setLoginGuideOpen(true);
                      } else {
                        setGetKeyErrorOpen(true);
                      }
                    });
                } else {
                  auth.login();
                }
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-colors"
            >
              {t('modelSelector.retry')}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
