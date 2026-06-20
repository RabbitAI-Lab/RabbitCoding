import WorkspaceItem from './WorkspaceItem';
import type { useWorkspaces } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n/useI18n';
import { useState, useCallback, useRef, useEffect } from 'react';

interface WorkspaceListProps {
  store: ReturnType<typeof useWorkspaces>;
  onOpenKnowledgeBase: (workspaceId: string) => void;
}

export default function WorkspaceList({ store, onOpenKnowledgeBase }: WorkspaceListProps) {
  const { t } = useI18n();
  const {
    workspaces,
    selectedWorkspaceId,
    selectedRabbitId,
    editingId,
    addingRabbitWorkspaceId,
    reorderWorkspace,
  } = store;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after'>('before');

  // ref 版本，用于 mouse 事件中同步读取
  const draggingIdRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const dragOverPositionRef = useRef<'before' | 'after'>('before');

  // mouse 拖拽相关
  const mouseDownIdRef = useRef<string | null>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /**
   * 基于 mouse 事件的拖拽实现（绕过 HTML5 DnD，兼容 Tauri WebView）
   */

  // 每个项的 onMouseDown：记录起点
  const handleItemMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    // 只响应左键
    if (e.button !== 0) return;
    mouseDownIdRef.current = id;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // 全局 mousemove：判断是否进入拖拽 + 实时计算 hover 目标
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // 还没开始拖拽，判断是否超过阈值
      if (!isDraggingRef.current && mouseDownIdRef.current && mouseDownPosRef.current) {
        const dx = e.clientX - mouseDownPosRef.current.x;
        const dy = e.clientY - mouseDownPosRef.current.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          // 开始拖拽
          isDraggingRef.current = true;
          const id = mouseDownIdRef.current;
          draggingIdRef.current = id;
          setDraggingId(id);
          // 拖拽开始时自动折叠所有项目空间
          workspaces.forEach(w => {
            if (!w.collapsed) {
              store.toggleCollapse(w.id);
            }
          });
        }
      }

      // 拖拽中：计算当前悬停在哪个项上
      if (isDraggingRef.current && draggingIdRef.current) {
        const targetId = hitTest(e.clientY);
        if (targetId && targetId !== draggingIdRef.current) {
          const el = itemRefs.current.get(targetId);
          if (el) {
            const rect = el.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const position = e.clientY < midpoint ? 'before' : 'after';
            dragOverIdRef.current = targetId;
            dragOverPositionRef.current = position;
            setDragOverId(targetId);
            setDragOverPosition(position);
          }
        } else {
          dragOverIdRef.current = null;
          setDragOverId(null);
        }
      }
    };

    const onMouseUp = () => {
      // 如果正在拖拽，执行排序
      if (isDraggingRef.current && draggingIdRef.current) {
        const sourceId = draggingIdRef.current;
        const targetId = dragOverIdRef.current;
        const position = dragOverPositionRef.current;

        if (targetId && sourceId !== targetId) {
          reorderWorkspace(sourceId, targetId, position === 'before');
        }

        // 清理
        isDraggingRef.current = false;
        draggingIdRef.current = null;
        dragOverIdRef.current = null;
        setDraggingId(null);
        setDragOverId(null);
      }

      // 重置 mouseDown 记录
      mouseDownIdRef.current = null;
      mouseDownPosRef.current = null;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [workspaces, store, reorderWorkspace]);

  /** 遍历 itemRefs 找到 clientY 命中的项 */
  const hitTest = (clientY: number): string | null => {
    for (const [id, el] of itemRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return id;
      }
    }
    return null;
  };

  /** 设置 item 的 ref 引用 */
  const setItemRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(id, el);
    } else {
      itemRefs.current.delete(id);
    }
  }, []);

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
          {t('sidebar.workspaceList.empty')}
        </p>
      </div>
    );
  }

  const isSingleWorkspace = workspaces.length === 1;
  const isDragDisabled = isSingleWorkspace || !!editingId;

  return (
    <div ref={containerRef} className="thin-scrollbar flex-1 overflow-y-auto px-3 pt-0 pb-1 select-none">
      {workspaces.map(workspace => (
        <div
          key={workspace.id}
          ref={(el) => setItemRef(workspace.id, el)}
          onMouseDown={(e) => !isDragDisabled && handleItemMouseDown(e, workspace.id)}
        >
          <WorkspaceItem
            workspace={workspace}
            isSelected={selectedWorkspaceId === workspace.id}
            isEditing={editingId === workspace.id}
            isAddingRabbit={addingRabbitWorkspaceId === workspace.id}
            selectedRabbitId={selectedRabbitId}
            isDragging={draggingId === workspace.id}
            isDragOver={dragOverId === workspace.id}
            dragOverPosition={dragOverPosition}
            isDragDisabled={isDragDisabled}
            onSelect={() => store.selectWorkspace(workspace.id)}
            onToggleCollapse={() => store.toggleCollapse(workspace.id)}
            onRename={(name) => { store.renameWorkspace(workspace.id, name); store.endEdit(); }}
            onDelete={() => store.deleteWorkspace(workspace.id)}
            onStartEdit={() => store.startEdit(workspace.id)}
            onEndEdit={store.endEdit}
            onStartAddRabbit={() => store.startAddRabbit(workspace.id)}
            onAddRabbit={(title) => store.addRabbit(workspace.id, title)}
            onCancelAddRabbit={store.cancelAddRabbit}
            onRenameRabbit={(rabbitId, name) => store.renameRabbit(workspace.id, rabbitId, name)}
            onDeleteRabbit={(rabbitId) => store.deleteRabbit(workspace.id, rabbitId)}
            onSelectRabbit={(rabbitId) => store.selectRabbit(rabbitId)}
            onToggleRabbitComplete={(rabbitId) => store.toggleRabbitComplete(workspace.id, rabbitId)}
            onStartEditRabbit={(rabbitId) => store.startEdit(rabbitId)}
            onTogglePin={(rabbitId) => store.togglePin(workspace.id, rabbitId)}
            editingRabbitId={editingId}
            onOpenKnowledgeBase={() => onOpenKnowledgeBase(workspace.id)}
          />
        </div>
      ))}
    </div>
  );
}
