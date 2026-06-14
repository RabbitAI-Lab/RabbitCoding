import WorkspaceItem from './WorkspaceItem';
import type { useWorkspaces } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n/useI18n';

interface WorkspaceListProps {
  store: ReturnType<typeof useWorkspaces>;
}

export default function WorkspaceList({ store }: WorkspaceListProps) {
  const { t } = useI18n();
  const {
    workspaces,
    selectedWorkspaceId,
    selectedRabbitId,
    editingId,
    addingRabbitWorkspaceId,
  } = store;

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
          {t('sidebar.workspaceList.empty')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 pt-0 pb-1">
      {workspaces.map(workspace => (
        <WorkspaceItem
          key={workspace.id}
          workspace={workspace}
          isSelected={selectedWorkspaceId === workspace.id}
          isEditing={editingId === workspace.id}
          isAddingRabbit={addingRabbitWorkspaceId === workspace.id}
          selectedRabbitId={selectedRabbitId}
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
        />
      ))}
    </div>
  );
}
