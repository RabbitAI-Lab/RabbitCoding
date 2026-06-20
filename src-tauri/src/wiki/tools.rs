//! Wiki 生成模块 — 工具定义与执行

use std::collections::HashSet;
use std::path::{Path, PathBuf};

// ============================================================
// 工具定义
// ============================================================

/// 构造工具定义列表
pub(super) fn build_tool_definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "list_files",
            "description": "List files and directories at the specified path. Returns a tree structure. Use '.' for the root directory.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from the working directory. Use '.' for root."
                    }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "read_file",
            "description": "Read the content of a file. Returns up to 2000 lines. Use relative paths from the working directory.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from the working directory."
                    }
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "name": "grep",
            "description": "Search for a pattern in files. Returns matching lines with context. Use regex syntax.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for."
                    },
                    "path": {
                        "type": "string",
                        "description": "Relative path to search in. Use '.' for the entire directory."
                    }
                },
                "required": ["pattern"]
            }
        }),
        serde_json::json!({
            "name": "write_catalog",
            "description": "Write the documentation catalog (outline) as JSON. Call this exactly once after analyzing the code.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "children": {
                        "type": "array",
                        "description": "Catalog nodes. Each node has title, and either 'path'+'description' (document) or 'children' (section).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "path": { "type": "string" },
                                "description": { "type": "string" },
                                "children": { "type": "array" }
                            },
                            "required": ["title"]
                        }
                    }
                },
                "required": ["title", "children"]
            }
        }),
        serde_json::json!({
            "name": "write_doc",
            "description": "Write a documentation page as Markdown. Call this exactly once for each document.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "The document path from the catalog (kebab-case identifier)."
                    },
                    "content": {
                        "type": "string",
                        "description": "Full Markdown content of the document."
                    }
                },
                "required": ["path", "content"]
            }
        }),
        serde_json::json!({
            "name": "read_existing_wiki",
            "description": "Read the generated wiki from a repository. Returns the catalog and document summaries. Use this to synthesize workspace-level knowledge.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "repo_name": {
                        "type": "string",
                        "description": "Name of the repository to read wiki from."
                    }
                },
                "required": ["repo_name"]
            }
        }),
    ]
}

// ============================================================
// 工具执行
// ============================================================

/// 工具执行上下文
pub(crate) struct ToolContext<'a> {
    pub working_dir: &'a Path,
    pub output_dir: &'a Path,
    pub repos_wiki_dir: &'a Path,
    pub ignored: &'a HashSet<&'static str>,
}

/// 执行工具调用，返回 (result_text, is_error)
pub(super) fn execute_tool(
    name: &str,
    input: &serde_json::Value,
    ctx: &ToolContext,
) -> (String, bool) {
    match name {
        "list_files" => {
            let rel_path = input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            tool_list_files(rel_path, ctx)
        }
        "read_file" => {
            let rel_path = input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if rel_path.is_empty() {
                return ("Error: path is required".to_string(), true);
            }
            tool_read_file(rel_path, ctx)
        }
        "grep" => {
            let pattern = input
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let rel_path = input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".");
            tool_grep(pattern, rel_path, ctx)
        }
        "write_catalog" => match tool_write_catalog(input, ctx) {
            Ok(()) => ("Catalog written successfully.".to_string(), false),
            Err(e) => (format!("Error: {e}"), true),
        },
        "write_doc" => match tool_write_doc(input, ctx) {
            Ok(()) => ("Document written successfully.".to_string(), false),
            Err(e) => (format!("Error: {e}"), true),
        },
        "read_existing_wiki" => {
            let repo_name = input
                .get("repo_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            tool_read_existing_wiki(repo_name, ctx)
        }
        _ => (format!("Unknown tool: {name}"), true),
    }
}

/// 安全化路径：禁止 .. 路径穿越，返回绝对路径
fn safe_resolve(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let cleaned = rel.trim_start_matches("./");
    let path = base.join(cleaned);
    let canonical_base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());
    if !canonical_path.starts_with(&canonical_base) {
        return Err(format!("Path traversal blocked: {rel}"));
    }
    Ok(path)
}

fn tool_list_files(rel_path: &str, ctx: &ToolContext) -> (String, bool) {
    let target = match safe_resolve(ctx.working_dir, rel_path) {
        Ok(p) => p,
        Err(e) => return (e, true),
    };
    if !target.exists() {
        return (format!("Path not found: {rel_path}"), true);
    }
    let mut lines = Vec::new();
    let mut count = 0usize;
    list_files_recursive(
        &target,
        ctx.working_dir,
        0,
        2,
        &mut lines,
        &mut count,
        ctx.ignored,
    );
    if lines.is_empty() {
        return ("(empty directory)".to_string(), false);
    }
    (lines.join("\n"), false)
}

fn list_files_recursive(
    dir: &Path,
    root: &Path,
    depth: usize,
    max_depth: usize,
    lines: &mut Vec<String>,
    count: &mut usize,
    ignored: &HashSet<&'static str>,
) {
    if *count >= super::LIST_FILES_MAX_ENTRIES || depth > max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !ignored.contains(name.as_str()) && !name.starts_with(".")
        })
        .collect();
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
        if *count >= super::LIST_FILES_MAX_ENTRIES {
            lines.push("... (truncated)".to_string());
            return;
        }
        *count += 1;
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy();
        let indent = "  ".repeat(depth);
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            lines.push(format!("{indent}{rel}/"));
            if depth < max_depth {
                list_files_recursive(&path, root, depth + 1, max_depth, lines, count, ignored);
            }
        } else {
            lines.push(format!("{indent}{rel}"));
        }
    }
}

