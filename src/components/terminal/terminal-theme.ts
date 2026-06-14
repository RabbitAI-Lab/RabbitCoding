import type { ITheme } from '@xterm/xterm';

/**
 * 亮色终端主题，与应用整体亮色风格保持一致
 */
export const terminalTheme: ITheme = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#333333',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff80',
  selectionForeground: '#1a1a1a',
  black: '#1a1a1a',
  red: '#c43b2e',
  green: '#26855a',
  yellow: '#a67c16',
  blue: '#2568c4',
  magenta: '#a94090',
  cyan: '#2a7a9c',
  white: '#b0b0b0',
  brightBlack: '#6e6e6e',
  brightRed: '#d94a3c',
  brightGreen: '#3daa73',
  brightYellow: '#c09522',
  brightBlue: '#3881de',
  brightMagenta: '#c252ac',
  brightCyan: '#379ab9',
  brightWhite: '#d4d4d4',
};

/**
 * 暗色终端主题，VS Code Dark+ 风格
 */
export const terminalThemeDark: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78aa',
  selectionForeground: '#d4d4d4',
  black: '#1e1e1e',
  red: '#f48771',
  green: '#89d185',
  yellow: '#e2c08d',
  blue: '#75beff',
  magenta: '#c586c0',
  cyan: '#9cdcfe',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f48771',
  brightGreen: '#89d185',
  brightYellow: '#e2c08d',
  brightBlue: '#75beff',
  brightMagenta: '#c586c0',
  brightCyan: '#9cdcfe',
  brightWhite: '#ffffff',
};
