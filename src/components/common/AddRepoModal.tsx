import { useState, useRef, useEffect } from 'react';
import Modal from './Modal';
import { useI18n } from '../../i18n/useI18n';
import type { Repo } from '../../types';

interface AddRepoModalProps {
  open: boolean;
  repo?: Repo | null;
  onClose: () => void;
  onSubmit: (name: string, path: string) => void;
}

export default function AddRepoModal({ open, repo, onClose, onSubmit }: AddRepoModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(repo?.name ?? '');
      setPath(repo?.path ?? '');
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [open, repo]);

  const handleSubmit = () => {
    const trimmedName = name.trim();
    const trimmedPath = path.trim();
    if (!trimmedName || !trimmedPath) return;
    onSubmit(trimmedName, trimmedPath);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={repo ? t('addRepoModal.editTitle') : t('addRepoModal.title')}>
      <div className="flex flex-col gap-3">
        <input
          ref={nameRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('addRepoModal.namePlaceholder')}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 dark:border-gray-700 dark:bg-[#2a2a2a] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-500"
        />
        <input
          value={path}
          onChange={e => setPath(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('addRepoModal.pathPlaceholder')}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 dark:border-gray-700 dark:bg-[#2a2a2a] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-500"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
          >
            {t('addRepoModal.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !path.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 dark:hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {repo ? t('common.save') : t('addRepoModal.add')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
