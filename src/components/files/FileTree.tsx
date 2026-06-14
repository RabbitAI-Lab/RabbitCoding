import type { FileNode } from './types';
import FileTreeNode from './FileTreeNode';

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  showPath?: boolean;
  workspacePath?: string;
}

export default function FileTree({ nodes, selectedPath, onSelectFile, onToggleDir, showPath, workspacePath }: FileTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-xs py-8">
        空目录
      </div>
    );
  }

  return (
    <div className="py-1 overflow-auto h-full">
      {nodes.map(node => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onToggleDir={onToggleDir}
          showPath={showPath}
          workspacePath={workspacePath}
        />
      ))}
    </div>
  );
}
