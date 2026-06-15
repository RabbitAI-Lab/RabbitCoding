/**
 * 资源准备脚本 — 将 sidecar bundle 和平台原生 CLI 二进制复制到 Tauri resources 目录
 *
 * 用法：
 *   node scripts/setup-resources.mjs          # 先 bundle 再复制
 *   node scripts/setup-resources.mjs --no-bundle  # 仅复制（假设 bundle 已存在）
 *
 * 在 CI 和本地均可运行，根据当前平台的 process.platform/process.arch 解析对应二进制。
 */

import { createRequire } from "node:module";
import { copyFileSync, chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// sidecar 目录（scripts/ 的上一级）
const sidecarDir = resolve(__dirname, "..");
// src-tauri/resources/sidecar 目标目录
const resourcesDir = resolve(sidecarDir, "..", "src-tauri", "resources", "sidecar");

// 原生二进制文件名
const binName = process.platform === "win32" ? "claude.exe" : "claude";

// 平台特定的包名
const pkgSuffix = `${process.platform}-${process.arch}`;
const pkgBaseName = `claude-agent-sdk-${pkgSuffix}`;
const pkgName = `@anthropic-ai/${pkgBaseName}`;

function runBundle() {
  const { execSync } = require("node:child_process");
  console.log("[setup-resources] Running esbuild bundle...");
  execSync("pnpm run bundle", { cwd: sidecarDir, stdio: "inherit" });
}

function copyBundle() {
  const src = join(sidecarDir, "dist", "sidecar-bundle.js");
  const dest = join(resourcesDir, "sidecar-bundle.js");

  if (!existsSync(src)) {
    console.error(`[setup-resources] ERROR: bundle not found at ${src}`);
    console.error("[setup-resources] Run with --bundle or execute 'pnpm run bundle' first.");
    process.exit(1);
  }

  mkdirSync(resourcesDir, { recursive: true });
  copyFileSync(src, dest);
  console.log(`[setup-resources] Copied bundle: ${dest}`);
}

function findNativeBinary() {
  // 策略 1：从 SDK 包位置解析（SDK 的 optionalDependencies 包含平台二进制）
  try {
    const sdkMain = require.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkRequire = createRequire(sdkMain);
    return sdkRequire.resolve(`${pkgName}/${binName}`);
  } catch {}

  // 策略 2：从 pnpm 虚拟 store 直接查找
  try {
    const pnpmLink = join(sidecarDir, "node_modules", ".pnpm", "node_modules", "@anthropic-ai", pkgBaseName);
    if (existsSync(pnpmLink)) {
      const real = realpathSync(pnpmLink);
      const candidate = join(real, binName);
      if (existsSync(candidate)) return candidate;
    }
  } catch {}

  // 策略 3：直接从 sidecar node_modules 解析（npm/yarn 的标准结构）
  try {
    return require.resolve(`${pkgName}/${binName}`);
  } catch {}

  return null;
}

function copyNativeBinary() {
  const binPath = findNativeBinary();
  if (!binPath) {
    console.error(`[setup-resources] ERROR: Could not find ${pkgName}/${binName}.`);
    console.error("[setup-resources] Tried: SDK resolve, pnpm store, direct resolve.");
    console.error("[setup-resources] Run 'pnpm install' in sidecar/ first (without --omit=optional).");
    process.exit(1);
  }

  if (!existsSync(binPath)) {
    console.error(`[setup-resources] ERROR: Native binary not found at ${binPath}`);
    process.exit(1);
  }

  const dest = join(resourcesDir, binName);
  copyFileSync(binPath, dest);
  console.log(`[setup-resources] Copied native binary (${pkgName}): ${dest}`);

  // Unix 上设置可执行权限
  if (process.platform !== "win32") {
    chmodSync(dest, 0o755);
    console.log("[setup-resources] Set executable permission (0o755)");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skipBundle = args.includes("--no-bundle");

  console.log(`[setup-resources] Platform: ${process.platform}-${process.arch}`);
  console.log(`[setup-resources] Target: ${resourcesDir}`);

  if (!skipBundle) {
    await runBundle();
  }

  copyBundle();
  copyNativeBinary();
  ensurePackageJson();

  // 验证
  console.log("\n[setup-resources] Verification:");
  const bundleExists = existsSync(join(resourcesDir, "sidecar-bundle.js"));
  const binExists = existsSync(join(resourcesDir, binName));
  console.log(`  sidecar-bundle.js: ${bundleExists ? "OK" : "MISSING"}`);
  console.log(`  ${binName}: ${binExists ? "OK" : "MISSING"}`);

  if (!bundleExists || !binExists) {
    console.error("[setup-resources] FAILED: Some resources are missing!");
    process.exit(1);
  }

  console.log("[setup-resources] Done.");
}

/**
 * 确保 resources/sidecar/ 目录下存在 package.json（声明 type: module）
 *
 * esbuild --format=esm 产物使用 import.meta.url，Node.js 必须将其识别为 ESM。
 * 开发模式下 sidecar/package.json 的 "type": "module" 生效，
 * 但生产打包只复制 bundle 文件，缺少 package.json 会导致 CommonJS 解析失败。
 */
function ensurePackageJson() {
  const pkgJsonPath = join(resourcesDir, "package.json");
  const content = JSON.stringify({ type: "module" }, null, 2) + "\n";
  writeFileSync(pkgJsonPath, content, "utf-8");
  console.log(`[setup-resources] Wrote package.json (type: module): ${pkgJsonPath}`);
}

main().catch((err) => {
  console.error("[setup-resources] Fatal error:", err);
  process.exit(1);
});
