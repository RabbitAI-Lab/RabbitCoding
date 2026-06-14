/**
 * 平台检测工具
 * 用于跨平台适配（macOS 交通灯 padding、shell 选择等）
 */

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const isWindows =
  typeof navigator !== 'undefined' &&
  /Win/.test(navigator.platform);

/**
 * macOS 交通灯区域预留宽度（Overlay 标题栏样式）
 * Windows / Linux 不需要此 padding
 */
export const titleBarPadding = isMac ? 'pl-[78px]' : 'pl-4';
