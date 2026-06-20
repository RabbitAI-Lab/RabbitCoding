import type { FailedDoc, KnowledgeBaseConfig } from '../../types';

// ---- Tab 类型 ----

export type KnowledgeTab = 'codeWiki' | 'flashCard' | 'memory';

export const STORAGE_KEY = 'knowledge-base-configs';

// ---- Wiki 队列/进度类型 ----

export interface WikiProgress {
  taskId: string;
  phase: string;
  repoName?: string | null;
  message: string;
  current?: number | null;
  total?: number | null;
  consecutiveFailures?: number | null;
  maxConsecutiveFailures?: number | null;
}

export interface TaskSnapshot {
  taskId: string;
  workspaceName: string;
  status: string;
  createdAt: number;
}

export interface QueueStatus {
  current: TaskSnapshot | null;
  queued: TaskSnapshot[];
}

// ---- Catalog 语义树类型（_catalog.json）----

export interface CatalogTreeNode {
  title: string;
  description?: string;
  path?: string;        // 叶子节点（Document）才有
  children?: CatalogTreeNode[];
}

export interface RepoCatalog {
  name: string;
  catalog: CatalogTreeNode | null;
}

export interface CatalogsTree {
  repos: RepoCatalog[];
  workspace: CatalogTreeNode | null;
  /** catalog 中有但磁盘上 .md 文件缺失的路径（相对于 codewiki 目录，如 "workspace/foo.md"） */
  missingFilePaths: string[];
}

// ---- Wiki Tab 类型 ----

export interface WikiTab {
  path: string;   // .md 文件绝对路径
  name: string;   // catalog 中的标题
}

// ---- Catalog 辅助函数 ----

/**
 * 递归收集所有 Section（有 children 的节点）的 key，用于默认展开。
 * key 格式: parentKey + '/' + title
 */
export function collectCatalogExpandedKeys(
  nodes: CatalogTreeNode[],
  parentKey: string,
  keys: string[] = [],
): string[] {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const key = `${parentKey}/${node.title}`;
      keys.push(key);
      collectCatalogExpandedKeys(node.children, key, keys);
    }
  }
  return keys;
}

// ---- 通用辅助函数 ----

export function defaultConfig(language: 'zh' | 'en'): KnowledgeBaseConfig {
  return {
    language,
    autoUpdate: false,
    autoExport: true,
    referenceEnabled: false,
  };
}

export function formatPath(path: string): string {
  return path.replace(/\/+/g, '/');
}

// ---- 失败项聚合类型 ----

export interface FailedDocItem {
  doc: FailedDoc;
  repoName?: string;
}
