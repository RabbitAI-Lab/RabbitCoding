//! Wiki 生成模块 — 辅助函数

/// 简单 UUID 生成（不依赖 uuid crate）
pub(super) fn simple_uuid() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let s = RandomState::new();
    let mut hasher = s.build_hasher();
    hasher.write_u64(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    );
    let hash1 = hasher.finish();

    let mut hasher2 = s.build_hasher();
    hasher2.write(&hash1.to_le_bytes());
    let hash2 = hasher2.finish();

    format!("{:016x}{:016x}", hash1, hash2)
}
