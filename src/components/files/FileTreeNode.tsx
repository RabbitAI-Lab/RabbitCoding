import { memo } from 'react';
import {
  Folder, FolderOpen, ChevronRight, Loader2,
  FileText, FileCode2, FileJson, FileTerminal,
  Image, FileCog, Braces, Hash, Container,
  type LucideIcon,
} from 'lucide-react';
import type { FileNode } from './types';

/** 根据文件后缀返回图标和颜色 */
function getFileIcon(name: string): { Icon: LucideIcon; className: string } {
  const lower = name.toLowerCase();

  // 特殊文件名
  if (lower === 'dockerfile') return { Icon: Container, className: 'text-blue-500' };
  if (lower === 'makefile') return { Icon: FileTerminal, className: 'text-green-600' };
  if (lower.startsWith('.env')) return { Icon: FileCog, className: 'text-yellow-600' };

  const ext = lower.split('.').pop() ?? '';

  // 代码类（深蓝）
  const codeExts: Record<string, string> = {
    ts: 'text-blue-600', tsx: 'text-blue-600',
    js: 'text-yellow-500', jsx: 'text-yellow-500',
    mjs: 'text-yellow-500', cjs: 'text-yellow-500',
    rs: 'text-orange-600', go: 'text-cyan-500',
    java: 'text-red-500', kt: 'text-purple-500', kts: 'text-purple-500',
    py: 'text-green-600', rb: 'text-red-500',
    swift: 'text-orange-500', c: 'text-blue-500',
    cpp: 'text-blue-500', cc: 'text-blue-500', cxx: 'text-blue-500',
    h: 'text-blue-400', hpp: 'text-blue-400',
    php: 'text-indigo-500', scala: 'text-red-500',
    dart: 'text-cyan-600', lua: 'text-blue-500',
    groovy: 'text-green-600', gradle: 'text-green-600',
  };
  if (codeExts[ext]) return { Icon: FileCode2, className: codeExts[ext] };

  // 配置类
  const configExts = ['yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'xml', 'properties'];
  if (configExts.includes(ext)) return { Icon: FileCog, className: 'text-gray-400' };
  if (ext === 'json') return { Icon: FileJson, className: 'text-yellow-500' };

  // Shell/脚本
  if (['sh', 'bash', 'zsh'].includes(ext)) return { Icon: FileTerminal, className: 'text-green-600' };

  // 样式
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return { Icon: Hash, className: 'text-blue-500' };

  // 标记语言
  if (['md', 'markdown'].includes(ext)) return { Icon: FileText, className: 'text-gray-400' };

  // 图片
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) return { Icon: Image, className: 'text-purple-400' };

  // 数据格式
  if (['sql', 'graphql', 'gql', 'proto'].includes(ext)) return { Icon: Braces, className: 'text-gray-400' };

  // 默认
  return { Icon: FileText, className: 'text-gray-300' };
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  showPath?: boolean;
  workspacePath?: string;
}

const FileTreeNode = memo(function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelectFile,
  onToggleDir,
  showPath,
  workspacePath,
}: FileTreeNodeProps) {
  const isSelected = selectedPath === node.path;
  const isExpanded = node.expanded;

  /** 计算相对目录路径（筛选时显示） */
  const relativeDir = (() => {
    if (!showPath || !workspacePath || node.isDirectory) return '';
    const base = workspacePath.endsWith('/') ? workspacePath : workspacePath + '/';
    const rel = node.path.startsWith(base) ? node.path.substring(base.length) : node.path;
    const dir = rel.substring(0, rel.length - node.name.length);
    console.debug('[FileTreeNode] relativeDir:', { name: node.name, path: node.path, base, rel, dir });
    return dir;
  })();

  const handleClick = () => {
    if (node.isDirectory) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={`flex items-center gap-1 w-full text-left text-xs py-[3px] pr-2 transition-colors ${
          isSelected
            ? 'bg-[#dfdfdf] dark:bg-[#3a3a3a] text-[#141414] dark:text-gray-100'
            : 'text-[#333333] dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {node.isDirectory ? (
          <>
            {node.loading ? (
              <Loader2 size={12} className="shrink-0 text-gray-400 dark:text-gray-500 animate-spin" />
            ) : (
              <ChevronRight
                size={12}
                className={`shrink-0 text-gray-400 dark:text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            )}
            {isExpanded ? (
              <FolderOpen size={14} className="shrink-0 text-blue-500 dark:text-blue-400" />
            ) : (
              <Folder size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            {(() => {
              const { Icon, className } = getFileIcon(node.name);
              return <Icon size={14} className={`shrink-0 ${className}`} />;
            })()}
          </>
        )}
        <span className="truncate shrink-0">{node.name}</span>
        {relativeDir && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate ml-1 flex-1 min-w-0">{relativeDir}</span>
        )}
      </button>

      {node.isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              showPath={showPath}
              workspacePath={workspacePath}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default FileTreeNode;
