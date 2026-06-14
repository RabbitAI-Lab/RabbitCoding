import { readDir, readTextFile } from '@tauri-apps/plugin-fs';

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface SearchOptions {
  query: string;
  isCaseSensitive: boolean;
  isWholeWord: boolean;
  isRegex: boolean;
  includePattern: string;
  excludePattern: string;
}

export interface SearchMatch {
  line: number;        // 1-based
  column: number;      // 1-based
  preview: string;
  matchStart: number;
  matchLength: number;
}

export interface FileSearchResult {
  filePath: string;
  relativePath: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  results: FileSearchResult[];
  totalMatches: number;
  truncated: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  常量                                                                */
/* ------------------------------------------------------------------ */

/** 二进制文件扩展名黑名单 */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'svg',
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a',
  'mp3', 'mp4', 'avi', 'mov', 'wav', 'flv', 'mkv',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'class', 'jar', 'war', 'pyc', 'pyo',
]);

/** 大文件阈值：1 MB */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

/** 全局文件数上限 */
const MAX_FILES = 5000;

/** 单文件匹配上限 */
const MAX_MATCHES_PER_FILE = 1000;

/** 并发读取上限 */
const CONCURRENCY = 12;

/* ------------------------------------------------------------------ */
/*  glob 匹配（轻量自实现，不引入 minimatch）                            */
/* ------------------------------------------------------------------ */

/** 解析逗号分隔的 glob 字符串 */
export function parsePatterns(input: string): string[] {
  if (!input.trim()) return [];
  return input
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** 将单个 glob 转为 RegExp（支持 `*` 通配符） */
function globToRegex(glob: string): RegExp {
  // 转义正则特殊字符，但保留 *
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  return new RegExp(escaped, 'i');
}

/** 判断文件相对路径是否应被搜索 */
export function shouldIncludeFile(
  relativePath: string,
  includeGlobs: string[],
  excludeGlobs: string[],
): boolean {
  // exclude 优先
  for (const pattern of excludeGlobs) {
    try {
      const regex = globToRegex(pattern);
      // 检查完整路径和文件名
      const fileName = relativePath.split('/').pop() ?? '';
      if (regex.test(relativePath) || regex.test(fileName)) {
        return false;
      }
    } catch { /* ignore invalid glob */ }
  }
  // 如果有 include 模式，至少匹配一个才纳入
  if (includeGlobs.length > 0) {
    let included = false;
    for (const pattern of includeGlobs) {
      try {
        const regex = globToRegex(pattern);
        const fileName = relativePath.split('/').pop() ?? '';
        if (regex.test(relativePath) || regex.test(fileName)) {
          included = true;
          break;
        }
      } catch { /* ignore invalid glob */ }
    }
    if (!included) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  正则构建                                                            */
/* ------------------------------------------------------------------ */

/** 转义正则特殊字符（非正则模式使用） */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 根据搜索选项构建匹配正则 */
export function buildMatcher(options: SearchOptions): RegExp | null {
  if (!options.query) return null;

  try {
    let pattern: string;
    if (options.isRegex) {
      pattern = options.query;
    } else {
      pattern = escapeRegExp(options.query);
    }

    if (options.isWholeWord) {
      pattern = `\\b${pattern}\\b`;
    }

    const flags = options.isCaseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    return null; // 非法正则
  }
}

/* ------------------------------------------------------------------ */
/*  文本搜索                                                            */
/* ------------------------------------------------------------------ */

/** 在单个文件文本中查找所有匹配 */
export function searchInText(
  content: string,
  matcher: RegExp,
  maxMatches: number = MAX_MATCHES_PER_FILE,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (matches.length >= maxMatches) break;
    const line = lines[lineIdx];
    // 重置正则 lastIndex（因为带 g 标志）
    matcher.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = matcher.exec(line)) !== null) {
      if (matches.length >= maxMatches) break;
      const preview = line.length > 300 ? line.slice(0, 300) : line;
      matches.push({
        line: lineIdx + 1,
        column: m.index + 1,
        preview,
        matchStart: m.index,
        matchLength: m[0].length,
      });
      // 防止零宽匹配死循环
      if (m.index === matcher.lastIndex) {
        matcher.lastIndex++;
      }
    }
  }

  return matches;
}

/* ------------------------------------------------------------------ */
/*  递归遍历 + 搜索                                                      */
/* ------------------------------------------------------------------ */

interface FileInfo {
  absolutePath: string;
  relativePath: string;
}

/** 递归收集所有可搜索文件路径 */
async function collectFiles(
  dirPath: string,
  rootPath: string,
  ignoredNames: Set<string>,
  signal: AbortSignal,
  files: FileInfo[],
): Promise<void> {
  if (signal.aborted || files.length >= MAX_FILES) return;

  let entries;
  try {
    entries = await readDir(dirPath);
  } catch {
    return; // 无权限等，跳过
  }

  for (const entry of entries) {
    if (signal.aborted || files.length >= MAX_FILES) return;

    // 跳过隐藏文件 / 忽略目录
    if (entry.name.startsWith('.') || ignoredNames.has(entry.name)) continue;

    const absPath = dirPath + '/' + entry.name;
    const relPath = absPath.slice(rootPath.length + 1);

    if (entry.isDirectory) {
      await collectFiles(absPath, rootPath, ignoredNames, signal, files);
    } else {
      // 跳过二进制文件
      const ext = entry.name.toLowerCase().split('.').pop() ?? '';
      if (BINARY_EXTS.has(ext)) continue;
      files.push({ absolutePath: absPath, relativePath: relPath });
    }
  }
}

/** 简单的 Promise 并发池 */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** 主入口：搜索整个工作区 */
export async function searchWorkspace(
  rootPath: string,
  options: SearchOptions,
  signal: AbortSignal,
  ignoredNames: Set<string>,
): Promise<SearchResult> {
  const empty: SearchResult = { results: [], totalMatches: 0, truncated: false };

  if (!options.query.trim()) return empty;

  const matcher = buildMatcher(options);
  if (!matcher) {
    return { ...empty, error: '无效的正则表达式' };
  }

  const includeGlobs = parsePatterns(options.includePattern);
  const excludeGlobs = parsePatterns(options.excludePattern);

  // 1. 递归收集文件
  const allFiles: FileInfo[] = [];
  await collectFiles(rootPath, rootPath, ignoredNames, signal, allFiles);

  if (signal.aborted) return empty;

  const truncated = allFiles.length >= MAX_FILES;

  // 2. 过滤 include / exclude
  const targetFiles = allFiles.filter(f => shouldIncludeFile(f.relativePath, includeGlobs, excludeGlobs));

  // 3. 并发读取并搜索
  const results: FileSearchResult[] = [];
  let totalMatches = 0;

  await runWithConcurrency(
    targetFiles,
    async (fileInfo) => {
      if (signal.aborted) return;

      try {
        const content = await readTextFile(fileInfo.absolutePath);
        if (content.length > MAX_FILE_SIZE) return;

        // 复制 matcher（因为 searchInText 会修改 lastIndex）
        const localMatcher = new RegExp(matcher.source, matcher.flags);
        const matches = searchInText(content, localMatcher);

        if (matches.length > 0) {
          results.push({
            filePath: fileInfo.absolutePath,
            relativePath: fileInfo.relativePath,
            matches,
          });
          totalMatches += matches.length;
        }
      } catch {
        // 读取失败（二进制/编码等），跳过
      }
    },
    CONCURRENCY,
  );

  if (signal.aborted) return empty;

  return {
    results,
    totalMatches,
    truncated,
  };
}
