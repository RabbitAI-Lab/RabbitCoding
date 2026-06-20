//! AI 驱动 Wiki 生成模块
//!
//! 纯 Rust 后端实现：通过 Anthropic Messages API（tool_use 循环）让 AI 读源码、生成 wiki 文档。
//! 两层生成架构：repo 级 + workspace 级。
//! 全局任务队列：mpsc channel + 单 worker，并发=1。
//! 断点续传 + 单文件重试 + 连续失败熔断 + 失败项重生成。

pub mod prompts;

mod ai;
mod commands;
mod generator;
mod notify;
mod queue;
mod tools;
mod types;
mod utils;

// ============================================================
// 常量
// ============================================================

const ANTHROPIC_VERSION: &str = "2023-06-01";
const AI_REQUEST_TIMEOUT_SECS: u64 = 900;
const AI_MAX_TOKENS: u32 = 32000;
const FILE_READ_MAX_LINES: usize = 2000;
const LIST_FILES_MAX_ENTRIES: usize = 200;
const DEFAULT_MAX_RETRIES: u32 = 3;
const DEFAULT_MAX_CONSECUTIVE_FAILURES: u32 = 5;

/// 被忽略的目录/文件名（AI 探索代码时跳过）
fn wiki_ignored_names() -> std::collections::HashSet<&'static str> {
    std::collections::HashSet::from([
        ".git",
        ".rabbit",
        ".DS_Store",
        "node_modules",
        "dist",
        "build",
        "target",
        ".next",
        ".nuxt",
        ".turbo",
        ".cache",
        ".gradle",
        "vendor",
        "__pycache__",
        ".pnpm-store",
        "resources",
        "icons.bak",
    ])
}

// ============================================================
// Re-export（供 lib.rs 使用）
// 使用 glob re-export 确保 Tauri #[command] 宏生成的隐藏辅助项
// （__cmd__*, __tauri_command_name_*）也被导出到 wiki:: 路径
// ============================================================

pub use commands::*;
pub use queue::create_wiki_queue_and_worker;
