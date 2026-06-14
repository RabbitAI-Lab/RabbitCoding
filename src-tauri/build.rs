fn main() {
    ensure_resources();
    tauri_build::build()
}

/// 确保本地编译时 resources/ 目录有文件可被 Tauri glob 匹配。
/// CI 环境会在 `tauri build` 之前放置真实的 sidecar bundle 和 Node.js 运行时。
fn ensure_resources() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let resources_dir = std::path::Path::new(&manifest_dir).join("resources");

    // 1. sidecar bundle: 尝试从 sidecar/dist/ 复制；不存在则创建占位文件
    let sidecar_resource_dir = resources_dir.join("sidecar");
    std::fs::create_dir_all(&sidecar_resource_dir).ok();
    let sidecar_target = sidecar_resource_dir.join("sidecar-bundle.js");
    if !sidecar_target.exists() {
        let sidecar_dist = std::path::Path::new(&manifest_dir)
            .join("..")
            .join("sidecar")
            .join("dist")
            .join("sidecar-bundle.js");
        if sidecar_dist.exists() {
            let _ = std::fs::copy(&sidecar_dist, &sidecar_target);
        } else {
            let _ = std::fs::write(
                &sidecar_target,
                "// placeholder — run `pnpm run bundle` in sidecar/ to generate the real bundle\n",
            );
        }
    }

    // 2. node-runtime: 创建占位文件保证 glob 匹配
    let node_runtime_dir = resources_dir.join("node-runtime");
    std::fs::create_dir_all(&node_runtime_dir).ok();
    let node_placeholder = node_runtime_dir.join("placeholder.txt");
    if !node_placeholder.exists() {
        let _ = std::fs::write(
            &node_placeholder,
            "placeholder — CI will download the real Node.js runtime here\n",
        );
    }

    println!("cargo:rerun-if-changed=resources");
}
