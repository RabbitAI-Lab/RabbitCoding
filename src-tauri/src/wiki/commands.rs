//! Wiki 生成模块 — Tauri 命令

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{command, State};

use super::generator::{load_or_init_meta, meta_path, save_meta};
use super::queue::{emit_queue_status, QueueStatus, WikiQueueState, WikiTask};
use super::types::{CatalogNode, GenerateWikiPayload, RetryFailedPayload, WikiMeta};
use super::utils::simple_uuid;

// ============================================================
// Tauri 命令
// ============================================================

/// 入队任务（立即返回 taskId）
#[command]
pub fn generate_ai_wiki(
    state: State<'_, WikiQueueState>,
    payload: GenerateWikiPayload,
) -> Result<String, String> {
    let task_id = format!("wiki-{}", simple_uuid());
    let now = std::time::SystemTime::now();
    let task = WikiTask {
        task_id: task_id.clone(),
        workspace_name: payload.workspace_name.clone(),
        language: payload.language.clone(),
        payload,
        created_at: now,
    };

    let snapshot = task.snapshot("queued");
    state.queued.lock().unwrap().push(snapshot.clone());
    state
        .sender
        .send(task)
        .map_err(|_| "Queue send failed".to_string())?;

    // 推送队列状态
    let app = state.app_handle.clone();
    emit_queue_status(&app, &state.current, &state.queued);

    eprintln!("[wiki] Task {task_id} enqueued");
    Ok(task_id)
}

/// 查询队列状态
#[command]
pub fn wiki_queue_status(state: State<'_, WikiQueueState>) -> Result<QueueStatus, String> {
    Ok(QueueStatus {
        current: state.current.lock().unwrap().clone(),
        queued: state.queued.lock().unwrap().clone(),
    })
}

/// 取消当前任务或移除排队任务
#[command]
pub fn wiki_cancel(state: State<'_, WikiQueueState>, task_id: String) -> Result<(), String> {
    // 如果是当前任务：设置 cancel_flag
    {
        let cur = state.current.lock().unwrap();
        if let Some(current) = cur.as_ref() {
            if current.task_id == task_id {
                drop(cur);
                state.cancel_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                eprintln!("[wiki] Cancel requested for running task {task_id}");
                return Ok(());
            }
        }
    }
    // 如果是排队任务：从 queued 中移除
    {
        let mut q = state.queued.lock().unwrap();
        let before = q.len();
        q.retain(|s| s.task_id != task_id);
        if q.len() < before {
            eprintln!("[wiki] Removed queued task {task_id}");
        }
    }
    Ok(())
}

/// 清空队列（不取消当前任务）
#[command]
pub fn wiki_clear_queue(state: State<'_, WikiQueueState>) -> Result<(), String> {
    state.queued.lock().unwrap().clear();
    Ok(())
}

/// 查询 _meta.json 状态
#[command]
pub fn wiki_meta_status(workspace_path: String) -> Result<Option<WikiMeta>, String> {
    let codewiki_dir = Path::new(&workspace_path).join(".rabbit").join("codewiki");
    let meta_file = meta_path(&codewiki_dir);
    if !meta_file.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&meta_file)
        .map_err(|e| format!("Failed to read meta: {e}"))?;
    let meta: WikiMeta = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse meta: {e}"))?;
    Ok(Some(meta))
}

