//! Wiki 生成管线 — 项目空间级（workspace-level）生成

use std::path::Path;

use crate::wiki::ai::run_ai_loop_with_retry;
use crate::wiki::prompts::{WORKSPACE_CATALOG_PROMPT, WORKSPACE_DOC_PROMPT};
use crate::wiki::tools::ToolContext;
use crate::wiki::types::{FailedDoc, WikiMeta};

use super::catalog::load_catalog;
use super::helpers::{
    check_cancel, check_circuit_breaker, emit_progress, filter_target_leaves,
    make_progress_base, GenCtx,
};
use super::meta::save_meta;

/// 生成 workspace 级 wiki（catalog + 文档）
///
/// 返回 `Ok(())` 表示处理完成（含 catalog 加载失败的软完成）；
/// 返回 `Err` 表示取消、熔断或 catalog 生成失败。
pub(super) async fn generate_workspace_wiki(
    ctx: &GenCtx<'_>,
    workspace_path: &Path,
    workspace_wiki_dir: &Path,
    repos_wiki_dir: &Path,
    meta: &mut WikiMeta,
    consecutive_failures: &mut u32,
) -> Result<(), String> {
    eprintln!("[wiki] === Workspace-level wiki ===");
    std::fs::create_dir_all(workspace_wiki_dir)
        .map_err(|e| format!("Failed to create workspace wiki dir: {e}"))?;

    // ── catalog 阶段 ──
    if !meta.catalog_done {
        emit_progress(
            ctx.app_handle,
            ctx.task_id,
            "workspace_catalog",
            None,
            "Generating workspace catalog...".to_string(),
            None,
            None,
        );

        let tool_ctx = ToolContext {
            working_dir: workspace_path,
            output_dir: workspace_wiki_dir,
            repos_wiki_dir,
            ignored: ctx.ignored,
        };

        let user_msg = format!(
            "Create a workspace-level documentation catalog for the project workspace.\n\nThe workspace contains repositories: {}\nThere may be a `docs/` directory with human-written documentation.\nRead the existing repo wikis and docs to synthesize a workspace-level catalog.\n\nLanguage: {}",
            ctx.payload
                .repos
                .iter()
                .map(|r| r.name.clone())
                .collect::<Vec<_>>()
                .join(", "),
            if ctx.lang == "en" { "English" } else { "中文" }
        );

        let progress_base =
            make_progress_base(ctx.task_id, "workspace_catalog", None, None, None);

        match run_ai_loop_with_retry(
            &ctx.payload.base_url,
            &ctx.payload.api_key,
            &ctx.payload.model_id,
            WORKSPACE_CATALOG_PROMPT,
            &user_msg,
            &tool_ctx,
            ctx.app_handle,
            &progress_base,
            ctx.cancel_flag,
            ctx.max_retries,
        )
        .await
        {
            Ok(()) => {
                meta.catalog_done = true;
                save_meta(ctx.codewiki_dir, meta).ok();
            }
            Err(e) if e == "cancelled" => {
                save_meta(ctx.codewiki_dir, meta).ok();
                return Err(e);
            }
            Err(e) => {
                *consecutive_failures += 1;
                meta.failed_docs.push(FailedDoc {
                    path: "_workspace_catalog".to_string(),
                    error: e.clone(),
                    retries: ctx.max_retries,
                });
                meta.status = "error".to_string();
                save_meta(ctx.codewiki_dir, meta).ok();
                // catalog 失败则无法生成文档，直接结束
                return Err(format!("Workspace catalog failed: {e}"));
            }
        }
    }

    // ── 加载 catalog 叶子节点 ──
    let mut ws_leaves = match load_catalog(workspace_wiki_dir) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[wiki] Failed to load workspace catalog: {e}");
            emit_progress(
                ctx.app_handle,
                ctx.task_id,
                "workspace_documents",
                None,
                format!("Cannot load workspace catalog: {e}"),
                None,
                None,
            );
            // catalog 加载失败也视为完成（repos 级已经可用）
            meta.status = "done".to_string();
            save_meta(ctx.codewiki_dir, meta).ok();
            return Ok(());
        }
    };

    // 定向生成：仅保留目标文档（非定向模式无操作）
    filter_target_leaves(ctx.payload, &mut ws_leaves);

    let ws_total = ws_leaves.len() as i32;

    // ── 文档生成循环 ──
    for (i, (doc_path, doc_title)) in ws_leaves.iter().enumerate() {
        // 取消 / 熔断检查
        check_cancel(ctx.cancel_flag, ctx.codewiki_dir, meta)?;
        check_circuit_breaker(
            ctx.app_handle,
            ctx.task_id,
            *consecutive_failures,
            ctx.max_consecutive,
            ctx.codewiki_dir,
            meta,
            None,
            None,
            None,
        )?;

        let current = i as i32 + 1;

        // 断点续传
        if meta.completed_docs.contains(doc_path) {
            *consecutive_failures = 0;
            emit_progress(
                ctx.app_handle,
                ctx.task_id,
                "workspace_documents",
                None,
                format!("[{current}/{ws_total}] {doc_title} (already done)"),
                Some(current),
                Some(ws_total),
            );
            continue;
        }

        emit_progress(
            ctx.app_handle,
            ctx.task_id,
            "workspace_documents",
            None,
            format!("[{current}/{ws_total}] Generating: {doc_title}"),
            Some(current),
            Some(ws_total),
        );

        let tool_ctx = ToolContext {
            working_dir: workspace_path,
            output_dir: workspace_wiki_dir,
            repos_wiki_dir,
            ignored: ctx.ignored,
        };

        let user_msg = format!(
            "Write a comprehensive workspace-level documentation page for the topic: {}\n\nDocument path: {}\n\nThis page should synthesize knowledge across all repositories in the workspace. Read existing repo wikis using the `read_existing_wiki` tool. Language: {}",
            doc_title,
            doc_path,
            if ctx.lang == "en" { "English" } else { "中文" }
        );

        let progress_base = make_progress_base(
            ctx.task_id,
            "workspace_documents",
            None,
            Some(current),
            Some(ws_total),
        );

        match run_ai_loop_with_retry(
            &ctx.payload.base_url,
            &ctx.payload.api_key,
            &ctx.payload.model_id,
            WORKSPACE_DOC_PROMPT,
            &user_msg,
            &tool_ctx,
            ctx.app_handle,
            &progress_base,
            ctx.cancel_flag,
            ctx.max_retries,
        )
        .await
        {
            Ok(()) => {
                // 校验文件是否真正写入磁盘
                let expected_file = workspace_wiki_dir.join(format!("{doc_path}.md"));
                if expected_file.exists() {
                    meta.completed_docs.push(doc_path.clone());
                    meta.failed_docs.retain(|f| f.path != *doc_path);
                    *consecutive_failures = 0;
                } else {
                    let err_msg = "AI completed but file was not written (write_doc tool may not have been called)".to_string();
                    eprintln!("[wiki] WARNING: {err_msg} — expected: {}", expected_file.display());
                    meta.failed_docs.push(FailedDoc {
                        path: doc_path.clone(),
                        error: err_msg.clone(),
                        retries: ctx.max_retries,
                    });
                    *consecutive_failures += 1;
                }
            }
            Err(e) if e == "cancelled" => {
                save_meta(ctx.codewiki_dir, meta).ok();
                return Err(e);
            }
            Err(e) => {
                meta.failed_docs.push(FailedDoc {
                    path: doc_path.clone(),
                    error: e.clone(),
                    retries: ctx.max_retries,
                });
                *consecutive_failures += 1;
            }
        }

        save_meta(ctx.codewiki_dir, meta).ok();
    }

    Ok(())
}
