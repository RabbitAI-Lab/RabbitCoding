//! Wiki 生成管线 — 编排函数（两层架构调度）

use std::path::Path;
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Emitter};

use crate::wiki::queue::WikiTask;
use crate::wiki::types::{WikiMeta, WikiProgress};

use super::helpers::{check_circuit_breaker, GenCtx};
use super::meta::{chrono_timestamp, clear_output_dir, load_or_init_meta, save_meta};
use super::repo::generate_repo_wiki;
use super::workspace::generate_workspace_wiki;

/// 执行完整的 Wiki 生成（两层架构）
pub(crate) async fn execute_wiki_generation(
    app_handle: &AppHandle,
    task: &WikiTask,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let payload = &task.payload;
    let workspace_path = Path::new(&payload.workspace_path);
    let codewiki_dir = workspace_path.join(".rabbit").join("codewiki");
    let repos_wiki_dir = codewiki_dir.join("repos");
    let workspace_wiki_dir = codewiki_dir.join("workspace");
    let ignored = crate::wiki::wiki_ignored_names();

    // 创建 codewiki 目录
    std::fs::create_dir_all(&codewiki_dir)
        .map_err(|e| format!("Failed to create codewiki dir: {e}"))?;

    // 加载或初始化 meta
    let mut meta = if payload.resume_mode {
        load_or_init_meta(&codewiki_dir, payload)
    } else {
        clear_output_dir(&codewiki_dir)?;
        WikiMeta {
            version: 1,
            workspace_name: payload.workspace_name.clone(),
            model_id: payload.model_id.clone(),
            language: payload.language.clone(),
            generated_at: chrono_timestamp(),
            ..Default::default()
        }
    };

    let mut consecutive_failures: u32 = 0;
    let max_consecutive = payload.max_consecutive_failures.max(1);
    let max_retries = payload.max_retries.max(1);
    let lang = payload.language.as_str();
    let task_id = task.task_id.as_str();

    let ctx = GenCtx {
        app_handle,
        payload,
        task_id,
        cancel_flag,
        codewiki_dir: &codewiki_dir,
        ignored: &ignored,
        max_consecutive,
        max_retries,
        lang,
    };

    // ========================
    // 第一层：代码库级 wiki
    // ========================
    for repo in &payload.repos {
        generate_repo_wiki(&ctx, &repos_wiki_dir, &mut meta, &mut consecutive_failures, repo)
            .await?;
    }

    // 熔断检查（进入第二层前）
    check_circuit_breaker(
        app_handle,
        task_id,
        consecutive_failures,
        max_consecutive,
        &codewiki_dir,
        &mut meta,
        None,
        None,
        None,
    )?;

    // ========================
    // 第二层：项目空间级 wiki
    // ========================
    generate_workspace_wiki(
        &ctx,
        workspace_path,
        &workspace_wiki_dir,
        &repos_wiki_dir,
        &mut meta,
        &mut consecutive_failures,
    )
    .await?;

    // 最终状态更新
    meta.status = if meta.failed_docs.is_empty() {
        "done".to_string()
    } else {
        "partial".to_string()
    };
    meta.generated_at = chrono_timestamp();
    save_meta(&codewiki_dir, &meta).ok();

    let _ = app_handle.emit(
        "wiki-progress",
        WikiProgress {
            task_id: task_id.to_string(),
            phase: "done".to_string(),
            repo_name: None,
            message: format!(
                "Wiki generation complete. Failed: {}",
                meta.failed_docs.len()
            ),
            current: None,
            total: None,
            consecutive_failures: Some(consecutive_failures),
            max_consecutive_failures: Some(max_consecutive),
        },
    );

    Ok(())
}
