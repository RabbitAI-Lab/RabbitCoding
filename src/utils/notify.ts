/**
 * 通知工具模块
 *
 * 当 Agent 任务完成时，根据用户偏好发送桌面通知和/或声音提示。
 * 在窗口未聚焦时才触发，避免打扰正在使用应用的用户。
 *
 * 偏好键（与 GeneralPanel.tsx 保持一致）：
 * - pref-notify-task-done: 总开关
 * - pref-notify-desktop: 桌面通知
 * - pref-notify-sound: 声音提示
 */

// ---- localStorage 键名 ----
const PREF_TASK_DONE = 'pref-notify-task-done';
const PREF_DESKTOP = 'pref-notify-desktop';
const PREF_SOUND = 'pref-notify-sound';
const APP_LANGUAGE = 'app-language';

// ---- 本地化文案 ----
const TEXT = {
  zh: {
    taskDone: { title: '任务完成', body: 'Agent 任务已完成' },
    taskError: { title: '任务出错', body: 'Agent 任务执行出错' },
  },
  en: {
    taskDone: { title: 'Task Completed', body: 'Agent task completed' },
    taskError: { title: 'Task Error', body: 'Agent task encountered an error' },
  },
} as const;

// ---- 工具函数 ----

/** 从 localStorage 读取布尔偏好（JSON 反序列化，与 useLocalStorage 一致） */
function getBoolPref(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) === true : defaultValue;
  } catch {
    return defaultValue;
  }
}

/** 获取当前语言 */
function getLanguage(): 'zh' | 'en' {
  try {
    const raw = localStorage.getItem(APP_LANGUAGE);
    return raw ? (JSON.parse(raw) === 'en' ? 'en' : 'zh') : 'zh';
  } catch {
    return 'zh';
  }
}

// ---- 桌面通知 ----

/** 通过 Rust 后端发送桌面通知（osascript/PowerShell），绕过 dev 模式签名限制 */
async function sendDesktopNotificationViaRust(title: string, body: string): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const ok = await invoke<boolean>('send_desktop_notification', { title, body });
    console.debug('[notify] send_desktop_notification (Rust) result:', ok);
    return ok;
  } catch (e) {
    console.warn('[notify] Rust send_desktop_notification failed:', e);
    return false;
  }
}

/** 通过 Tauri notification 插件发送桌面通知（release 模式可靠，需应用签名） */
async function sendDesktopNotificationViaTauri(title: string, body: string): Promise<boolean> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification');

    let granted = await isPermissionGranted();
    console.debug('[notify] isPermissionGranted:', granted);
    const permission = await requestPermission();
    console.debug('[notify] requestPermission result:', permission);
    granted = granted || permission === 'granted';

    if (granted) {
      sendNotification({ title, body });
      console.debug('[notify] Tauri sendNotification called');
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[notify] Tauri 通知失败:', e);
    return false;
  }
}

/**
 * 发送桌面通知：根据构建模式动态切换优先级
 * - dev 模式：优先 Rust(osascript)，失败回退 Tauri 插件（绕过 ad-hoc 签名限制）
 * - release 模式：优先 Tauri 原生通知（显示应用名/图标），失败回退 osascript
 */
async function sendDesktopNotification(title: string, body: string): Promise<boolean> {
  const isDev = import.meta.env.DEV;
  console.debug('[notify] sendDesktopNotification:', { title, body, isDev });

  if (isDev) {
    // dev 模式：优先 osascript（绕过 ad-hoc 签名限制）
    const rustOk = await sendDesktopNotificationViaRust(title, body);
    if (rustOk) {
      console.debug('[notify] Rust 通知发送成功（dev 模式首选）');
      return true;
    }
    console.debug('[notify] Rust 通知失败，回退到 Tauri 插件');
    return await sendDesktopNotificationViaTauri(title, body);
  } else {
    // release 模式：优先 Tauri 原生通知（显示应用名/图标，系统设置可见）
    const tauriOk = await sendDesktopNotificationViaTauri(title, body);
    if (tauriOk) {
      console.debug('[notify] Tauri 原生通知发送成功（release 模式首选）');
      return true;
    }
    console.debug('[notify] Tauri 通知失败，回退到 Rust(osascript)');
    return await sendDesktopNotificationViaRust(title, body);
  }
}

