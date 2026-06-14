/**
 * 智能体配置常量与工厂函数
 */

import {
  Search,
  Code2,
  Bug,
  GitPullRequest,
  MousePointer,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type {
  BuiltinAgentRole,
  BuiltinAgentConfig,
  CustomAgentConfig,
  AgentScopeConfig,
} from '../../../types';

/** 用户级 scope 标识 */
export const USER_SCOPE = '__user__';

/** 6 个内置专家团子智能体元数据 */
export const BUILTIN_AGENT_META: ReadonlyArray<{
  role: BuiltinAgentRole;
  nameKey: string;
  descKey: string;
  icon: LucideIcon;
}> = [
  { role: 'researcher', nameKey: 'settings.agents.builtin.researcher', descKey: 'settings.agents.builtin.researcherDesc', icon: Search },
  { role: 'fullstack', nameKey: 'settings.agents.builtin.fullstack', descKey: 'settings.agents.builtin.fullstackDesc', icon: Code2 },
  { role: 'qa', nameKey: 'settings.agents.builtin.qa', descKey: 'settings.agents.builtin.qaDesc', icon: Bug },
  { role: 'reviewer', nameKey: 'settings.agents.builtin.reviewer', descKey: 'settings.agents.builtin.reviewerDesc', icon: GitPullRequest },
  { role: 'ui_operator', nameKey: 'settings.agents.builtin.uiOperator', descKey: 'settings.agents.builtin.uiOperatorDesc', icon: MousePointer },
  { role: 'debugger', nameKey: 'settings.agents.builtin.debugger', descKey: 'settings.agents.builtin.debuggerDesc', icon: Terminal },
];

/** 自定义智能体可选工具列表（与 Claude Agent SDK 工具对齐） */
export const TOOL_OPTIONS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
];

/** 创建单个内置子智能体的默认配置 */
export function createDefaultBuiltinAgent(role: BuiltinAgentRole): BuiltinAgentConfig {
  return {
    role,
    modelId: '',
    skills: [],
    mcp: [],
    additionalPrompt: '',
  };
}

/** 创建某个 scope 的完整默认配置 */
export function createDefaultScopeConfig(scope: string): AgentScopeConfig {
  return {
    scope,
    builtinAgents: BUILTIN_AGENT_META.map((m) => createDefaultBuiltinAgent(m.role)),
    customAgents: [],
  };
}

/** 创建新自定义智能体的默认值（不含 id 和 createdAt） */
export function createDefaultCustomAgent(): Omit<CustomAgentConfig, 'id' | 'createdAt'> {
  return {
    name: '',
    description: '',
    modelId: '',
    tools: [],
    systemPrompt: '',
    enabled: true,
  };
}
