# Git、CI 与发布规范

团队分支、提交、同步、PR、冲突和回滚的完整规则见 `team-git-workflow.md`。本文件重点描述发布和 CI。

## 工作区

- 开始前和结束前都检查 `git status --short --branch`。
- 不撤销用户已有修改。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 提交前检查冒烟临时目录、构建产物和日志未被加入。

## 授权边界

- 修改代码不等于授权 commit。
- commit 不等于授权 push。
- push 不等于授权创建 PR、合并、打标签或发布。
- 每项外部变更都需要用户明确授权。

## CI

- 修改测试、构建资源或 Skill 时检查 workflow 的 paths 过滤。
- Node、Rust、资源装配和版本写入步骤需要与本地命令一致。
- 首次启用或大改 Tauri release workflow 后需要人工观察真实运行。

## 发布

- 版本号必须在相关 package/config 中一致。
- 发布资产名称、SHA256SUMS 和 updater 资产选择规则保持一致。
- 发布前完成对应 V5 验收。
- 不以“本地能启动”代替安装版和便携版验证。
- 不发布含调试资源、临时凭据、用户 profile 或本机绝对路径的产物。

## 版本同步点

- `dsh-desktop/package.json`
- `dsh-desktop/package-lock.json`
- `tauri-shell/tauri.conf.json`
- 安装包和便携包文件名
- updater 的 release 资产选择规则
- CHANGELOG 和升级说明

## 当前工作流

`.github/workflows/` 下**只有两个**（2026-10-14 实测）：

- `.github/workflows/ci.yml`：现行 CI，Windows x64 单平台，三个 job
  （`source-and-unit` / `rust-shell` / `staged-runtime`）。
- `.github/workflows/staged-runtime-artifact.yml`：安装包打包工作流，`workflow_call` 型；
  **当前无调用者（孤儿）**，且它自身仍是 4 平台矩阵。接线方式与须同步的文件见 `ci.yml` 顶部注释。

`.deprecated/workflows/` 下是 4 个已退役的历史工作流：`ci.yml`、`clear-cache.yml`、
`release-macos.yml`、`release-tauri.yml`（后两者是 Tauri 时代的发布/验证管线）。
该目录不参与运行（旧 `ci.yml` 自述「GitHub Actions 只读取 `.github/workflows/`」）；
重新启用其中任何一个前必须先审查：`release-tauri.yml` 自述「尚未在线上实跑过」，
`release-macos.yml` 自身没有退役注记。更早的 `release.yml` 已被移除，不在本目录。

项目内置 `dsh-desktop/assets/skills/` 的修改应通过 CI paths 进入构建。开发者 Skill 部署到
`.agents/skills/deepseek-harness-eac-dev/` 后由 `.github/workflows/ci.yml` 的 paths
（现含 `.agents/skills/**`）覆盖；但**当前 CI 并不执行 Skill 自带的 PowerShell 校验脚本**，
改动 Skill 后需本地跑
`.agents/skills/deepseek-harness-eac-dev/scripts/validate-skill.ps1 -RepoPath .`。
位于仓库外的维护源仍不受仓库 CI 保护，必须通过副本 SHA-256 比较确认同步。
