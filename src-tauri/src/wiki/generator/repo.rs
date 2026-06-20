//! Wiki 生成管线 — 代码库级（repo-level）生成

use std::path::Path;

use crate::wiki::ai::run_ai_loop_with_retry;
use crate::wiki::prompts::{REPO_CATALOG_PROMPT, REPO_DOC_PROMPT};
use crate::wiki::tools::ToolContext;
use crate::wiki::types::{FailedDoc, RepoInfo, WikiMeta};

use super::catalog::load_catalog;
use super::helpers::{
    check_cancel, check_circuit_breaker, emit_progress, make_progress_base, GenCtx,
};
use super::meta::{new_repo_meta, save_meta};

/// 生成单个 repo 的 wiki（catalog + 文档）
///
/// 返回 `Ok(())` 表示此 repo 处理完毕（含软失败，跳到下一个 repo）；
/// 返回 `Err` 表示取消或熔断，应终止整个生成流程。
pub(super) async fn generate_repo_wiki(
    ctx: &GenCtx<'_>,
    repos_wiki_dir: &Path,
    meta: &mut WikiMeta,
    consecutive_failures: &mut u32,
    repo: &RepoInfo,
) -> Result<(), String> {
    let repo_name = &repo.name;
    let repo_path = Path::new(&repo.path);
    let repo_output_dir = repos_wiki_dir.join(repo_name);

    eprintln!("[wiki] === Repo: {repo_name} ({}) ===", repo.path);

    // 取消 / 熔断检查
    check_cancel(ctx.cancel_flag, ctx.codewiki_dir, meta)?;
    check_circuit_breaker(
        ctx.app_handle,
        ctx.task_id,
        *consecutive_failures,
        ctx.max_consecutive,
        ctx.codewiki_dir,
        meta,
        Some(repo_name),
        None,
        None,
    )?;

    // 取出 repo_meta 的克隆（避免借用冲突）
    let repo_meta_value = meta
        .repos
        .entry(repo_name.clone())
        .or_insert_with(new_repo_meta)
        .clone();
    let mut repo_meta = repo_meta_value;

    // ── catalog 阶段 ──
    if !repo_meta.catalog_done {
        emit_progress(
            ctx.app_handle,
            ctx.task_id,
            "repo_catalog",
            Some(repo_name),
            format!("Generating catalog for {repo_name}..."),
            None,
            None,
        );

        std::fs::create_dir_all(&repo_output_dir)
            .map_err(|e| format!("Failed to create repo output dir: {e}"))?;

        let tool_ctx = ToolContext {
            working_dir: repo_path,
            output_dir: &repo_output_dir,
            repos_wiki_dir,
            ignored: ctx.ignored,
        };

        let user_msg = format!(
            "Analyze the code repository at the current working directory and generate a documentation catalog.\n\nLanguage: {}",
            if ctx.lang == "en" { "English" } else { "中文" }
        );

        let progress_base =
            make_progress_base(ctx.task_id, "repo_catalog", Some(repo_name), None, None);

        match run_ai_loop_with_retry(
            &ctx.payload.base_url,
            &ctx.payload.api_key,
            &ctx.payload.model_id,
            REPO_CATALOG_PROMPT,
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
                repo_meta.catalog_done = true;
                meta.repos.insert(repo_name.clone(), repo_meta.clone());
                save_meta(ctx.codewiki_dir, meta).ok();
            }
            Err(e) if e == "cancelled" => {
                meta.repos.insert(repo_name.clone(), repo_meta.clone());
                save_meta(ctx.codewiki_dir, meta).ok();
                return Err(e);
            }
            Err(e) => {
                *consecutive_failures += 1;
                repo_meta.failed_docs.push(FailedDoc {
                    path: "_catalog".to_string(),
                    error: e.clone(),
                    retries: ctx.max_retries,
                });
                repo_meta.status = "error".to_string();
                meta.repos.insert(repo_name.clone(), repo_meta.clone());
                save_meta(ctx.codewiki_dir, meta).ok();
                emit_progress(
                    ctx.app_handle,
                    ctx.task_id,
                    "repo_catalog_error",
                    Some(repo_name),
                    format!("Catalog failed for {repo_name}: {e}"),
                    None,
                    None,
                );
                // 跳过此 repo 的文档生成
                return Ok(());
            }
        }
    } else {
        emit_progress(
            ctx.app_handle,
            ctx.task_id,
            "repo_catalog",
            Some(repo_name),
            format!("Catalog already done for {repo_name}, skipping"),
            None,
            None,
        );
    }

    // ── 加载 catalog 叶子节点 ──
    let leaves = match load_catalog(&repo_output_dir) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[wiki] Failed to load catalog for {repo_name}: {e}");
            emit_progress(
                ctx.app_handle,
                ctx.task_id,
                "repo_documents",
                Some(repo_name),
                format!("Cannot load catalog for {repo_name}: {e}"),
                None,
                None,
            );
            return Ok(());
        }
    };

    let total = leaves.len() as i32;
    eprintln!("[wiki] Repo {repo_name} has {total} documents to generate");

    // ── 文档生成循环 ──
    for (i, (doc_path, doc_title)) in leaves.iter().enumerate() {
        // 取消 / 熔断检查
        check_cancel(ctx.cancel_flag, ctx.codewiki_dir, meta)?;
        check_circuit_breaker(
            ctx.app_handle,
            ctx.task_id,
            *consecutive_failures,
            ctx.max_consecutive,
            ctx.codewiki_dir,
            meta,
            Some(repo_name),
            Some(i as i32),
            Some(total),
        )?;

        let current = i as i32 + 1;

        // 断点续传：跳过已完成
        if repo_meta.completed_docs.contains(doc_path) {
            *consecutive_failures = 0; // 成功重置计数
            emit_progress(
                ctx.app_handle,
                ctx.task_id,
                "repo_documents",
                Some(repo_name),
                format!("[{current}/{total}] {doc_title} (already done)"),
                Some(current),
                Some(total),
            );
            continue;
        }

        emit_progress(
            ctx.app_handle,
            ctx.task_id,
            "repo_documents",
            Some(repo_name),
            format!("[{current}/{total}] Generating: {doc_title}"),
            Some(current),
            Some(total),
        );

        let tool_ctx = ToolContext {
            working_dir: repo_path,
            output_dir: &repo_output_dir,
            repos_wiki_dir,
            ignored: ctx.ignored,
        };

        let user_msg = format!(
            "Write a detailed documentation page for the topic: {}\n\nDocument path: {}\n\nExplore the codebase using the available tools and write comprehensive documentation. Language: {}",
            doc_title,
            doc_path,
            if ctx.lang == "en" { "English" } else { "中文" }
        );

        let progress_base = make_progress_base(
            ctx.task_id,
            "repo_documents",
            Some(repo_name),
            Some(current),
            Some(total),
        );

        match run_ai_loop_with_retry(
            &ctx.payload.base_url,
            &ctx.payload.api_key,
            &ctx.payload.model_id,
            REPO_DOC_PROMPT,
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
                let expected_file = repo_output_dir.join(format!("{doc_path}.md"));
                if expected_file.exists() {
                    repo_meta.completed_docs.push(doc_path.clone());
                    repo_meta.failed_docs.retain(|f| f.path != *doc_path);
                    *consecutive_failures = 0;
                } else {
                    let err_msg = "AI completed but file was not written (write_doc tool may not have been called)".to_string();
                    eprintln!("[wiki] WARNING: {err_msg} — expected: {}", expected_file.display());
                    repo_meta.failed_docs.push(FailedDoc {
                        path: doc_path.clone(),
                        error: err_msg.clone(),
                        retries: ctx.max_retries,
                    });
                    *consecutive_failures += 1;
                }
            }
            Err(e) if e == "cancelled" => {
                meta.repos.insert(repo_name.clone(), repo_meta.clone());
                save_meta(ctx.codewiki_dir, meta).ok();
                return Err(e);
            }
            Err(e) => {
                repo_meta.failed_docs.push(FailedDoc {
                    path: doc_path.clone(),
                    error: e.clone(),
                    retries: ctx.max_retries,
                });
                *consecutive_failures += 1;
                emit_progress(
                    ctx.app_handle,
                    ctx.task_id,
                    "repo_documents_error",
                    Some(repo_name),
                    format!("[{current}/{total}] Failed: {doc_title} - {e}"),
                    Some(current),
                    Some(total),
                );
            }
        }

        // 每篇完成即持久化
        meta.repos.insert(repo_name.clone(), repo_meta.clone());
        save_meta(ctx.codewiki_dir, meta).ok();
    }

    // 更新 repo 最终状态
    repo_meta.status = if repo_meta.failed_docs.is_empty() {
        "done".to_string()
    } else {
        "partial".to_string()
    };
    meta.repos.insert(repo_name.clone(), repo_meta);
    save_meta(ctx.codewiki_dir, meta).ok();

    Ok(())
}
