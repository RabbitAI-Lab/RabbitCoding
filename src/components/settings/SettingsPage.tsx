import { useState, useEffect } from 'react';
import {
  ChevronLeft,
  Settings2,
  Cpu,
  Bot,
  Zap,
  Plug,
  Database,
  Wifi,
  FlaskConical,
  Wrench,
  MessageCircleQuestion,
  Mic,
  type LucideIcon,
} from 'lucide-react';
import { useResizable } from '../../hooks/useResizable';
import { useI18n } from '../../i18n/useI18n';
import { titleBarPadding } from '../../utils/platform';
import { isVoiceSupportedSync, checkVoiceSupported } from '../../hooks/useVoiceSupported';
import GeneralPanel from './GeneralPanel';
import ModelsPanel from './ModelsPanel';
import AgentsPanel from './agents/AgentsPanel';
import McpPanel from './McpPanel';
import SkillsPanel from './skills/SkillsPanel';
import NetworkDiagnosticsPanel from './NetworkDiagnosticsPanel';
import AdvancedPanel from './AdvancedPanel';
import CodebaseIndexPanel from './CodebaseIndexPanel';
import IntegrationPanel from './IntegrationPanel';
import FeedbackPanel from './FeedbackPanel';
import VoicePanel from './VoicePanel';
import type { Workspace } from '../../types';

/** 设置页面可用的 section */
export type SettingsSection =
  | 'general'
  | 'models'
  | 'agents'
  | 'skills'
  | 'mcpServices'
  | 'codebaseIndex'
  | 'integration'
  | 'networkDiagnostics'
  | 'advanced'
  | 'feedback'
  | 'voice';

interface NavItem {
  key: SettingsSection;
  labelKey: string;
  icon: LucideIcon;
}

interface NavGroup {
  items: NavItem[];
  dividerAfter: boolean;
}

/** 导航分组数据 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ key: 'general', labelKey: 'settings.nav.general', icon: Settings2 }],
    dividerAfter: true,
  },
  {
    items: [
      { key: 'models', labelKey: 'settings.nav.models', icon: Cpu },
      { key: 'agents', labelKey: 'settings.nav.agents', icon: Bot },
      { key: 'skills', labelKey: 'settings.nav.skills', icon: Zap },
      { key: 'mcpServices', labelKey: 'settings.nav.mcpServices', icon: Plug },
    ],
    dividerAfter: true,
  },
  {
    items: [
      { key: 'codebaseIndex', labelKey: 'settings.nav.codebaseIndex', icon: Database },
      { key: 'integration', labelKey: 'settings.nav.integration', icon: FlaskConical },
      { key: 'networkDiagnostics', labelKey: 'settings.nav.networkDiagnostics', icon: Wifi },
      { key: 'advanced', labelKey: 'settings.nav.advanced', icon: Wrench },
      { key: 'voice', labelKey: 'settings.nav.voice', icon: Mic },
      { key: 'feedback', labelKey: 'settings.nav.feedback', icon: MessageCircleQuestion },
    ],
    dividerAfter: false,
  },
];

interface SettingsPageProps {
  onBack: () => void;
  /** 设置页打开时默认展示的 section，不传则默认 'general' */
  initialSection?: SettingsSection;
  /** workspaces 数据，用于用量统计 */
  workspaces: Workspace[];
}

export default function SettingsPage({ onBack, initialSection, workspaces }: SettingsPageProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'general');
  const [fullWidth, setFullWidth] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(isVoiceSupportedSync());

  // 查询后端编译期判定：不支持的平台过滤掉语音设置项
  useEffect(() => { checkVoiceSupported().then(setVoiceSupported); }, []);

  // 根据平台能力过滤导航分组
  const navGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: voiceSupported ? group.items : group.items.filter(item => item.key !== 'voice'),
  }));

  // section 切换时重置全宽模式
  useEffect(() => { setFullWidth(false); }, [section]);

  const { width, isResizing, handleProps } = useResizable({
    storageKey: 'settings-nav-width',
    defaultWidth: 240,
    minWidth: 220,
    maxWidthRatio: 0.28,
  });

  /** 渲染当前 section 对应的内容面板 */
  const renderPanel = () => {
    if (section === 'general') {
      return <GeneralPanel workspaces={workspaces} />;
    }
    if (section === 'models') {
      return <ModelsPanel />;
    }
    if (section === 'agents') {
      return <AgentsPanel />;
    }
    if (section === 'skills') {
      return <SkillsPanel onLayoutChange={setFullWidth} />;
    }
    if (section === 'mcpServices') {
      return <McpPanel />;
    }
    if (section === 'codebaseIndex') {
      return <CodebaseIndexPanel />;
    }
    if (section === 'networkDiagnostics') {
      return <NetworkDiagnosticsPanel />;
    }
    if (section === 'integration') {
      return <IntegrationPanel />;
    }
    if (section === 'advanced') {
      return <AdvancedPanel />;
    }
    if (section === 'feedback') {
      return <FeedbackPanel autoCapture={false} />;
    }
    if (section === 'voice') {
      return <VoicePanel />;
    }
    // 其他面板暂用占位
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        <p className="text-sm">{t('settings.common.comingSoon')}</p>
      </div>
    );
  };

  return (
    <>
      {/* 左：设置导航 */}
      <aside
        className="relative flex h-screen shrink-0 flex-col bg-[#F8F8F8] dark:bg-[#1a1a1a]"
        style={{ width }}
      >
        {/* 标题栏拖拽区域（macOS 红绿灯按钮占位 / Windows 直接顶齐） */}
        <div data-tauri-drag-region className={`h-[34px] shrink-0 ${titleBarPadding}`} />

        <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-2">
          {/* 返回按钮 */}
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ChevronLeft size={14} className="shrink-0" />
            <span>{t('settings.nav.back')}</span>
          </button>

          {/* 分组导航菜单 */}
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.items.map(item => {
                const active = section === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setSection(item.key)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'bg-[var(--brand-soft-bg)] font-medium text-[var(--brand-primary)]'
                        : 'text-gray-700 dark:text-[#95958F] hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <item.icon size={14} className="shrink-0" />
                    <span>{t(item.labelKey)}</span>
                  </button>
                );
              })}
              {group.dividerAfter && (
                <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
              )}
            </div>
          ))}
        </nav>

        {/* 拖拽手柄 */}
        <div
          {...handleProps}
          className={`absolute inset-y-0 right-0 w-1 cursor-col-resize transition-colors hover:bg-[var(--brand-primary)]/40 ${
            isResizing ? 'bg-[var(--brand-primary)]/40' : ''
          }`}
        />
      </aside>

      {/* 右：内容区 */}
      <main className="flex flex-1 flex-col overflow-hidden rounded-tl-xl rounded-bl-xl border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e1e]">
        {/* 标题栏 */}
        <div
          data-tauri-drag-region
          className="flex h-[42px] shrink-0 items-center pl-4"
        >
          <span
            data-tauri-drag-region
            className="text-sm font-medium text-[#333333] dark:text-gray-100"
          >
            {t(`settings.nav.${section}`)}
          </span>
        </div>
        {/* 标题栏与内容区分割线 */}
        <div className="h-px bg-gray-200 dark:bg-gray-700" />

        {/* 滚动内容区 */}
        <div className={`flex-1 ${fullWidth ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className={fullWidth ? 'h-full' : 'mx-auto max-w-2xl px-6 py-6'}>
            {renderPanel()}
          </div>
        </div>
      </main>
    </>
  );
}
