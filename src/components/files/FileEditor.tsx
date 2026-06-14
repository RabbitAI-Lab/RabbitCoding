import { Loader2, FileText } from 'lucide-react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import { useI18n } from '../../i18n/useI18n';
import { useTheme } from '../../hooks/useTheme';

// 使用本地 monaco-editor 包，完全不依赖 CDN（桌面应用离线可靠 + 全语言支持）
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};
// 注入本地 monaco 实例，init() 检测到 monaco 后直接 resolve，不会走 CDN 脚本注入
loader.config({ monaco });

interface FileEditorProps {
  filePath: string | null;
  content: string | null;
  loading: boolean;
  error: string | null;
  editable?: boolean;
  onContentChange?: (value: string) => void;
}

/** 从文件扩展名推断 Monaco 语言 */
function getLanguage(filePath: string): string {
  // 先匹配双扩展名（如 build.gradle.kts、settings.gradle）
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith('.gradle.kts')) return 'kotlin';
  if (lowerPath.endsWith('.gradle')) return 'java';
  if (lowerPath.endsWith('.properties')) return 'ini';
  if (lowerPath.endsWith('.env')) return 'ini';
  if (lowerPath.endsWith('dockerfile')) return 'dockerfile';
  if (lowerPath.endsWith('makefile')) return 'makefile';

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    json5: 'json',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    markdown: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    rs: 'rust',
    py: 'python',
    go: 'go',
    toml: 'toml',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    xml: 'xml',
    vue: 'html',
    svelte: 'html',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    dart: 'dart',
    lua: 'lua',
    r: 'r',
    scala: 'scala',
    groovy: 'java',
    ini: 'ini',
    conf: 'ini',
    cfg: 'ini',
    graphql: 'graphql',
    gql: 'graphql',
    proto: 'protobuf',
    dockerfile: 'dockerfile',
    bat: 'bat',
    cmd: 'bat',
    ps1: 'powershell',
    diff: 'diff',
    txt: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

export default function FileEditor({ filePath, content, loading, error, editable, onContentChange }: FileEditorProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  // 空状态：未选择文件
  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-gray-300 dark:text-gray-600">
        <div className="flex flex-col items-center gap-2">
          <FileText size={32} />
          <span className="text-xs">{t('fileEditor.selectFile')}</span>
        </div>
      </div>
    );
  }

  // 加载中
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">{t('fileEditor.loading')}</span>
      </div>
    );
  }

  // 错误
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400 dark:text-red-500 px-4">
        <span className="text-xs text-center">{error}</span>
      </div>
    );
  }

  return (
    <Editor
      height="100%"
      language={getLanguage(filePath)}
      value={content ?? ''}
      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
      onChange={(value) => {
        if (editable && onContentChange) {
          onContentChange(value ?? '');
        }
      }}
      options={{
        readOnly: !editable,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        padding: { top: 8 },
        renderLineHighlight: 'line',
        domReadOnly: !editable,
        contextmenu: !!editable,
      }}
    />
  );
}
