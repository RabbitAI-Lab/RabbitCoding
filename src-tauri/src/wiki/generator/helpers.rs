//! Wiki 生成管线 — 共享辅助函数

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

use crate::wiki::types::{GenerateWikiPayload, WikiMeta, WikiProgress};

use super::meta::save_meta;

/// 生成上下文（在 orchestrator 中创建，传递给 repo/workspace 生成函数）
pub(super) struct GenCtx<'a> {
    pub app_handle: &'a AppHandle,
    pub payload: &'a GenerateWikiPayload,
    pub task_id: &'a str,
    pub cancel_flag: &'a AtomicBool,
    pub codewiki_dir: &'a Path,
    pub ignored: &'a HashSet<&'static str>,
    pub max_consecutive: u32,
    pub max_retries: u32,
    pub lang: &'a str,
}

/// 检查取消标志；如果已取消，保存 meta 并返回 Err("cancelled")
pub(super) fn check_cancel(
    cancel_flag: &AtomicBool,
    codewiki_dir: &Path,
    meta: &WikiMeta,
) -> Result<(), String> {
    if cancel_flag.load(Ordering::SeqCst) {
        save_meta(codewiki_dir, meta).ok();
        return Err("cancelled".to_string());
    }
    Ok(())
}

/// 检查连续失败熔断；如果触发，设置 meta.status=paused，保存，emit 进度，返回 Err
pub(super) fn check_circuit_breaker(
    app_handle: &AppHandle,
    task_id: &str,
    consecutive_failures: u32,
    max_consecutive: u32,
    codewiki_dir: &Path,
    meta: &mut WikiMeta,
    repo_name: Option<&str>,
    current: Option<i32>,
    total: Option<i32>,
) -> Result<(), String> {
    if consecutive_failures >= max_consecutive {
        let msg = format!("连续 {} 个文件生成失败，已暂停", consecutive_failures);
        meta.status = "paused".to_string();
        save_meta(codewiki_dir, meta).ok();
        let _ = app_handle.emit(
            "wiki-progress",
            WikiProgress {
                task_id: task_id.to_string(),
                phase: "paused".to_string(),
                repo_name: repo_name.map(|s| s.to_string()),
                message: msg.clone(),
                current,
                total,
                consecutive_failures: Some(consecutive_failures),
                max_consecutive_failures: Some(max_consecutive),
            },
        );
        return Err(format!("consecutive_failures_paused: {msg}"));
    }
    Ok(())
}

/// 发送进度事件
pub(super) fn emit_progress(
    app_handle: &AppHandle,
    task_id: &str,
    phase: &str,
    repo_name: Option<&str>,
    message: String,
    current: Option<i32>,
    total: Option<i32>,
) {
    let _ = app_handle.emit(
        "wiki-progress",
        WikiProgress {
            task_id: task_id.to_string(),
            phase: phase.to_string(),
            repo_name: repo_name.map(|s| s.to_string()),
            message,
            current,
            total,
            consecutive_failures: None,
            max_consecutive_failures: None,
        },
    );
}

/// 构造一个基础的 WikiProgress（用于 AI 调用循环）
pub(super) fn make_progress_base(
    task_id: &str,
    phase: &str,
    repo_name: Option<&str>,
    current: Option<i32>,
    total: Option<i32>,
) -> WikiProgress {
    WikiProgress {
        task_id: task_id.to_string(),
        phase: phase.to_string(),
        repo_name: repo_name.map(|s| s.to_string()),
        message: String::new(),
        current,
        total,
        consecutive_failures: None,
        max_consecutive_failures: None,
    }
}
