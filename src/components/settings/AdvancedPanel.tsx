import { AlertCircle } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { SettingSection, SettingRow, Toggle } from './settingsShared';
import { DEFAULT_PROXY_CONFIG } from '../../utils/proxy';
import type { ProxyConfig } from '../../types';

const inputClass =
  'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] px-3 py-2 text-sm text-[#141414] dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors';

const labelClass = 'block text-xs font-medium text-[#333333] dark:text-gray-200 mb-1';

export default function AdvancedPanel() {
  const { t } = useI18n();
  const [config, setConfig] = useLocalStorage<ProxyConfig>('proxy-config', DEFAULT_PROXY_CONFIG);

  const updateField = <K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      {/* 网络代理 */}
      <SettingSection
        title={t('settings.advanced.proxy.title')}
        description={t('settings.advanced.proxy.description')}
      >
        <SettingRow
          label={t('settings.advanced.proxy.enable')}
          description={t('settings.advanced.proxy.enableDesc')}
        >
          <Toggle checked={config.enabled} onChange={v => updateField('enabled', v)} />
        </SettingRow>

        {config.enabled && (
          <div className="mt-3 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
            {/* HTTP 代理 */}
            <div>
              <label className={labelClass}>{t('settings.advanced.proxy.http')}</label>
              <input
                type="text"
                value={config.httpProxy}
                onChange={e => updateField('httpProxy', e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className={inputClass}
              />
            </div>

            {/* HTTPS 代理 */}
            <div>
              <label className={labelClass}>{t('settings.advanced.proxy.https')}</label>
              <input
                type="text"
                value={config.httpsProxy}
                onChange={e => updateField('httpsProxy', e.target.value)}
                placeholder="http://127.0.0.1:7890"
                className={inputClass}
              />
            </div>

            {/* SOCKS 代理 */}
            <div>
              <label className={labelClass}>{t('settings.advanced.proxy.socks')}</label>
              <input
                type="text"
                value={config.socksProxy}
                onChange={e => updateField('socksProxy', e.target.value)}
                placeholder="socks5://127.0.0.1:1080"
                className={inputClass}
              />
            </div>

            {/* 不代理的地址 */}
            <div>
              <label className={labelClass}>{t('settings.advanced.proxy.noProxy')}</label>
              <input
                type="text"
                value={config.noProxy}
                onChange={e => updateField('noProxy', e.target.value)}
                placeholder="localhost,127.0.0.1"
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {t('settings.advanced.proxy.noProxyDesc')}
              </p>
            </div>

            {/* 重启提示 */}
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                {t('settings.advanced.proxy.restartNotice')}
              </p>
            </div>
          </div>
        )}
      </SettingSection>
    </div>
  );
}