fn tool_read_file(rel_path: &str, ctx: &ToolContext) -> (String, bool) {
    let path = match safe_resolve(ctx.working_dir, rel_path) {
        Ok(p) => p,
        Err(e) => return (e, true),
    };
    if !path.exists() {
        return (format!("File not found: {rel_path}"), true);
    }
    if !path.is_file() {
        return (format!("Not a file: {rel_path}"), true);
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            if lines.len() > super::FILE_READ_MAX_LINES {
                let truncated: String = lines[..super::FILE_READ_MAX_LINES].join("\n");
                (
                    format!(
                        "{truncated}\n\n... (truncated, {}/{} lines shown)",
                        super::FILE_READ_MAX_LINES,
                        lines.len()
                    ),
                    false,
                )
            } else {
                (content, false)
            }
        }
        Err(e) => (format!("Failed to read: {e}"), true),
    }
}

fn tool_grep(pattern: &str, rel_path: &str, ctx: &ToolContext) -> (String, bool) {
    if pattern.is_empty() {
        return ("Error: pattern is required".to_string(), true);
    }
    let regex = match regex::Regex::new(pattern) {
        Ok(r) => r,
        Err(e) => return (format!("Invalid regex: {e}"), true),
    };
    let target = match safe_resolve(ctx.working_dir, rel_path) {
        Ok(p) => p,
        Err(e) => return (e, true),
    };
    if !target.exists() {
        return (format!("Path not found: {rel_path}"), true);
    }
    let mut results = Vec::new();
    let mut count = 0usize;
    grep_recursive(&target, &regex, &mut results, &mut count, ctx.ignored, 50);
    if results.is_empty() {
        ("No matches found.".to_string(), false)
    } else {
        (results.join("\n"), false)
    }
}

fn grep_recursive(
    dir: &Path,
    regex: &regex::Regex,
    results: &mut Vec<String>,
    count: &mut usize,
    ignored: &HashSet<&'static str>,
    max_matches: usize,
) {
    if *count >= max_matches {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        if *count >= max_matches {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if ignored.contains(name.as_str()) || name.starts_with(".") {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            grep_recursive(&path, regex, results, count, ignored, max_matches);
        } else if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if regex.is_match(line) {
                        let rel = path.to_string_lossy();
                        results.push(format!("{rel}:{i}: {line}"));
                        *count += 1;
                        if *count >= max_matches {
                            results.push("... (truncated)".to_string());
                            return;
                        }
                    }
                }
            }
        }
    }
}

fn tool_write_catalog(input: &serde_json::Value, ctx: &ToolContext) -> Result<(), String> {
    let catalog_path = ctx.output_dir.join("_catalog.json");
    let json = serde_json::to_string_pretty(input)
        .map_err(|e| format!("Failed to serialize catalog: {e}"))?;
    if let Some(parent) = catalog_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output dir: {e}"))?;
    }
    std::fs::write(&catalog_path, &json)
        .map_err(|e| format!("Failed to write catalog: {e}"))?;
    eprintln!("[wiki] Catalog written to {}", catalog_path.display());
    Ok(())
}

fn tool_write_doc(input: &serde_json::Value, ctx: &ToolContext) -> Result<(), String> {
    let path = input
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'path' field")?;
    let content = input
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or("Missing 'content' field")?;

    // 安全路径：禁止 .. 路径穿越
    if path.contains("..") {
        return Err(format!("Invalid path: {path}"));
    }
    let file_path = ctx.output_dir.join(format!("{path}.md"));
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    std::fs::write(&file_path, content).map_err(|e| format!("Failed to write doc: {e}"))?;
    eprintln!("[wiki] Doc written to {}", file_path.display());
    Ok(())
}

fn tool_read_existing_wiki(repo_name: &str, ctx: &ToolContext) -> (String, bool) {
    let repo_wiki_dir = ctx.repos_wiki_dir.join(repo_name);
    if !repo_wiki_dir.exists() {
        return (
            format!("No wiki found for repository '{repo_name}'"),
            true,
        );
    }
    // 读取 catalog
    let catalog_path = repo_wiki_dir.join("_catalog.json");
    let mut summary = String::new();
    if catalog_path.exists() {
        if let Ok(catalog_json) = std::fs::read_to_string(&catalog_path) {
            summary.push_str(&format!(
                "## Catalog for {repo_name}\n\n```json\n{catalog_json}\n```\n\n"
            ));
        }
    }
    // 列出所有 .md 文件名（含摘要）
    let mut doc_summaries = Vec::new();
    collect_doc_summaries(&repo_wiki_dir, &mut doc_summaries, 0);
    if !doc_summaries.is_empty() {
        summary.push_str("## Documents\n\n");
        for (name, first_line) in &doc_summaries {
            summary.push_str(&format!("- **{name}**: {first_line}\n"));
        }
    }
    if summary.is_empty() {
        (format!("Wiki for '{repo_name}' is empty."), false)
    } else {
        (summary, false)
    }
}

fn collect_doc_summaries(dir: &Path, summaries: &mut Vec<(String, String)>, depth: usize) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("_") || name.starts_with(".") {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_doc_summaries(&path, summaries, depth + 1);
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            let first_line = std::fs::read_to_string(&path)
                .ok()
                .and_then(|c| c.lines().next().map(|l| l.to_string()))
                .unwrap_or_default();
            summaries.push((name, first_line));
        }
    }
}