/// 重试失败的文档
#[command]
pub fn wiki_retry_failed(
    state: State<'_, WikiQueueState>,
    payload: RetryFailedPayload,
) -> Result<String, String> {
    let workspace_path = Path::new(&payload.workspace_path);
    let codewiki_dir = workspace_path.join(".rabbit").join("codewiki");

    // 读取当前 meta
    let mut meta = load_or_init_meta(
        &codewiki_dir,
        &GenerateWikiPayload {
            workspace_path: payload.workspace_path.clone(),
            workspace_name: payload.workspace_name.clone(),
            repos: payload.repos.clone(),
            model_id: payload.model_id.clone(),
            api_key: payload.api_key.clone(),
            base_url: payload.base_url.clone(),
            language: payload.language.clone(),
            resume_mode: true,
            max_retries: super::DEFAULT_MAX_RETRIES,
            max_consecutive_failures: super::DEFAULT_MAX_CONSECUTIVE_FAILURES,
        },
    );

    // 收集要重试的失败项
    let docs_to_retry: Vec<String> = if let Some(paths) = &payload.doc_paths {
        // 单文件/指定文件重试
        paths.clone()
    } else {
        // 批量重试全部
        if let Some(repo_name) = &payload.repo_name {
            if let Some(repo_meta) = meta.repos.get(repo_name) {
                repo_meta.failed_docs.iter().map(|f| f.path.clone()).collect()
            } else {
                Vec::new()
            }
        } else {
            // workspace 级
            meta.failed_docs.iter().map(|f| f.path.clone()).collect()
        }
    };

    if docs_to_retry.is_empty() {
        return Err("No failed documents to retry".to_string());
    }

    // 清除对应的 failedDocs 记录（移回待生成队列）
    if let Some(repo_name) = &payload.repo_name {
        if let Some(repo_meta) = meta.repos.get_mut(repo_name) {
            repo_meta
                .failed_docs
                .retain(|f| !docs_to_retry.contains(&f.path));
        }
    } else {
        meta.failed_docs
            .retain(|f| !docs_to_retry.contains(&f.path));
    }
    // 同时从 completed_docs 中移除（确保会重新生成）
    if let Some(repo_name) = &payload.repo_name {
        if let Some(repo_meta) = meta.repos.get_mut(repo_name) {
            repo_meta
                .completed_docs
                .retain(|p| !docs_to_retry.contains(p));
        }
    } else {
        meta.completed_docs
            .retain(|p| !docs_to_retry.contains(p));
    }

    save_meta(&codewiki_dir, &meta)?;

    // 以 resumeMode 重新入队
    let gen_payload = GenerateWikiPayload {
        workspace_path: payload.workspace_path,
        workspace_name: payload.workspace_name,
        repos: payload.repos,
        model_id: payload.model_id,
        api_key: payload.api_key,
        base_url: payload.base_url,
        language: payload.language,
        resume_mode: true,
        max_retries: super::DEFAULT_MAX_RETRIES,
        max_consecutive_failures: super::DEFAULT_MAX_CONSECUTIVE_FAILURES,
    };

    let task_id = format!("wiki-retry-{}", simple_uuid());
    let task = WikiTask {
        task_id: task_id.clone(),
        workspace_name: gen_payload.workspace_name.clone(),
        language: gen_payload.language.clone(),
        payload: gen_payload,
        created_at: std::time::SystemTime::now(),
    };

    state.queued.lock().unwrap().push(task.snapshot("queued"));
    state
        .sender
        .send(task)
        .map_err(|_| "Queue send failed".to_string())?;

    let app = state.app_handle.clone();
    emit_queue_status(&app, &state.current, &state.queued);

    Ok(task_id)
}

// ============================================================
// 目录树读取
// ============================================================

/// 读取两层目录树（repos + workspace）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodewikiTree {
    pub repos: Vec<RepoTreeEntry>,
    pub workspace: Vec<CodeWikiEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoTreeEntry {
    pub name: String,
    pub entries: Vec<CodeWikiEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodeWikiEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<CodeWikiEntry>>,
}

fn read_tree(dir: &Path) -> Vec<CodeWikiEntry> {
    let mut items = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return items;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase()),
        }
    });

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let children = if is_dir {
            Some(read_tree(&path))
        } else {
            None
        };
        items.push(CodeWikiEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_directory: is_dir,
            children,
        });
    }
    items
}

/// 读取两层目录树
#[command]
pub fn list_codewiki_tree(workspace_path: String) -> Result<CodewikiTree, String> {
    let codewiki_dir = Path::new(&workspace_path)
        .join(".rabbit")
        .join("codewiki");
    let repos_dir = codewiki_dir.join("repos");
    let workspace_dir = codewiki_dir.join("workspace");

    let mut repos = Vec::new();
    if repos_dir.exists() {
        let Ok(entries) = std::fs::read_dir(&repos_dir) else {
            return Ok(CodewikiTree {
                repos: Vec::new(),
                workspace: Vec::new(),
            });
        };
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(".") {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                repos.push(RepoTreeEntry {
                    name,
                    entries: read_tree(&path),
                });
            }
        }
        repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }

    let workspace = if workspace_dir.exists() {
        read_tree(&workspace_dir)
    } else {
        Vec::new()
    };

    Ok(CodewikiTree { repos, workspace })
}

// ============================================================
// Catalog 目录树读取（语义级）
// ============================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogsTree {
    pub repos: Vec<RepoCatalog>,
    pub workspace: Option<CatalogNode>,
    /// catalog 中有叶子节点但磁盘上 .md 文件缺失的路径列表
    pub missing_file_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoCatalog {
    pub name: String,
    pub catalog: Option<CatalogNode>,
}

