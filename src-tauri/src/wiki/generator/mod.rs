//! Wiki 生成管线（子模块）
//!
//! 包含两层生成架构：repo 级 + workspace 级。
//! 对外通过 re-export 暴露 `execute_wiki_generation`。

mod catalog;
mod helpers;
mod meta;
mod orchestrator;
mod repo;
mod workspace;

// Re-export 供 wiki 父模块使用
pub(crate) use meta::{load_or_init_meta, meta_path, save_meta};
pub(crate) use orchestrator::execute_wiki_generation;