/** 打开系统通知设置页面（macOS / Windows），通过 Rust 后端绕过 Tauri ACL 限制 */
export async function openNotificationSettings(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    console.debug('[notify] invoking open_notification_settings');
    await invoke('open_notification_settings');
    console.debug('[notify] 已打开系统通知设置');
  } catch (e) {
    console.warn('[notify] 无法打开系统通知设置:', e);
  }
}

// ---- 声音提示 ----

let audioCtx: AudioContext | null = null;

/** 使用 Web Audio API 播放一段短促的双音提示音（无需音频文件） */
function playBeep(): void {
  try {
    // 延迟创建 AudioContext（浏览器自动播放策略要求用户交互后才能创建）
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }

    // 窗口未聚焦时 AudioContext 可能被暂停，需要恢复
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // 第一音：A5 (880Hz)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.type = 'sine';
    osc1.frequency.value = 880;
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // 第二音：E6 (1319Hz)，延迟 0.15s
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.type = 'sine';
    osc2.frequency.value = 1319;
    gain2.gain.setValueAtTime(0, now + 0.15);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.17);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.42);
  } catch (e) {
    console.warn('[notify] 声音播放失败:', e);
  }
}

// ---- 主入口 ----

/**
 * Agent 任务完成/失败时调用，根据用户偏好发送通知。
 *
 * @param success  任务是否成功（result.subtype === 'success'）
 * @param taskName 任务名称（Rabbit 标题），可选，用于在通知正文中显示
 */
/**
 * 测试通知功能（供设置页"测试通知"按钮调用）
 * 同时发送桌面通知和播放声音，不受偏好设置限制
 */
/** 测试通知返回结果 */
export type TestNotificationResult = {
  ok: boolean;
  reason?: 'permission' | 'error';
};

/**
 * 测试通知功能（供设置页"测试通知"按钮调用）
 * 同时发送桌面通知和播放声音，不受偏好设置限制
 * 返回结果用于 UI 反馈
 */
export async function sendTestNotification(): Promise<TestNotificationResult> {
  const lang = getLanguage();
  console.debug('[notify] sendTestNotification called, lang:', lang);
  const ok = await sendDesktopNotification(
    lang === 'zh' ? '测试通知' : 'Test Notification',
    lang === 'zh' ? '通知功能正常工作！' : 'Notifications are working!',
  );
  playBeep();
  // macOS 下 sendNotification 可能静默成功（返回 ok=true）但通知实际不出现
  // 所以无论 ok 与否，测试时都给用户提示如果没看到可以打开设置
  return { ok };
}

/**
 * Agent 任务完成/失败时调用，根据用户偏好发送通知。
 *
 * @param success  任务是否成功（result.subtype === 'success'）
 * @param taskName 任务名称（Rabbit 标题），可选，用于在通知正文中显示
 */
export async function notifyTaskResult(
  success: boolean,
  taskName?: string,
): Promise<void> {
  console.debug('[notify] notifyTaskResult called', { success, taskName });

  // 1. 总开关：未开启则直接返回
  if (!getBoolPref(PREF_TASK_DONE, true)) {
    console.debug('[notify] 总开关已关闭，跳过通知');
    return;
  }

  // 2. 窗口聚焦检测：仅记录日志，不拦截（确保用户能看到通知）
  if (document.hasFocus()) {
    console.debug('[notify] 窗口已聚焦，仍发送通知');
  }

  const taskDone = getBoolPref(PREF_TASK_DONE, true);
  const desktop = getBoolPref(PREF_DESKTOP, true);
  const sound = getBoolPref(PREF_SOUND, false);
  console.debug('[notify] prefs:', { taskDone, desktop, sound });

  const lang = getLanguage();
  const text = TEXT[lang];
  const result = success ? text.taskDone : text.taskError;

  const title = result.title;
  const body = taskName
    ? lang === 'zh'
      ? `${result.body}：${taskName}`
      : `${result.body}: ${taskName}`
    : result.body;

  // 3. 桌面通知渠道
  if (desktop) {
    void sendDesktopNotification(title, body);
  } else {
    console.debug('[notify] 桌面通知已关闭，跳过');
  }

  // 4. 声音提示渠道
  if (sound) {
    playBeep();
  } else {
    console.debug('[notify] 声音提示已关闭，跳过');
  }
}
