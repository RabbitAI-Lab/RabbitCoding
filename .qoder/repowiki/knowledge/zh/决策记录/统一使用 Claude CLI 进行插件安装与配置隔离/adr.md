# 统一使用 Claude CLI 进行插件安装与配置隔离

_来源：0aa6df7 → dc1bf71 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
RabbitCoding 需要集成多个 Claude 插件（如 ECC、Claude-Mem），但原有的基于 npx 的安装方式存在包名映射错误，且默认将插件安装到全局 ~/.claude 目录，导致应用侧车（sidecar）无法通过专用的 CLAUDE_CONFIG_DIR 加载插件。为确保插件在应用沙箱内正确运行，必须统一安装机制并强制注入环境变量。

## 决策驱动
- 配置隔离性
- 安装可靠性
- 架构一致性

## 备选方案
- **继续使用 npx 直接调用插件包** _（已否决）_ — 优点：实现简单，无需额外依赖；缺点：ECC 等插件的 bin 命令与 npm 包名不一致导致 404 错误；默认写入全局配置目录，破坏应用隔离性
- **使用 Claude TUI 斜杠命令 (/plugin ...)** _（已否决）_ — 优点：用户交互直观；缺点：难以在非交互式后端进程中自动化执行，且难以精确控制环境变量注入
- **统一采用 Claude CLI 非交互子命令并注入 CLAUDE_CONFIG_DIR** — 优点：支持自动化安装；通过注入 CLAUDE_CONFIG_DIR 确保插件落入应用专用目录 (app_local_data_dir/claude-home)；与 sidecar 加载逻辑完全对齐；缺点：需要维护 find_claude 等路径查找逻辑；需处理 marketplace add 和 install 两步流程

## 决策
废弃基于 npx 的安装逻辑，统一采用 `claude plugin marketplace add` 和 `claude plugin install` 命令行流程。所有插件安装命令在执行时均强制注入 `CLAUDE_CONFIG_DIR` 环境变量，指向应用专用数据目录。同时重构 `ecc.rs` 复用 `claude_mem.rs` 中的配置目录获取与 CLI 查找辅助函数，确保所有插件行为一致。

## 影响
所有插件均被隔离在应用专用目录中，避免了全局污染和加载失败问题。后端 Rust 模块间形成了统一的插件管理基础设施（get_claude_config_dir, find_claude），降低了新增插件的开发成本。卸载操作默认保留数据目录以保护用户记忆数据。