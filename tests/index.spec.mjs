// 索引测试：用 DSH 自带的 parseMarketIndex 校验生成的 format 1 索引，并做一次反向用例。
// 找不到校验器时跳过（它来自 DSH 源码 checkout，不是本包的依赖）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 在若干常见位置找 DSH 的索引校验器。 */
function marketIndexLib() {
  const candidates = [
    process.env.DSH_MARKET_INDEX_LIB,
    join(homedir(), 'deepseek-harness', 'packages', 'util', 'plugin-market-index', 'lib', 'index.js'),
  ].filter((value) => typeof value === 'string' && value.length > 0)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const lib = marketIndexLib()

function generate(extraArgs) {
  const out = join(mkdtempSync(join(tmpdir(), 'dsh-pe-index-')), 'index.json')
  execFileSync(process.execPath, [
    join(root, 'scripts', 'make-index.mjs'),
    '--version', '9.9.9',
    '--timestamp', '1700000000',
    '--channel', 'npm',
    '--base-url', 'https://plugins.example.com/index.json',
    '--out', out,
    ...extraArgs,
  ], { cwd: root })
  return JSON.parse(readFileSync(out, 'utf8'))
}

test('生成的索引能被 DSH 的 parseMarketIndex 接受', { skip: lib === null ? '找不到 DSH 的 plugin-market-index 校验器' : false }, async () => {
  const { parseMarketIndex } = await import('file://' + lib)
  const index = generate([])
  const parsed = parseMarketIndex(index, 'https://plugins.example.com/index.json')
  assert.equal(parsed.format, 1)
  assert.ok(parsed.title.en, '顶层 title 必须含 en')
  assert.equal(parsed.plugins.length, 1)
  const plugin = parsed.plugins[0]
  assert.equal(plugin.name, 'dsh-prompt-engineering')
  assert.equal(plugin.metadata.category, 'input')
  assert.deepEqual(plugin.metadata.labels, ['third-party', 'prompt'])
  assert.equal(plugin.versions[0].version, '9.9.9')
  assert.equal(plugin.versions[0].publishTimestamp, 1700000000)
  assert.deepEqual(plugin.versions[0].source, { type: 'npm' })
  assert.match(plugin.versions[0].engines.dsh, /^>=0\.2\.0/)
})

test('索引字段本身齐备（不依赖校验器）', () => {
  const index = generate([])
  assert.equal(index.format, 1)
  assert.ok(index.title.zh && index.title.en)
  const plugin = index.plugins[0]
  assert.ok(plugin.title.zh && plugin.title.en, '插件标题需中英双语')
  assert.ok(plugin.description.zh && plugin.description.en, '插件简介需中英双语')
  assert.ok(Object.hasOwn(index.metadata.categories, 'input'))
  for (const label of plugin.metadata.labels) assert.ok(Object.hasOwn(index.metadata.labels, label))
})

test('非法输入被拒绝：非 SemVer 版本 / 残缺的 git 通道', () => {
  const run = (args) => {
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'make-index.mjs'), ...args], { cwd: root, stdio: 'pipe' })
      return 0
    } catch (error) {
      return error.status
    }
  }
  assert.notEqual(run(['--version', 'v1.2']), 0)
  assert.notEqual(run(['--channel', 'git', '--git-url', 'https://github.com/a/b']), 0)
  assert.notEqual(run(['--channel', 'ftp']), 0)
})
