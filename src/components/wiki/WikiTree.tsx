import { ChevronRight, FileText, FolderOpen, BookOpen, AlertCircle } from 'lucide-react';
import type { CatalogTreeNode, RepoCatalog } from './wikiTypes';

// ---- CatalogOutlineTree 组件 ----

interface CatalogOutlineTreeProps {
  nodes: CatalogTreeNode[];
  parentKey: string;
  baseDir: string;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  failedFilePaths: Set<string>;
  onToggle: (key: string) => void;
  onOpenFile: (filePath: string, title: string) => void;
}

function CatalogOutlineTree({
  nodes,
  parentKey,
  baseDir,
  selectedPath,
  expandedPaths,
  failedFilePaths,
  onToggle,
  onOpenFile,
}: CatalogOutlineTreeProps) {
  const renderNode = (node: CatalogTreeNode, depth: number, pKey: string) => {
    const key = `${pKey}/${node.title}`;
    const hasChildren = node.children && node.children.length > 0;
    const isSection = hasChildren && !node.path;
    const expanded = expandedPaths.has(key);

    // Document 叶子节点
    if (!isSection && node.path) {
      const filePath = `${baseDir}/${node.path}.md`;
      const selected = selectedPath === filePath;
      const isFailed = failedFilePaths.has(filePath);
      return (
        <div key={key}>
          <button
            onClick={() => onOpenFile(filePath, node.title)}
            className={`flex w-full items-center gap-1 py-[4px] pr-2 text-left text-xs transition-colors ${
              selected
                ? 'bg-[#dfdfdf] text-[#141414] dark:bg-[#3a3a3a] dark:text-gray-100'
                : 'text-[#333333] hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={isFailed ? `${node.title} (生成失败)` : (node.description ?? node.title)}
          >
            <span className="w-3 shrink-0" />
            {isFailed ? (
              <AlertCircle size={14} className="shrink-0 text-orange-500 dark:text-orange-400" />
            ) : (
              <FileText size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
            )}
            <span className="truncate">{node.title}</span>
          </button>
        </div>
      );
    }

    // Section 分组节点
    return (
      <div key={key}>
        <button
          onClick={() => onToggle(key)}
          className={`flex w-full items-center gap-1 py-[4px] pr-2 text-left text-xs transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
            expanded ? 'text-[#333333] dark:text-gray-200' : 'text-[#333333] dark:text-gray-300'
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={node.description ?? node.title}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-gray-400 transition-transform dark:text-gray-500 ${expanded ? 'rotate-90' : ''}`}
          />
          <BookOpen size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
          <span className="truncate font-medium">{node.title}</span>
        </button>
        {expanded && node.children?.map(child => renderNode(child, depth + 1, key))}
      </div>
    );
  };

  return <div className="py-1">{nodes.map(node => renderNode(node, 0, parentKey))}</div>;
}

// ---- 分区标题 ----

export function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
      {icon}
      <span>{label}</span>
    </div>
  );
}

// ---- 目录树区域渲染 ----

interface WikiTreeAreaProps {
  repos: RepoCatalog[];
  workspaceCatalog: CatalogTreeNode | null;
  reposWikiDir: string;
  workspaceWikiDir: string;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  failedFilePaths: Set<string>;
  onToggle: (key: string) => void;
  onOpenFile: (filePath: string, title: string) => void;
  repoWikiLabel: string;
  workspaceWikiLabel: string;
}

export function WikiTreeArea({
  repos,
  workspaceCatalog,
  reposWikiDir,
  workspaceWikiDir,
  selectedPath,
  expandedPaths,
  failedFilePaths,
  onToggle,
  onOpenFile,
  repoWikiLabel,
  workspaceWikiLabel,
}: WikiTreeAreaProps) {
  const reposWithCatalog = repos.filter(r => r.catalog);
  return (
    <div>
      {reposWithCatalog.length > 0 && (
        <>
          <SectionLabel icon={<FolderOpen size={11} />} label={repoWikiLabel} />
          {reposWithCatalog.map(repo => (
            <div key={repo.name}>
              <div className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-400">
                <ChevronRight size={11} className="text-gray-400" />
                {repo.name}
              </div>
              <CatalogOutlineTree
                nodes={repo.catalog!.children ?? []}
                parentKey={`repo:${repo.name}`}
                baseDir={`${reposWikiDir}/${repo.name}`}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                failedFilePaths={failedFilePaths}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            </div>
          ))}
        </>
      )}
      {workspaceCatalog && (workspaceCatalog.children?.length ?? 0) > 0 && (
        <>
          <SectionLabel icon={<BookOpen size={11} />} label={workspaceWikiLabel} />
          <CatalogOutlineTree
            nodes={workspaceCatalog.children ?? []}
            parentKey="workspace"
            baseDir={workspaceWikiDir}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            failedFilePaths={failedFilePaths}
            onToggle={onToggle}
            onOpenFile={onOpenFile}
          />
        </>
      )}
    </div>
  );
}
