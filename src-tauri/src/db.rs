use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, State};

// ============================================================
// Serde 数据结构（camelCase 对齐前端字段名）
// ============================================================

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceData {
    id: String,
    name: String,
    #[serde(default)]
    path: Option<String>,
    collapsed: bool,
    created_at: i64,
    #[serde(default)]
    rabbits: Vec<RabbitData>,
    #[serde(default)]
    repos: Vec<RepoData>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RabbitData {
    id: String,
    title: String,
    completed: bool,
    created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token_usage: Option<TokenUsageData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    num_turns: Option<i64>,
    #[serde(default)]
    messages: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    worktree: Option<WorktreeInfoData>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenUsageData {
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
    #[serde(default)]
    cache_creation_input_tokens: i64,
    #[serde(default)]
    cache_read_input_tokens: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoData {
    id: String,
    name: String,
    path: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeRepoEntryData {
    #[serde(default)]
    repo_id: String,
    #[serde(default)]
    repo_name: String,
    #[serde(default)]
    original_path: String,
    #[serde(default)]
    worktree_path: String,
    #[serde(default)]
    branch: String,
    #[serde(default)]
    base_branch: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfoData {
    #[serde(default)]
    base_path: String,
    #[serde(default)]
    branch: String,
    #[serde(default)]
    repos: Vec<WorktreeRepoEntryData>,
    #[serde(default)]
    created_at: i64,
}

// ============================================================
// Database 结构体
// ============================================================

/// 全局数据库状态，通过 Tauri `.manage()` 注册
pub struct Database {
    conn: Mutex<Connection>,
}

const SCHEMA_SQL: &str = r#"
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS workspaces (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT '',
        path        TEXT,
        collapsed   INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rabbits (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        completed     INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        pinned        INTEGER NOT NULL DEFAULT 0,
        session_id    TEXT,
        status        TEXT NOT NULL DEFAULT 'idle',
        model         TEXT NOT NULL DEFAULT '',
        cost_usd      REAL,
        duration_ms   INTEGER,
        error         TEXT,
        token_usage   TEXT,
        num_turns     INTEGER,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS repos (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL,
        name          TEXT NOT NULL,
        path          TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        rabbit_id   TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        msg_type    TEXT NOT NULL,
        subtype     TEXT,
        content     TEXT NOT NULL,
        FOREIGN KEY (rabbit_id) REFERENCES rabbits(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rabbits_workspace ON rabbits(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_repos_workspace   ON repos(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_messages_rabbit   ON messages(rabbit_id, seq);
"#;

impl Database {
    /// 打开或创建数据库，执行建表
    pub fn open(db_path: &std::path::Path) -> Result<Self, String> {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open database: {e}"))?;

        conn.execute_batch(SCHEMA_SQL)
            .map_err(|e| format!("Failed to initialize schema: {e}"))?;

        // 列迁移：已有数据库升级（幂等，忽略 duplicate column 错误）
        for sql in [
            "ALTER TABLE rabbits ADD COLUMN token_usage TEXT",
            "ALTER TABLE rabbits ADD COLUMN num_turns INTEGER",
            "ALTER TABLE rabbits ADD COLUMN worktree TEXT",
        ] {
            let _ = conn.execute(sql, []);
        }

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }
}

// ============================================================
// 内部辅助函数
// ============================================================

fn load_all_inner(conn: &Connection) -> Result<String, String> {
    // 1. 查所有 workspaces（按 created_at DESC，匹配前端 prepend 顺序）
    let mut ws_stmt = conn
        .prepare("SELECT id, name, path, collapsed, created_at FROM workspaces ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let workspace_rows: Vec<(String, String, Option<String>, bool, i64)> = ws_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    drop(ws_stmt);

    let mut workspaces: Vec<WorkspaceData> = Vec::with_capacity(workspace_rows.len());

    for (ws_id, ws_name, ws_path, ws_collapsed, ws_created_at) in workspace_rows {
        // 2a. 查 rabbits
        let mut rabbit_stmt = conn
            .prepare(
                "SELECT id, title, completed, created_at, pinned, session_id, status, model, cost_usd, duration_ms, error, token_usage, num_turns, worktree \
                 FROM rabbits WHERE workspace_id = ? ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rabbit_rows: Vec<RabbitData> = rabbit_stmt
            .query_map(params![&ws_id], |row| {
                let pinned_val: i64 = row.get(4)?;
                let token_usage_str: Option<String> = row.get(11)?;
                let token_usage = token_usage_str
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<TokenUsageData>(s).ok());
                let worktree_str: Option<String> = row.get(13)?;
                let worktree = worktree_str
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<WorktreeInfoData>(s).ok());
                Ok(RabbitData {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    completed: row.get::<_, i64>(2)? != 0,
                    created_at: row.get(3)?,
                    pinned: if pinned_val != 0 { Some(true) } else { None },
                    session_id: row.get(5)?,
                    status: row.get(6)?,
                    model: row.get(7)?,
                    cost_usd: row.get(8)?,
                    duration_ms: row.get(9)?,
                    error: row.get(10)?,
                    token_usage,
                    num_turns: row.get(12)?,
                    messages: Vec::new(),
                    worktree,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        drop(rabbit_stmt);

        let mut rabbits: Vec<RabbitData> = rabbit_rows;

        // 2b. 对每个 rabbit 查 messages
        for rabbit in &mut rabbits {
            let mut msg_stmt = conn
                .prepare("SELECT content FROM messages WHERE rabbit_id = ? ORDER BY seq ASC")
                .map_err(|e| e.to_string())?;

            let messages: Vec<serde_json::Value> = msg_stmt
                .query_map(params![&rabbit.id], |row| {
                    let content: String = row.get(0)?;
                    Ok(content)
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|content| {
                    serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::Value::Null)
                })
                .collect();

            drop(msg_stmt);
            rabbit.messages = messages;
        }

        // 2c. 查 repos
        let mut repo_stmt = conn
            .prepare("SELECT id, name, path, created_at FROM repos WHERE workspace_id = ? ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;

        let repos: Vec<RepoData> = repo_stmt
            .query_map(params![&ws_id], |row| {
                Ok(RepoData {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        drop(repo_stmt);

        workspaces.push(WorkspaceData {
            id: ws_id,
            name: ws_name,
            path: ws_path,
            collapsed: ws_collapsed,
            created_at: ws_created_at,
            rabbits,
            repos,
        });
    }

    serde_json::to_string(&workspaces).map_err(|e| format!("Failed to serialize: {e}"))
}

fn save_all_inner(conn: &Connection, workspaces: &[WorkspaceData]) -> Result<(), String> {
    // 开启事务
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| e.to_string())?;

    match save_all_impl(conn, workspaces) {
        Ok(_) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

fn save_all_impl(conn: &Connection, workspaces: &[WorkspaceData]) -> Result<(), String> {
    // 1. 清空四表
    conn.execute("DELETE FROM messages", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM repos", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rabbits", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspaces", [])
        .map_err(|e| e.to_string())?;

    // 2. 遍历插入
    for ws in workspaces {
        // INSERT workspace
        conn.execute(
            "INSERT INTO workspaces (id, name, path, collapsed, created_at) VALUES (?, ?, ?, ?, ?)",
            params![&ws.id, &ws.name, &ws.path, ws.collapsed as i64, ws.created_at],
        )
        .map_err(|e| format!("Insert workspace failed: {e}"))?;

        // INSERT rabbits + messages
        for rabbit in &ws.rabbits {
            let token_usage_json = rabbit
                .token_usage
                .as_ref()
                .map(|u| serde_json::to_string(u).unwrap_or_default());

            let worktree_json = rabbit
                .worktree
                .as_ref()
                .map(|w| serde_json::to_string(w).unwrap_or_default());

            conn.execute(
                "INSERT INTO rabbits (id, workspace_id, title, completed, created_at, pinned, session_id, status, model, cost_usd, duration_ms, error, token_usage, num_turns, worktree) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    &rabbit.id,
                    &ws.id,
                    &rabbit.title,
                    rabbit.completed as i64,
                    rabbit.created_at,
                    rabbit.pinned.unwrap_or(false) as i64,
                    &rabbit.session_id,
                    &rabbit.status,
                    &rabbit.model,
                    &rabbit.cost_usd,
                    &rabbit.duration_ms,
                    &rabbit.error,
                    &token_usage_json,
                    &rabbit.num_turns,
                    &worktree_json,
                ],
            )
            .map_err(|e| format!("Insert rabbit failed: {e}"))?;

            for (seq, msg) in rabbit.messages.iter().enumerate() {
                let content = serde_json::to_string(msg)
                    .map_err(|e| format!("Serialize message failed: {e}"))?;
                let msg_type = msg
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let subtype = msg
                    .get("subtype")
                    .and_then(|v| v.as_str());

                conn.execute(
                    "INSERT INTO messages (rabbit_id, seq, msg_type, subtype, content) VALUES (?, ?, ?, ?, ?)",
                    params![&rabbit.id, seq as i64, msg_type, subtype, &content],
                )
                .map_err(|e| format!("Insert message failed: {e}"))?;
            }
        }

        // INSERT repos
        for repo in &ws.repos {
            conn.execute(
                "INSERT INTO repos (id, workspace_id, name, path, created_at) VALUES (?, ?, ?, ?, ?)",
                params![&repo.id, &ws.id, &repo.name, &repo.path, repo.created_at],
            )
            .map_err(|e| format!("Insert repo failed: {e}"))?;
        }
    }

    Ok(())
}

// ============================================================
// Tauri Commands
// ============================================================

/// 查询全部四表，拼装为 Workspace[] JSON 返回
#[command]
pub fn db_load_all(state: State<'_, Database>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    load_all_inner(&conn)
}

/// 接收完整 Workspace[] JSON，事务内全量替换
#[command]
pub fn db_save_all(state: State<'_, Database>, json: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let workspaces: Vec<WorkspaceData> = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse JSON: {e}"))?;
    save_all_inner(&conn, &workspaces)
}

/// 检查数据库是否已有数据（用于判断是否需要迁移）
#[command]
pub fn db_has_data(state: State<'_, Database>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}
