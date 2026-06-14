import type { ReactNode } from 'react';

/** 分组卡片容器：标题 + 可选描述 + 圆角边框 */
export function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]">
      {/* 分组标题 */}
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-sm font-medium text-[#333333] dark:text-gray-100">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{description}</p>}
      </div>
      {/* 分组内容 */}
      <div className="px-5 pb-4">{children}</div>
    </div>
  );
}

/** 单行设置项：左侧 label/desc + 右侧控件 */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-xs text-[#333333] dark:text-gray-200">{label}</p>
        {description && <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

/** 纯 Tailwind 开关控件（无三方依赖） */
export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div className="h-5 w-9 rounded-full bg-gray-300 dark:bg-gray-600 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-4" />
    </label>
  );
}
