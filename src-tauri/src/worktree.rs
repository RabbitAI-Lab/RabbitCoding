use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::process_ext::CommandNoWindowExt;
use tauri::command;

// ============================================================
// 数据结构（camelCase 对齐前端字段名）
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRepoInput {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRepoResult {
    pub repo_id: String,
    pub repo_name: String,
    pub original_path: String,
    pub worktree_path: String,
    pub branch: String,
    pub base_branch: String,
    /// 失败时填充跳过原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeInput {
    pub workspace_path: String,
    pub repos: Vec<WorktreeRepoInput>,
    /// 可选分支名，未指定时自动生成 rabbit-{秒级时间戳}
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeOutput {
    pub base_path: String,
    pub branch: String,
    pub repos: Vec<WorktreeRepoResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorktreeInput {
    pub workspace_path: String,
    pub branch: String,
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListEntry {
    pub branch: String,
    pub path: String,
    pub created_at: i64,
}

// ============================================================
// 辅助函数
// ============================================================

/// 执行 git 命令，返回 stdout（成功时 trimmed）
fn git_exec(args: &[&str], current_dir: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(current_dir)
        .no_window()
        .output()
        .map_err(|e| format!("Failed to execute git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

/// 校验路径是否为 git 仓库
fn ensure_git_repo(path: &Path) -> Result<(), String> {
    git_exec(&["rev-parse", "--is-inside-work-tree"], path)
        .map(|_| ())
        .map_err(|e| format!("Not a git repository: {e}"))
}

/// 获取当前分支名
fn git_current_branch(path: &Path) -> Result<String, String> {
    git_exec(&["rev-parse", "--abbrev-ref", "HEAD"], path)
}

/// 计算 repos/ 下的目录名：
/// - workspace 子目录 → strip_prefix 得相对路径（如 "backend"）
/// - 外部路径 → 降级为 "{repoName}-{repoId前6位}"
fn compute_repo_dir_name(repo: &WorktreeRepoInput, workspace: &Path) -> String {
    let repo_path = Path::new(&repo.path);
    // 尝试将 repo 路径表示为 workspace 下的相对路径
    if let Ok(rel) = repo_path.strip_prefix(workspace) {
        let rel_str = rel.to_string_lossy().to_string();
        if !rel_str.is_empty() && !rel_str.starts_with("..") {
            // 用相对路径作为目录名（取最后一段，避免嵌套创建）
            return rel_str.split('/').last().unwrap_or(&rel_str).to_string();
        }
    }
    // 外部路径降级
    let short_id = if repo.repo_id.len() >= 6 {
        &repo.repo_id[..6]
    } else {
        &repo.repo_id
    };
    format!("{}-{}", repo.repo_name, short_id)
}

/// 创建 docs 软链接：镜像目录的 docs/ → workspace 的 .rabbit/docs/
fn link_docs_dir(workspace: &Path, base_path: &Path) -> Result<(), String> {
    let src = workspace.join(".rabbit").join("docs");
    let dst = base_path.join("docs");

    // 确保源目录存在（首次创建）
    std::fs::create_dir_all(&src)
        .map_err(|e| format!("Create .rabbit/docs dir failed: {e}"))?;

    // 已存在则跳过
    if dst.exists() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&src, &dst)
            .map_err(|e| format!("Symlink docs failed: {e}"))?;
    }

    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(&src, &dst)
            .unwrap_or_else(|_| {
                // Windows 降级：创建空目录（软链接可能需要开发者模式/管理员权限）
                let _ = std::fs::create_dir_all(&dst);
            });
    }

    Ok(())
}

/// 生成默认分支名：rabbit-{秒级时间戳}
fn default_branch_name() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("rabbit-{secs}")
}

// ============================================================
// Tauri 命令
// ============================================================

/// 为 workspace 下所有 repos 创建 git worktree 镜像
#[command]
pub fn create_worktree(input: CreateWorktreeInput) -> Result<CreateWorktreeOutput, String> {
    let workspace = Path::new(&input.workspace_path);
    if !workspace.is_dir() {
        return Err(format!("Workspace path is not a directory: {}", input.workspace_path));
    }

    let branch = input.branch.clone().unwrap_or_else(default_branch_name);
    let base_path = workspace.join(".rabbit").join("worktrees").join(&branch);

    // 如果 basePath 已存在，说明之前创建过，直接报错让上层复用
    if base_path.exists() {
        return Err(format!("Worktree base path already exists: {}", base_path.display()));
    }

    // 创建 basePath/repos/ 子目录
    let repos_dir = base_path.join("repos");
    std::fs::create_dir_all(&repos_dir)
        .map_err(|e| format!("Create repos dir failed: {e}"))?;

    let mut results: Vec<WorktreeRepoResult> = Vec::new();

    for repo in &input.repos {
        let repo_path = Path::new(&repo.path);

        // a. 校验 git 仓库
        if let Err(e) = ensure_git_repo(repo_path) {
            results.push(WorktreeRepoResult {
                repo_id: repo.repo_id.clone(),
                repo_name: repo.repo_name.clone(),
                original_path: repo.path.clone(),
                worktree_path: String::new(),
                branch: branch.clone(),
                base_branch: String::new(),
                skip_reason: Some(e),
            });
            continue;
        }

        // b. 获取当前分支作为 baseBranch
        let base_branch = git_current_branch(repo_path).unwrap_or_else(|_| "HEAD".to_string());

        // c. 计算 repos/ 下的目录名
        let dir_name = compute_repo_dir_name(repo, workspace);
        let target_path = repos_dir.join(&dir_name);

        // d. git worktree add {target} -b {branch}
        let add_result = git_exec(
            &["worktree", "add", target_path.to_str().unwrap_or(""), "-b", &branch],
            repo_path,
        );

        match add_result {
            Ok(_) => {
                results.push(WorktreeRepoResult {
                    repo_id: repo.repo_id.clone(),
                    repo_name: repo.repo_name.clone(),
                    original_path: repo.path.clone(),
                    worktree_path: target_path.to_string_lossy().to_string(),
                    branch: branch.clone(),
                    base_branch,
                    skip_reason: None,
                });
            }
            Err(e) => {
                // e. 分支名冲突 → 追加随机后缀重试
                let suffix: String = std::iter::repeat_with(|| {
                    let n = rand_like();
                    char::from_digit(n, 36).unwrap_or('0')
                })
                .take(4)
                .collect();
                let retry_branch = format!("{branch}-{suffix}");
                let retry_result = git_exec(
                    &["worktree", "add", target_path.to_str().unwrap_or(""), "-b", &retry_branch],
                    repo_path,
                );
                match retry_result {
                    Ok(_) => {
                        results.push(WorktreeRepoResult {
                            repo_id: repo.repo_id.clone(),
                            repo_name: repo.repo_name.clone(),
                            original_path: repo.path.clone(),
                            worktree_path: target_path.to_string_lossy().to_string(),
                            branch: retry_branch.clone(),
                            base_branch,
                            skip_reason: None,
                        });
                    }
                    Err(e2) => {
                        results.push(WorktreeRepoResult {
                            repo_id: repo.repo_id.clone(),
                            repo_name: repo.repo_name.clone(),
                            original_path: repo.path.clone(),
                            worktree_path: String::new(),
                            branch: String::new(),
                            base_branch,
                            skip_reason: Some(format!("git worktree add failed: {e}; retry: {e2}")),
                        });
                    }
                }
            }
        }
    }

    // 6. 创建 docs 软链接
    if let Err(e) = link_docs_dir(workspace, &base_path) {
        eprintln!("[worktree] link_docs_dir warning: {e}");
        // 非致命错误，继续返回
    }

    Ok(CreateWorktreeOutput {
        base_path: base_path.to_string_lossy().to_string(),
        branch,
        repos: results,
    })
}

/// 删除 worktree 镜像目录：遍历 repos/ 执行 git worktree remove --force + 删除残留目录
#[command]
pub fn remove_worktree(input: RemoveWorktreeInput) -> Result<(), String> {
    let workspace = Path::new(&input.workspace_path);
    let base_path = workspace.join(".rabbit").join("worktrees").join(&input.branch);

    if !base_path.exists() {
        return Ok(()); // 不存在，幂等返回
    }

    let repos_dir = base_path.join("repos");

    // 遍历 repos/ 下的每个目录，执行 git worktree remove
    if repos_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&repos_dir) {
            for entry in entries.flatten() {
                let wt_path = entry.path();
                if !wt_path.is_dir() {
                    continue;
                }

                // 先尝试 git worktree remove --force
                let remove_args = if input.force {
                    vec!["worktree", "remove", "--force", wt_path.to_str().unwrap_or("")]
                } else {
                    vec!["worktree", "remove", wt_path.to_str().unwrap_or("")]
                };

                // git worktree remove 需要在主仓库中执行
                // 尝试从 .git 文件读取主仓库路径
                let git_file = wt_path.join(".git");
                let main_repo_dir = if git_file.exists() {
                    // .git 文件内容如 "gitdir: /path/to/main/.git/worktrees/xxx"
                    std::fs::read_to_string(&git_file)
                        .ok()
                        .and_then(|content| {
                            content
                                .strip_prefix("gitdir: ")
                                .map(|s| s.trim().to_string())
                        })
                        .and_then(|gitdir| {
                            // 从 gitdir 反推主仓库路径
                            // gitdir = /main/.git/worktrees/xxx → main repo = /main
                            PathBuf::from(&gitdir)
                                .ancestors()
                                .nth(3) // 跳过 xxx → worktrees → .git → main
                                .map(|p| p.to_path_buf())
                        })
                } else {
                    None
                };

                if let Some(main_repo) = main_repo_dir {
                    let _ = git_exec(&remove_args, &main_repo);
                }

                // 删除残留目录（git worktree remove 可能因 dirty 失败）
                if wt_path.exists() {
                    let _ = std::fs::remove_dir_all(&wt_path);
                }
            }
        }
    }

    // 删除 docs 软链接（只删链接本身，不影响原目录）
    let docs_link = base_path.join("docs");
    if docs_link.exists() || docs_link.symlink_metadata().is_ok() {
        let _ = std::fs::remove_file(&docs_link)
            .or_else(|_| std::fs::remove_dir_all(&docs_link));
    }

    // 删除 basePath 本身
    if base_path.exists() {
        std::fs::remove_dir_all(&base_path)
            .map_err(|e| format!("Remove worktree base path failed: {e}"))?;
    }

    Ok(())
}

/// 扫描 .rabbit/worktrees/ 下的子目录
#[command]
pub fn list_worktrees(workspace_path: String) -> Result<Vec<WorktreeListEntry>, String> {
    let worktrees_dir = Path::new(&workspace_path).join(".rabbit").join("worktrees");
    if !worktrees_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&worktrees_dir)
        .map_err(|e| format!("Read worktrees dir failed: {e}"))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let branch = entry.file_name().to_string_lossy().to_string();
        let created_at = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        entries.push(WorktreeListEntry {
            branch,
            path: path.to_string_lossy().to_string(),
            created_at,
        });
    }

    // 按 createdAt 降序
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(entries)
}

// ============================================================
// 简单伪随机（不依赖 rand crate）
// ============================================================

fn rand_like() -> u32 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    // 简单混淆
    nanos.wrapping_mul(2654435761).wrapping_add(0x9E3779B9) % 36
}
