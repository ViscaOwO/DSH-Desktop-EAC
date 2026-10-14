import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

function triggerBlock(event: 'pull_request' | 'push'): string {
  const match = workflow.match(new RegExp(`^  ${event}:\\n([\\s\\S]*?)(?=^  \\w|^concurrency:)`, 'm'));
  assert.ok(match, `CI 缺少 ${event} 触发器`);
  return match[1];
}

function jobBlock(jobName: string): string {
  const start = workflow.indexOf(`  ${jobName}:\n`);
  assert.notEqual(start, -1, `CI 缺少 ${jobName} job`);
  return workflow.slice(start).split(/\n  [a-z][\w-]*:\n/)[0];
}

test('单元与构建 CI 在 PR 到 dev/main 及 push 到 dev/main 时触发', () => {
  for (const event of ['pull_request', 'push'] as const) {
    const block = triggerBlock(event);
    assert.match(block, /branches:\n\s+- dev\n\s+- main\n/);
  }
  assert.match(workflow, /^  source-and-unit:/m);
  assert.match(workflow, /^  staged-runtime:/m);
});

// 平台策略：当前只跑 Windows x64 单平台（v6.0.0 release notes 明写 Linux 暂缓）。
// 恢复多平台矩阵时必须同步本断言 —— 它是「矩阵到底跑哪几个平台」的唯一锁。
test('构建、Rust 与 staged runtime 在 Windows x64 单平台上运行并隔离产物', () => {
  for (const jobName of ['source-and-unit', 'rust-shell', 'staged-runtime']) {
    const job = jobBlock(jobName);
    assert.match(job, /runs-on: \$\{\{ matrix\.runner \}\}/);
    assert.equal(
      (job.match(/^\s+- runner:/gm) ?? []).length,
      1,
      `${jobName} 当前只允许一个平台条目；恢复多平台时需同步本断言与 ci.yml`,
    );
    assert.match(job, /runner: windows-latest\n\s+os: windows\n\s+arch: x64/);
    assert.match(job, /process\.arch/);
    assert.match(job, /matrix\.arch/);
  }
  assert.match(workflow, /generated-bridge-\$\{\{ matrix\.os \}\}-\$\{\{ matrix\.arch \}\}/);
  assert.match(workflow, /key: \$\{\{ runner\.os \}\}-\$\{\{ matrix\.arch \}\}-kernel/);
  assert.match(workflow, /Prepare Tauri resource directory for Rust tests/);
  const rustJob = jobBlock('rust-shell');
  assert.match(rustJob, /(?:cpSync\(root\+'\/artifacts',staged\+'\/ui-skin-manager'|cpSync\('tauri-shell\/artifacts','tauri-shell\/staged-resources\/ui-skin-manager')/);
  assert.match(rustJob, /skin-manager-artifact\.lock\.json/);
  assert.match(rustJob, /Fetch Windows Cargo dependencies[\s\S]*?cargo fetch --locked/);
  assert.match(rustJob, /Prepare Windows WebView2Loader resource[\s\S]*?prepare-webview2-loader\.mjs --arch=\$\{\{ matrix\.arch \}\}/);
  const stagedJob = jobBlock('staged-runtime');
  assert.match(stagedJob, /Set up stable Rust for Windows resources[\s\S]*?Fetch Windows Cargo dependencies[\s\S]*?cargo fetch --locked[\s\S]*?Assemble staged runtime/);
});

// CodeQL `actions/missing-workflow-permissions`（CWE-275）：没有显式
// permissions 时 GITHUB_TOKEN 会继承仓库/组织默认权限（2023-02 之前创建的
// 仓库默认可写），违反最小权限。该查询接受 workflow 级或 job 级 permissions，
// 本 workflow 用 workflow 级一处覆盖三个 job。
test('CI 显式限制 GITHUB_TOKEN 权限（CodeQL actions/missing-workflow-permissions）', () => {
  const perms = workflow.match(/^permissions:\n((?:[ \t]+.*\n|\n)*)/m);
  assert.ok(perms, 'CI 缺少顶层 permissions 块，CodeQL 会再次报 actions/missing-workflow-permissions');
  // workflow 级 permissions 对所有未自带该键的 job 生效（CodeQL 的
  // jobHasPermissions 接受 job 级或所属 workflow 级，二者有其一即不告警）。
  assert.match(perms[1], /^ {2}contents: read$/m, 'permissions 必须至少含 contents: read');
});

// 形状锁补强：上面的断言只校验「整个文件里存在某串」—— 把步骤删掉、只把字符串
// 留在注释里照样能过；job 白名单与 needs 依赖图则完全没人锁。
// 这里把三件事补上，且全部作用在 **job 块内部**。
test('CI 的 job 白名单、needs 依赖图与关键步骤归属都被锁住', () => {
  const jobsSection = workflow.split(/^jobs:$/m)[1] ?? '';
  const declared = [...jobsSection.matchAll(/^  ([a-z][\w-]*):$/gm)].map((m) => m[1]);
  assert.deepEqual(
    declared.sort(),
    ['rust-shell', 'source-and-unit', 'staged-runtime'],
    'job 白名单不允许静默增删；确需变更时同步本断言与 ci.yml 顶部注释',
  );

  assert.match(jobBlock('rust-shell'), /^\s+needs: source-and-unit$/m);
  assert.match(jobBlock('staged-runtime'), /^\s+needs: source-and-unit$/m);

  const required: Array<[string, string[]]> = [
    ['source-and-unit', [
      'npm run typecheck',
      'npm run build',
      'scripts/plugin-ledger.mjs',
      'scripts/plugin-sync.mjs validate',
      'npm test',
      'check-manifest-drift.mjs',
    ]],
    ['rust-shell', ['cargo fmt -- --check', 'cargo test --locked', 'cargo check --locked']],
    ['staged-runtime', [
      'npm run fetch-runtime',
      'stage-resources.mjs',
      'verify-staged-runtime.mjs',
      'minimal-boot-smoke.mjs',
    ]],
  ];
  for (const [job, needles] of required) {
    const block = jobBlock(job);
    for (const needle of needles) {
      assert.ok(block.includes(needle), `${job} 必须包含步骤/命令：${needle}`);
    }
  }
});
