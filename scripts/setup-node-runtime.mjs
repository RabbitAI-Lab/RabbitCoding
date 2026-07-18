/**
 * Node.js 运行时准备脚本 — 为 src-tauri/resources/node-runtime 下载并放置官方 Node.js 发行版
 *
 * 为什么需要：gitnexus（代码库索引）和 sidecar 生产模式都用「内置 node」运行，
 * 不依赖系统 PATH / 系统 npm / 系统 gitnexus —— 彻底隔离。CI 在 tauri build 前下载；
 * 本地 dev 默认只有 build.rs 生成的 placeholder，故首次 dev 需补齐。
 *
 * 用法：
 *   node scripts/setup-node-runtime.mjs          # 缺失才下载（幂等；dev 自动调用）
 *   node scripts/setup-node-runtime.mjs --force   # 强制重新下载（升级 NODE_VERSION 后用）
 *
 * 行为：
 *   - 若 node-runtime 已有可运行的 node 二进制 → 跳过（仅 stat + --version，<100ms）。
 *   - 若缺失 → 按当前 platform/arch 下载官方 Node.js tarball/zip，
 *     解压到 src-tauri/resources/node-runtime（目录布局对齐 gitnexus.rs 的期望路径）。
 *   - 下载/解压失败 → 打印醒目警告并 exit 0（不阻断 dev；gitnexus 安装会报原错误，
 *     手动重跑 `pnpm setup:runtime` 即可）。
 *
 * NODE_VERSION 必须与 .github/workflows/build.yml 的 env.NODE_VERSION 保持一致
 * （dev/prod 同构，否则本地能跑、打包产物布局不一致会埋坑）。
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TAG = "[setup:runtime]";

// 必须与 .github/workflows/build.yml 的 env.NODE_VERSION 一致
const NODE_VERSION = "22.11.0";

// 目标目录：<repo>/src-tauri/resources/node-runtime
const runtimeDir = resolve(__dirname, "..", "src-tauri", "resources", "node-runtime");

// ============================================================
// 平台 → Node 官方 asset 映射
// ============================================================

function resolveAsset() {
  const { platform, arch } = process;
  const pick = (zip, asset) => ({ asset, ext: zip ? "zip" : "tar.gz" });
  if (platform === "win32") {
    if (arch === "x64") return pick(true, "win-x64");
    if (arch === "arm64") return pick(true, "win-arm64");
  } else if (platform === "darwin") {
    if (arch === "x64") return pick(false, "darwin-x64");
    if (arch === "arm64") return pick(false, "darwin-arm64");
  } else if (platform === "linux") {
    if (arch === "x64") return pick(false, "linux-x64");
    if (arch === "arm64") return pick(false, "linux-arm64");
  }
  return null;
}

// 期望的 node 二进制路径（对齐 gitnexus.rs bundled_node()）
function expectedNodeBinary() {
  return join(runtimeDir, process.platform === "win32" ? "node.exe" : "bin/node");
}

// 期望的 npm-cli.js 路径（对齐 gitnexus.rs bundled_npm_cli()）
function expectedNpmCli() {
  const rel =
    process.platform === "win32"
      ? ["node_modules", "npm", "bin", "npm-cli.js"]
      : ["lib", "node_modules", "npm", "bin", "npm-cli.js"];
  return join(runtimeDir, ...rel);
}

// ============================================================
// 状态检查
// ============================================================

/** node 二进制是否存在且可运行（防半截/损坏目录误判为就绪） */
function isRuntimeReady() {
  const bin = expectedNodeBinary();
  if (!existsSync(bin)) return false;
  const r = spawnSync(bin, ["--version"], { windowsHide: true });
  return r.status === 0;
}

function nodeVersionString(bin) {
  const r = spawnSync(bin, ["--version"], { windowsHide: true });
  return r.status === 0 ? String(r.stdout).trim() : "(unknown)";
}

// ============================================================
// 下载 / 解压 / 摆放
// ============================================================

async function download(url, dest) {
  if (typeof fetch !== "function") {
    throw new Error("global fetch unavailable (需要 Node >= 18)");
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

/** 解压到 dest（不做 strip）：dest/<node-vX...>/...  */
function extract(archivePath, dest, ext) {
  mkdirSync(dest, { recursive: true });
  if (ext === "zip") {
    // 对齐 CI（Windows）：Expand-Archive。spawnSync 数组参数不经 shell，无需手动转义。
    const ps = `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${dest}" -Force`;
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      windowsHide: true,
    });
    if (r.status !== 0) {
      throw new Error(`Expand-Archive failed: ${String(r.stderr || r.stdout).trim()}`);
    }
  } else {
    // 对齐 CI（Unix）：tar xzf（--strip-components=1 留到摆放阶段统一处理，这里保持原始结构）
    const r = spawnSync("tar", ["xzf", archivePath, "-C", dest], { windowsHide: true });
    if (r.status !== 0) {
      throw new Error(`tar failed: ${String(r.stderr || r.stdout).trim()}`);
    }
  }
}

