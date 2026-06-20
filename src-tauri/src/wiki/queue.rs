//! Wiki 生成模块 — 任务队列与 Worker

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::generator::execute_wiki_generation;
use super::notify::notify_wiki_status;
use super::types::GenerateWikiPayload;

// ============================================================
// 任务队列结构
// ============================================================

pub(crate) struct WikiTask {
    pub task_id: String,
    pub workspace_name: String,
    pub language: String,
    pub payload: GenerateWikiPayload,
    pub created_at: std::time::SystemTime,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub task_id: String,
    pub workspace_name: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub current: Option<TaskSnapshot>,
    pub queued: Vec<TaskSnapshot>,
}

/// 全局队列状态（Tauri managed state）
pub struct WikiQueueState {
    pub(super) sender: mpsc::UnboundedSender<WikiTask>,
    pub(super) current: Arc<Mutex<Option<TaskSnapshot>>>,
    pub(super) queued: Arc<Mutex<Vec<TaskSnapshot>>>,
    pub(super) cancel_flag: Arc<AtomicBool>,
    pub(super) app_handle: AppHandle,
}

impl WikiTask {
    pub(super) fn snapshot(&self, status: &str) -> TaskSnapshot {
        TaskSnapshot {
            task_id: self.task_id.clone(),
            workspace_name: self.workspace_name.clone(),
            status: status.to_string(),
            created_at: self
                .created_at
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
        }
    }
}

// ============================================================
// Worker 启动（在 lib.rs .setup() 中调用）
// ============================================================

/// 创建全局 Wiki 队列并启动 worker，返回 WikiQueueState
pub fn create_wiki_queue_and_worker(app_handle: AppHandle) -> WikiQueueState {
    let (tx, mut rx) = mpsc::unbounded_channel::<WikiTask>();
    let current: Arc<Mutex<Option<TaskSnapshot>>> = Arc::new(Mutex::new(None));
    let queued: Arc<Mutex<Vec<TaskSnapshot>>> = Arc::new(Vec::new().into());
    let cancel_flag = Arc::new(AtomicBool::new(false));

    let worker_cancel = cancel_flag.clone();
    let worker_current = current.clone();
    let worker_queued = queued.clone();
    let app_h = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(task) = rx.recv().await {
            // 从 queued 中移除
            {
                let mut q = worker_queued.lock().unwrap();
                q.retain(|s| s.task_id != task.task_id);
            }

            // 标记为 running
            {
                let mut cur = worker_current.lock().unwrap();
                *cur = Some(task.snapshot("running"));
            }
            worker_cancel.store(false, Ordering::SeqCst);

            // 通知前端：任务开始
            let _ = app_h.emit("wiki-task-started", &task.task_id);

            // 推送队列状态更新
            emit_queue_status(&app_h, &worker_current, &worker_queued);

            eprintln!(
                "[wiki] Worker started task: {} (workspace: {})",
                task.task_id, task.workspace_name
            );

            // 执行生成
            let result = execute_wiki_generation(&app_h, &task, &worker_cancel).await;

            // 标记完成
            {
                let mut cur = worker_current.lock().unwrap();
                *cur = None;
            }

            match result {
                Ok(()) => {
                    let _ = app_h.emit("wiki-task-done", &task.task_id);
                    eprintln!("[wiki] Task {} completed successfully", task.task_id);
                    // 桌面通知
                    notify_wiki_status(
                        "wiki_done",
                        &task.workspace_name,
                        "",
                        &task.language,
                    );
                }
                Err(e) => {
                    let _ = app_h.emit("wiki-task-error", (&task.task_id, &e));
                    eprintln!("[wiki] Task {} failed: {}", task.task_id, e);

                    // 判断是熔断还是普通错误
                    let kind = if e.contains("consecutive_failures_paused") {
                        "wiki_paused"
                    } else if e == "cancelled" {
                        // 取消不发通知
                        emit_queue_status(&app_h, &worker_current, &worker_queued);
                        continue;
                    } else {
                        "wiki_error"
                    };
                    notify_wiki_status(kind, &task.workspace_name, &e, &task.language);
                }
            }

            // 推送队列状态更新
            emit_queue_status(&app_h, &worker_current, &worker_queued);
        }
    });

    WikiQueueState {
        sender: tx,
        current,
        queued,
        cancel_flag,
        app_handle: app_handle.clone(),
    }
}

pub(super) fn emit_queue_status(
    app: &AppHandle,
    current: &Arc<Mutex<Option<TaskSnapshot>>>,
    queued: &Arc<Mutex<Vec<TaskSnapshot>>>,
) {
    let status = QueueStatus {
        current: current.lock().unwrap().clone(),
        queued: queued.lock().unwrap().clone(),
    };
    let _ = app.emit("wiki-queue-updated", &status);
}
