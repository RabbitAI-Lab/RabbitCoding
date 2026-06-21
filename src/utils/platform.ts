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
 * Windows ARM64 检测（sherpa-onnx 不支持该平台，语音功能不可用）
 * Windows on ARM 的 UA 字符串包含 "ARM" 或 "Windows NT ... ARM"
 */
export const isWindowsArm64 =
  typeof navigator !== 'undefined' &&
  isWindows &&
  /ARM/i.test(navigator.userAgent);

/**
 * macOS 交通灯区域预留宽度（Overlay 标题栏样式）
 * Windows / Linux 不需要此 padding
 */
export const titleBarPadding = isMac ? 'pl-[78px]' : 'pl-4';