/** 清空 runtimeDir 内容（保留目录本身），避免 placeholder / 旧版本残留 */
function cleanRuntimeDir() {
  mkdirSync(runtimeDir, { recursive: true });
  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    rmSync(join(runtimeDir, entry.name), { recursive: true, force: true });
  }
}

function copyDirContents(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    cpSync(join(src, entry.name), join(dest, entry.name), { recursive: true, force: true });
  }
}

/** 把解压出的顶层目录内容搬到 runtimeDir（对齐 CI 各平台拷贝范围） */
function placeFiles(extractedDir) {
  const dirs = readdirSync(extractedDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const top =
    dirs.length === 1 ? dirs[0] : dirs.find((e) => e.name.startsWith(`node-v${NODE_VERSION}`));
  if (!top) {
    throw new Error(`unexpected archive layout under ${extractedDir}`);
  }
  const srcRoot = join(extractedDir, top.name);

  if (process.platform === "win32") {
    // 对齐 CI：Copy-Item "$src/*" node-runtime -Recurse（拷贝全部内容：node.exe / node_modules / npm* …）
    copyDirContents(srcRoot, runtimeDir);
  } else {
    // 对齐 CI：仅 cp bin/lib/include
    for (const sub of ["bin", "lib", "include"]) {
      const s = join(srcRoot, sub);
      if (existsSync(s)) {
        cpSync(s, join(runtimeDir, sub), { recursive: true, force: true });
      }
    }
    // 兜底可执行位（cp 可能丢失，显式设回）
    for (const name of ["node", "npm", "npx"]) {
      const p = join(runtimeDir, "bin", name);
      if (existsSync(p)) chmodSync(p, 0o755);
    }
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const force = process.argv.slice(2).includes("--force");
  console.log(`${TAG} platform=${process.platform}-${process.arch} target=${runtimeDir}`);

  if (!force && isRuntimeReady()) {
    const bin = expectedNodeBinary();
    console.log(`${TAG} node runtime ready (node ${nodeVersionString(bin)}), skipping.`);
    console.log(`${TAG} (用 --force 强制重新下载，例如升级 NODE_VERSION 后)`);
    return;
  }
  console.log(force ? `${TAG} --force: 重新下载 node runtime` : `${TAG} node runtime 缺失，开始下载…`);

  const info = resolveAsset();
  if (!info) {
    warnUnsupported();
    return;
  }

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${info.asset}.${info.ext}`;
  const tmp = mkdtempSync(join(tmpdir(), "node-runtime-"));
  try {
    const archivePath = join(tmp, `node.${info.ext}`);
    const extracted = join(tmp, "extracted");

    console.log(`${TAG} 下载 ${url}`);
    await download(url, archivePath);
    console.log(`${TAG} 下载完成，解压中…`);
    extract(archivePath, extracted, info.ext);

    cleanRuntimeDir();
    placeFiles(extracted);

    // 验证
    const bin = expectedNodeBinary();
    if (!existsSync(bin)) {
      throw new Error(`解压后未找到 node 二进制：${bin}`);
    }
    const ver = nodeVersionString(bin);
    if (ver === "(unknown)") {
      throw new Error(`node 二进制不可运行：${bin}`);
    }
    if (!existsSync(expectedNpmCli())) {
      throw new Error(`解压后未找到 npm-cli.js：${expectedNpmCli()}`);
    }
    console.log(`${TAG} 完成 ✓ node ${ver}，npm-cli.js 就位`);
  } catch (err) {
    // soft-fail：不阻断 dev（dev 模式 sidecar 走 tsx，node-runtime 仅 gitnexus 需要）
    console.error("");
    console.error(`${TAG} ⚠️  下载/解压失败：${err && err.message ? err.message : err}`);
    console.error(`${TAG}    dev 未被阻断，但 gitnexus「安装」会失败。`);
    console.error(`${TAG}    请检查网络/代理后重跑：  pnpm setup:runtime`);
    console.error("");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function warnUnsupported() {
  console.error("");
  console.error(
    `${TAG} ⚠️  不支持的平台/架构：${process.platform}-${process.arch}`
  );
  console.error(`${TAG}    dev 未被阻断，但 gitnexus「安装」会失败。`);
  console.error(`${TAG}    请手动放置 Node.js 二进制到 ${runtimeDir}`);
  console.error(`${TAG}    （布局：Windows → node.exe + node_modules/npm/…；Unix → bin/node + lib/node_modules/npm/…）`);
  console.error("");
}

main().catch((err) => {
  // 兜底：任何未捕获异常也走 soft-fail，绝不阻断 dev
  console.error(`${TAG} ⚠️  未预期的错误：${err && err.stack ? err.stack : err}`);
  console.error(`${TAG}    dev 未被阻断。请重跑 pnpm setup:runtime 排查。`);
});