/// 递归收集 catalog 中所有叶子节点（Document）的 path
fn collect_leaf_paths(node: &CatalogNode, out: &mut Vec<String>) {
    if let Some(children) = &node.children {
        for child in children {
            collect_leaf_paths(child, out);
        }
    } else if node.path.is_some() {
        if let Some(p) = &node.path {
            out.push(p.clone());
        }
    }
}

/// 读取语义级目录树（_catalog.json），同时交叉校验磁盘文件是否存在
#[command]
pub fn list_codewiki_catalogs(workspace_path: String) -> Result<CatalogsTree, String> {
    let codewiki_dir = Path::new(&workspace_path)
        .join(".rabbit")
        .join("codewiki");

    let mut missing_file_paths = Vec::new();

    // repos
    let repos_dir = codewiki_dir.join("repos");
    let mut repos = Vec::new();
    if repos_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&repos_dir) {
            for entry in entries.filter_map(Result::ok) {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let path = entry.path();
                if path.is_dir() {
                    let catalog_file = path.join("_catalog.json");
                    let catalog = if catalog_file.exists() {
                        std::fs::read_to_string(&catalog_file)
                            .ok()
                            .and_then(|json| serde_json::from_str::<CatalogNode>(&json).ok())
                    } else {
                        None
                    };
                    // 校验：遍历 catalog 叶子节点，检查 .md 文件是否存在
                    if let Some(ref cat) = catalog {
                        let mut leaf_paths = Vec::new();
                        collect_leaf_paths(cat, &mut leaf_paths);
                        for doc_path in &leaf_paths {
                            let md_file = path.join(format!("{doc_path}.md"));
                            if !md_file.exists() {
                                missing_file_paths.push(format!("repos/{name}/{doc_path}.md"));
                            }
                        }
                    }
                    repos.push(RepoCatalog { name, catalog });
                }
            }
        }
        repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }

    // workspace
    let ws_dir = codewiki_dir.join("workspace");
    let ws_catalog_file = ws_dir.join("_catalog.json");
    let workspace = if ws_catalog_file.exists() {
        std::fs::read_to_string(&ws_catalog_file)
            .ok()
            .and_then(|json| serde_json::from_str::<CatalogNode>(&json).ok())
    } else {
        None
    };
    // 校验 workspace catalog 叶子节点
    if let Some(ref cat) = workspace {
        let mut leaf_paths = Vec::new();
        collect_leaf_paths(cat, &mut leaf_paths);
        for doc_path in &leaf_paths {
            let md_file = ws_dir.join(format!("{doc_path}.md"));
            if !md_file.exists() {
                missing_file_paths.push(format!("workspace/{doc_path}.md"));
            }
        }
    }

    Ok(CatalogsTree { repos, workspace, missing_file_paths })
}

// ============================================================
// 冷启动检测未完成 Wiki
// ============================================================

/// 前端传入的单个 workspace 检测项
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiWorkspaceCheck {
    pub workspace_id: String,
    pub workspace_path: String,
    pub workspace_name: String,
}

/// 未完成 Wiki 信息（返回给前端）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWikiInfo {
    pub workspace_id: String,
    pub workspace_name: String,
    pub status: String,
    pub completed_count: usize,
    pub failed_count: usize,
    pub catalog_done: bool,
}

/// 批量检测所有 workspace 的 wiki 生成状态
#[command]
pub fn wiki_check_pending(
    workspaces: Vec<WikiWorkspaceCheck>,
) -> Result<Vec<PendingWikiInfo>, String> {
    let mut pending = Vec::new();

    for ws in &workspaces {
        let codewiki_dir = Path::new(&ws.workspace_path)
            .join(".rabbit")
            .join("codewiki");
        let meta_file = meta_path(&codewiki_dir);

        if !meta_file.exists() {
            continue;
        }

        let json = match std::fs::read_to_string(&meta_file) {
            Ok(j) => j,
            Err(_) => continue,
        };

        let meta: WikiMeta = match serde_json::from_str(&json) {
            Ok(m) => m,
            Err(_) => continue,
        };

        // 已完成则跳过
        if meta.status == "done" {
            continue;
        }

        // 统计已完成 + 失败文档数
        let mut completed_count = meta.completed_docs.len();
        let mut failed_count = meta.failed_docs.len();
        for repo_meta in meta.repos.values() {
            completed_count += repo_meta.completed_docs.len();
            failed_count += repo_meta.failed_docs.len();
        }

        pending.push(PendingWikiInfo {
            workspace_id: ws.workspace_id.clone(),
            workspace_name: ws.workspace_name.clone(),
            status: meta.status.clone(),
            completed_count,
            failed_count,
            catalog_done: meta.catalog_done,
        });
    }

    Ok(pending)
}
