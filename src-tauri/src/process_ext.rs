//! 跨平台子进程辅助：Windows 下隐藏子进程控制台窗口。
//!
//! 背景：本应用 release 构建是 GUI 子系统（main.rs 的
//! `windows_subsystem = "windows"`），但 Windows 上 GUI 进程 spawn
//! 控制台子系统子进程（node.exe / git.exe / cmd / powershell / curl …）
//! 时，系统会为子进程分配一个**可见**控制台窗口（闪黑框）。
//! 设置 CREATE_NO_WINDOW (0x08000000) 后子进程不再创建窗口，
//! stdio 管道不受影响。非 Windows 平台为 no-op。

use std::process::Command;

/// Windows CREATE_NO_WINDOW 创建标志
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub trait CommandNoWindowExt {
    /// Windows 下设置 CREATE_NO_WINDOW，避免弹出控制台窗口；其他平台 no-op。
    fn no_window(&mut self) -> &mut Self;
}

impl CommandNoWindowExt for Command {
    #[cfg(target_os = "windows")]
    fn no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(target_os = "windows"))]
    fn no_window(&mut self) -> &mut Self {
        self
    }
}
