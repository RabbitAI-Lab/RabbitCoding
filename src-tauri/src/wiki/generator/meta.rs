//! Wiki 生成管线 — _meta.json 持久化

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::wiki::types::{GenerateWikiPayload, RepoMeta, WikiMeta};

/// 获取 _meta.json 路径
pub(crate) fn meta_path(workspace_codewiki_dir: &Path) -> PathBuf {
    workspace_codewiki_dir.join("_meta.json")
}

/// 加载或初始化 meta（resume 模式下尝试读取已有 meta）
pub(crate) fn load_or_init_meta(
    workspace_codewiki_dir: &Path,
    payload: &GenerateWikiPayload,
) -> WikiMeta {
    let path = meta_path(workspace_codewiki_dir);
    if payload.resume_mode {
        if path.exists() {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(meta) = serde_json::from_str::<WikiMeta>(&json) {
                    return meta;
                }
            }
        }
    }
    WikiMeta {
        version: 1,
        workspace_name: payload.workspace_name.clone(),
        model_id: payload.model_id.clone(),
        language: payload.language.clone(),
        generated_at: chrono_timestamp(),
        status: String::new(),
        catalog_done: false,
        completed_docs: Vec::new(),
        failed_docs: Vec::new(),
        repos: HashMap::new(),
    }
}

/// 保存 meta 到磁盘
pub(crate) fn save_meta(workspace_codewiki_dir: &Path, meta: &WikiMeta) -> Result<(), String> {
    let path = meta_path(workspace_codewiki_dir);
    std::fs::create_dir_all(workspace_codewiki_dir)
        .map_err(|e| format!("Failed to create meta dir: {e}"))?;
    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Failed to serialize meta: {e}"))?;
    std::fs::write(&path, &json).map_err(|e| format!("Failed to write meta: {e}"))?;
    Ok(())
}

/// 当前时间戳（毫秒）
pub(super) fn chrono_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 清空输出目录（resume_mode=false 时调用）
pub(super) fn clear_output_dir(workspace_codewiki_dir: &Path) -> Result<(), String> {
    let repos_dir = workspace_codewiki_dir.join("repos");
    let workspace_dir = workspace_codewiki_dir.join("workspace");
    let meta_file = workspace_codewiki_dir.join("_meta.json");

    if repos_dir.exists() {
        std::fs::remove_dir_all(&repos_dir)
            .map_err(|e| format!("Failed to clear repos dir: {e}"))?;
    }
    if workspace_dir.exists() {
        std::fs::remove_dir_all(&workspace_dir)
            .map_err(|e| format!("Failed to clear workspace dir: {e}"))?;
    }
    // 不删 _meta.json 本身，会在后面重新写
    let _ = std::fs::remove_file(&meta_file);
    Ok(())
}

/// 初始化一个空的 RepoMeta（供 repo.rs 使用）
pub(super) fn new_repo_meta() -> RepoMeta {
    RepoMeta {
        status: String::new(),
        catalog_done: false,
        completed_docs: Vec::new(),
        failed_docs: Vec::new(),
    }
}
