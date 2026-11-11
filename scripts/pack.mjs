#!/usr/bin/env node
/**
 * 打包发布：产出可被 dsh plugin add 直接安装的 tarball，并校验内容完整。
 *
 * 跨平台：打包优先用 DSH 运行时自带的 pnpm（Windows/macOS/Linux 同一份 node 脚本），
 * 回退 npm（Windows 下走 npm.cmd）；校验压缩包内容用纯 Node 的 tar 读取器，
 * 不调用平台的 tar 命令，也不需要 shell 展开通配符。
 *
 * 用法：node scripts/pack.mjs [--dest dist]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listTarEntries } from './lib/tar.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const destIndex = process.argv.indexOf('--dest')
const dest = resolve(root, destIndex >= 0 && process.argv[destIndex + 1] !== undefined ? process.argv[destIndex + 1] : 'dist')
mkdirSync(dest, { recursive: true })

/** 候选打包器：先 DSH 自带 pnpm，再平台上的 npm。 */
function candidates() {
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : resolve(homedir(), '.dsh')
  const bundled = resolve(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
  const list = []
  if (existsSync(bundled)) list.push({ label: 'bundled pnpm', command: process.execPath, args: [bundled] })
  list.push({ label: 'pnpm', command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: [] })
  list.push({ label: 'npm', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] })
  return list
}

let packed = false
const failures = []
for (const candidate of candidates()) {
  try {
    execFileSync(candidate.command, [...candidate.args, 'pack', '--pack-destination', dest], { cwd: root, stdio: 'inherit' })
    console.log('[pack] 使用 ' + candidate.label + ' 完成打包')
    packed = true
    break
  } catch (error) {
    failures.push(candidate.label + ': ' + (error && error.message ? error.message.split('\n')[0] : String(error)))
  }
}
if (!packed) {
  console.error('[pack] 没有可用的打包器（需要 pnpm 或 npm）：')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}

const expected = manifest.name.replace(/^@[^/]+\//, '') + '-' + manifest.version + '.tgz'
const tarball = resolve(dest, expected)
if (!existsSync(tarball)) {
  const found = readdirSync(dest).filter((name) => name.endsWith('.tgz'))
  console.error('[pack] 没找到预期的 ' + expected + '；' + dest + ' 下现有：' + (found.join(', ') || '（无）'))
  process.exit(1)
}

// 纯 Node 校验：必需文件是否都在（不依赖平台 tar）。
const entries = listTarEntries(readFileSync(tarball))
const required = [
  'package/package.json',
  'package/index.js',
  'package/client.js',
  'package/cordis.patch.yml',
  'package/icon.svg',
  'package/README.md',
  'package/docs/DETAIL.md'
]
const missing = required.filter((entry) => !entries.includes(entry))
if (missing.length > 0) {
  console.error('[pack] 压缩包缺少必需文件：' + missing.join(', '))
  console.error('[pack] 检查 package.json 的 files 白名单。')
  process.exit(1)
}

const bytes = readFileSync(tarball)
const sha256 = createHash('sha256').update(bytes).digest('hex')
console.log('')
console.log('[pack] 完成：' + tarball)
console.log('[pack] 条目 ' + entries.length + ' 个，大小 ' + (bytes.length / 1024).toFixed(1) + ' KiB')
console.log('[pack] sha256 ' + sha256)
console.log('[pack] 本地安装（任选其一）：')
console.log('  dsh plugin --profile web add ' + tarball)
console.log('  插件 → 发现 → 索引源：把索引 URL 加进去后点安装（桌面版推荐）')
