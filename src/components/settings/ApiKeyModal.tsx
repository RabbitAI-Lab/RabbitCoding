/**
 * ApiKeyModal 组件
 *
 * 首次使用时弹出，要求用户输入 Anthropic API Key。
 * Key 存储到 localStorage（后续可迁移到 Keychain）。
 */

import { useState } from 'react';
import { Key, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import Modal from '../common/Modal';
import { useI18n } from '../../i18n/useI18n';

interface ApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => void;
}

export default function ApiKeyModal({ open, onClose, onSave }: ApiKeyModalProps) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(t('apiKeyModal.required'));
      return;
    }

    if (!trimmed.startsWith('sk-ant-')) {
      setError(t('apiKeyModal.invalidFormat'));
      return;
    }

    setVerifying(true);
    setError('');

    try {
      // 简单验证：尝试启动 sidecar
      onSave(trimmed);
      setVerified(true);
      setTimeout(() => {
        onClose();
        setVerified(false);
        setApiKey('');
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeyModal.verifyFailed'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* 标题 */}
        <div className="flex items-center gap-2">
          <Key size={20} className="text-gray-500 dark:text-gray-400" />
          <h2 className="text-base font-medium text-[#141414] dark:text-gray-100">{t('apiKeyModal.title')}</h2>
        </div>

        {/* 说明 */}
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t('apiKeyModal.description')}
          你可以在 <a href="https://platform.claude.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)]">Claude Console</a> 获取 API Key。
        </p>

        {/* 输入框 */}
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setError(''); }}
            placeholder={t('apiKeyModal.placeholder')}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-3 py-2 pr-10 text-sm text-[#141414] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20 focus:border-[var(--brand-primary)]"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          />
          <button
            onClick={() => setShowKey(prev => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {/* 状态 */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
        {verified && (
          <div className="flex items-center gap-2 text-xs text-green-500 dark:text-green-400">
            <CheckCircle2 size={14} />
            <span>{t('apiKeyModal.saved')}</span>
          </div>
        )}

        {/* 按钮 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {t('apiKeyModal.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={verifying || verified || !apiKey.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs text-white bg-[var(--brand-solid)] hover:bg-[var(--brand-solid-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {verifying ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t('apiKeyModal.verifying')}
              </>
            ) : verified ? (
              <>
                <CheckCircle2 size={12} />
                {t('apiKeyModal.done')}
              </>
            ) : (
              t('apiKeyModal.save')
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
