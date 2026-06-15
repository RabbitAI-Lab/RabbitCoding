# 修复：打包后 Dock 图标和安装图标未更新

## 问题背景

用户更新了 `src-tauri/icons/` 目录下的所有图标文件（通过 `tauri icon` 命令从新源图生成），但打包后 macOS Dock 中和 DMG 安装包中仍显示旧的 Tauri 默认图标。

经调查，源图标文件本身是**正确的**（icns 包含完整 16x16~512x512@2x 分辨率，MD5 与备份不同）。问题出在 macOS 缓存机制和构建缓存两方面。

## 根因分析

### 根因 1：macOS LaunchServices 图标缓存（最主要原因）

macOS 会**激进缓存** App 图标。当安装同 Bundle Identifier（`com.rabbitai-lab.coding`）的新版本时，Dock / Finder / Launchpad 仍显示缓存的旧图标。即使 App Bundle 内的 icns 文件已正确替换，系统也不会立即刷新。

### 根因 2：Cargo 构建缓存未清理

`build.rs` 中仅有 `cargo:rerun-if-changed=resources`，缺少对 `icons/` 目录的变更监听。增量构建时 Cargo 可能复用上次构建缓存的图标资源。

### 根因 3：Debug 模式不打包图标（说明，非 Bug）

`tauri dev` 生成的 debug bundle 不包含图标资源和 `CFBundleIconFile` 键，这是 Tauri 的正常行为——图标仅在 `tauri build`（release）时打包。

## 解决方案

### 步骤 1：清理 Rust 构建缓存后重新打包

```bash
cd src-tauri
cargo clean
cd ..
pnpm tauri build
```

这确保图标资源被完全重新打包进 App Bundle。

### 步骤 2：清理 macOS 图标缓存

打包完成后安装新版本前/后，执行以下命令清除系统图标缓存：

```bash
# 方法 A：重建 LaunchServices 数据库（推荐）
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -seed -lint -r -domain local -domain system -domain user

# 方法 B：手动清除图标缓存文件
sudo rm -rfv /Library/Caches/com.apple.iconservices.store
sudo find /private/var/folders/ -name com.apple.dock.iconcache -exec rm -fv {} \;
sudo find /private/var/folders/ -name com.apple.iconservices -exec rm -rfv {} \;

# 重启 Dock 和 Finder
killall Dock
killall Finder
```

如果以上无效，**重启 Mac** 是最彻底的方式。

### 步骤 3（可选改进）：在 build.rs 中添加 icons 变更监听

在 `src-tauri/build.rs` 的 `ensure_resources()` 函数末尾添加：

```rust
println!("cargo:rerun-if-changed=icons");
```

这样图标文件变更时 Cargo 会自动触发重新构建，避免增量构建使用缓存。

## 验证方法

1. 重新打包后，检查 release bundle 中的图标：
   ```bash
   # 检查 App 内的 icns 文件
   APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Rabbit Coding.app"
   md5 "$APP/Contents/Resources/icon.icns"
   md5 src-tauri/icons/icon.icns
   # 两个 MD5 应一致
   ```

2. 清除缓存后安装新版 DMG，确认 Dock 图标已更新为新图标

3. 如果 Dock 仍显示旧图标，重启 Mac 后再次确认

## 关键文件

- `src-tauri/icons/icon.icns` — macOS App 图标源文件（已正确）
- `src-tauri/tauri.conf.json` — 图标配置（已正确）
- `src-tauri/build.rs` — 需添加 icons 变更监听
