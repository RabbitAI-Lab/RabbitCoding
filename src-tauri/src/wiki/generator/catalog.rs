//! Wiki 生成管线 — 目录解析（从 _catalog.json 提取叶子节点路径）

use std::path::Path;

use crate::wiki::types::CatalogNode;

/// 从 _catalog.json 提取所有叶子节点（文档）的 path 和 title
pub(super) fn extract_catalog_leaves(catalog: &CatalogNode) -> Vec<(String, String)> {
    let mut leaves = Vec::new();
    extract_leaves_recursive(catalog, &mut leaves);
    leaves
}

fn extract_leaves_recursive(node: &CatalogNode, leaves: &mut Vec<(String, String)>) {
    if let Some(children) = &node.children {
        for child in children {
            extract_leaves_recursive(child, leaves);
        }
    } else if let Some(path) = &node.path {
        // 叶子节点（有 path，无 children）
        leaves.push((path.clone(), node.title.clone()));
    }
}

/// 加载 catalog 并提取叶子文档列表
pub(super) fn load_catalog(output_dir: &Path) -> Result<Vec<(String, String)>, String> {
    let catalog_path = output_dir.join("_catalog.json");
    if !catalog_path.exists() {
        return Err("Catalog not found".to_string());
    }
    let json = std::fs::read_to_string(&catalog_path)
        .map_err(|e| format!("Failed to read catalog: {e}"))?;
    let catalog: CatalogNode =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse catalog: {e}"))?;
    let leaves = extract_catalog_leaves(&catalog);
    if leaves.is_empty() {
        return Err("Catalog has no leaf documents".to_string());
    }
    Ok(leaves)
}
