//! Wiki 生成模块 — 数据结构

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================
// 前端传入 / 内部使用的数据结构
// ============================================================

/// 前端 invoke 传入的生成参数
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerateWikiPayload {
    pub workspace_path: String,
    pub workspace_name: String,
    pub repos: Vec<RepoInfo>,
    pub model_id: String,
    pub api_key: String,
    pub base_url: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_true")]
    pub resume_mode: bool,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_max_consecutive")]
    pub max_consecutive_failures: u32,
    /// 定向生成：None = 生成所有未完成文档；Some = 仅生成列出的文档
    #[serde(default)]
    pub target_doc_paths: Option<Vec<String>>,
    /// 定向生成的作用域：None = workspace 级；Some(name) = 仅该 repo
    #[serde(default)]
    pub target_repo_name: Option<String>,
}

pub fn default_language() -> String {
    "zh".to_string()
}

pub fn default_true() -> bool {
    true
}

pub fn default_max_retries() -> u32 {
    super::DEFAULT_MAX_RETRIES
}

pub fn default_max_consecutive() -> u32 {
    super::DEFAULT_MAX_CONSECUTIVE_FAILURES
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    #[allow(dead_code)]
    pub id: String,
    pub name: String,
    pub path: String,
}

/// 重试失败项的 payload
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryFailedPayload {
    pub workspace_path: String,
    pub workspace_name: String,
    pub repos: Vec<RepoInfo>,
    pub model_id: String,
    pub api_key: String,
    pub base_url: String,
    #[serde(default = "default_language")]
    pub language: String,
    /// None = 重试全部失败项；Some = 只重试指定路径
    pub doc_paths: Option<Vec<String>>,
    /// None = workspace 级；Some = 指定 repo 名
    pub repo_name: Option<String>,
}

/// _meta.json 断点续传结构
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WikiMeta {
    pub version: u32,
    pub workspace_name: String,
    pub model_id: String,
    pub language: String,
    pub generated_at: i64,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub catalog_done: bool,
    #[serde(default)]
    pub completed_docs: Vec<String>,
    #[serde(default)]
    pub failed_docs: Vec<FailedDoc>,
    #[serde(default)]
    pub repos: HashMap<String, RepoMeta>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoMeta {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub catalog_done: bool,
    #[serde(default)]
    pub completed_docs: Vec<String>,
    #[serde(default)]
    pub failed_docs: Vec<FailedDoc>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FailedDoc {
    pub path: String,
    pub error: String,
    pub retries: u32,
}

/// 进度事件 payload（通过 Tauri Events emit 到前端）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WikiProgress {
    pub task_id: String,
    pub phase: String,
    pub repo_name: Option<String>,
    pub message: String,
    pub current: Option<i32>,
    pub total: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consecutive_failures: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_consecutive_failures: Option<u32>,
}

/// 目录 JSON 结构（AI 通过 write_catalog 工具写入）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatalogNode {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub children: Option<Vec<CatalogNode>>,
}
