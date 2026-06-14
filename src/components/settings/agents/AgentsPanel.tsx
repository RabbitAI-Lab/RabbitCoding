/**
 * AgentsPanel 组件
 *
 * 智能体配置主面板。
 * 管理卡片列表视图 ↔ 详情子视图的切换。
 */

import { useState } from 'react';
import { User, FolderCog } from 'lucide-react';
import { useI18n } from '../../../i18n/useI18n';
import { useLocalStorage } from '../../../hooks/useLocalStorage';
import { USER_SCOPE } from './agentConstants';
import AgentScopeCard from './AgentScopeCard';
import AgentDetail from './AgentDetail';
import type { Workspace } from '../../../types';

export default function AgentsPanel() {
  const { t } = useI18n();
  const [workspaces] = useLocalStorage<Workspace[]>('rabbit-workspaces', []);

  // null = 卡片列表；非 null = 详情子视图
  const [selected, setSelected] = useState<{ scope: string; title: string } | null>(null);

  // ---- 详情子视图 ----
  if (selected) {
    return (
      <AgentDetail
        scope={selected.scope}
        scopeTitle={selected.title}
        onBack={() => setSelected(null)}
      />
    );
  }

  // ---- 卡片列表视图 ----
  return (
    <div className="flex flex-col gap-4">
      {/* 页面标题 */}
      <div>
        <h2 className="text-base font-semibold text-[#333333] dark:text-gray-100">
          {t('settings.agents.title')}
        </h2>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {t('settings.agents.description')}
        </p>
      </div>

      {/* 卡片列表 */}
      <div className="flex flex-col gap-2.5">
        {/* 第 1 张：用户级（始终存在） */}
        <AgentScopeCard
          icon={User}
          title={t('settings.agents.userLevel')}
          subtitle={t('settings.agents.userLevelDesc')}
          badge={t('settings.agents.badgeDefault')}
          onClick={() =>
            setSelected({ scope: USER_SCOPE, title: t('settings.agents.userLevel') })
          }
        />
        {/* 后续每多一个 workspace 多一张卡片 */}
        {workspaces.map((ws) => (
          <AgentScopeCard
            key={ws.id}
            icon={FolderCog}
            title={ws.name || t('common.unnamedWorkspace')}
            subtitle={t('settings.agents.workspaceLevel')}
            onClick={() =>
              setSelected({
                scope: ws.id,
                title: ws.name || t('common.unnamedWorkspace'),
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
