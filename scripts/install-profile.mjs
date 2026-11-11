#!/usr/bin/env node
/**
 * 把本插件安装进一个 DSH profile —— 不依赖 pnpm，也不触碰其它依赖。
 *
 * 为什么不用 dsh plugin add：那条路要求 PATH 上有 pnpm（桌面版运行时只带 pnpm.mjs），
 * 而且官方提醒「必须在应用完全退出后再操作 desktop profile」。本脚本只做三件最小改动：
 *   1. profile 的 package.json：dependencies 增加 link: 依赖，dsh.profile.bundles 追加插件行；
 *   2. profile 的 pnpm-lock.yaml：按 pnpm 自己的形状补一条 importer 记录（保持 lock 一致）；
 *   3. profile 的 node_modules 下建立指向本包的软链（Windows 用 junction，免管理员权限）。
 * 不运行 pnpm，因此不会重装或裁剪既有依赖，可随时用 --uninstall 原样回滚。
 *
 * 用法：
 *   node scripts/install-profile.mjs --profile desktop
 *   node scripts/install-profile.mjs --profile web --uninstall
 *   DSH_HOME=/tmp/dsh node scripts/install-profile.mjs --profile web
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const name = manifest.name

function arg(flag, fallback) {
  const index = process.argv.indexOf('--' + flag)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

/** 从 lockfile 文本里删掉一条 importer 依赖（含其下更深的子行）。 */
function dropLockEntry(text, entryName) {
  const lines = text.split('\n')
  const head = '      ' + entryName + ':'
  const out = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === head) {
      let next = index + 1
      while (next < lines.length && lines[next].startsWith('        ')) next += 1
      index = next - 1
      continue
    }
    out.push(lines[index])
  }
  return out.join('\n')
}

const profile = arg('profile', 'desktop')
const uninstall = process.argv.includes('--uninstall')
const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
  ? process.env.DSH_HOME
  : join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)
const manifestPath = join(profileDir, 'package.json')
const lockPath = join(profileDir, 'pnpm-lock.yaml')
const linkPath = join(profileDir, 'node_modules', name)
const backupDir = join(packageRoot, 'dist', '_profile-backup')
const specifier = 'link:' + packageRoot
const lockVersion = 'link:' + relative(profileDir, packageRoot).split('\\').join('/')

function fail(message) {
  console.error('[install] ' + message)
  process.exit(1)
}

/**
 * 删除插件链接。Windows 上它是指向目录的 junction：必须用 rmdir（只删链接，绝不进入目标目录），
 * 用 unlink/rm/del 会失败，用递归删除更会连着源目录里的文件一起删掉。
 */
function removeLink(path) {
  if (process.platform === 'win32') rmdirSync(path)
  else rmSync(path, { force: true })
}

if (!existsSync(manifestPath)) {
  fail('找不到 ' + manifestPath + '；先启动一次该 profile 对应的应用（desktop 需先打开一次 DSH Desktop）。')
}

const profileManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = profileManifest.dsh && profileManifest.dsh.profile && profileManifest.dsh.profile.bundles
if (!Array.isArray(bundles)) fail('profile 没有 dsh.profile.bundles 列表，无法安全追加。')

const changes = []

// —— 1. profile 清单 ——
const dependencies = profileManifest.dependencies ?? (profileManifest.dependencies = {})
if (uninstall) {
  if (Object.hasOwn(dependencies, name)) { delete dependencies[name]; changes.push('dependencies 移除 ' + name) }
  const at = bundles.indexOf(name)
  if (at >= 0) { bundles.splice(at, 1); changes.push('bundles 移除 ' + name) }
} else {
  if (dependencies[name] !== specifier) { dependencies[name] = specifier; changes.push('dependencies 写入 ' + name + ' = ' + specifier) }
  if (!bundles.includes(name)) { bundles.push(name); changes.push('bundles 追加 ' + name) }
}

// —— 2. lockfile（与 pnpm 生成的形状保持一致）——
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf8')
  const marker = '  .:\n    dependencies:\n'
  const holds = lock.includes('      ' + name + ':\n')
  if (uninstall) {
    if (holds) {
      writeFileSync(lockPath, dropLockEntry(lock, name))
      changes.push('pnpm-lock.yaml 移除 importer 条目')
    }
  } else if (!holds) {
    if (!lock.includes(marker)) fail('pnpm-lock.yaml 结构与预期不符（缺少 importer 段），已中止以免写坏 lockfile。')
    const entry = '      ' + name + ':\n        specifier: ' + specifier + '\n        version: ' + lockVersion + '\n'
    writeFileSync(lockPath, lock.replace(marker, marker + entry))
    changes.push('pnpm-lock.yaml 追加 importer 条目')
  }
}

// —— 3. 备份 + 写回清单 ——
if (changes.length > 0) {
  mkdirSync(backupDir, { recursive: true })
  const backup = join(backupDir, profile + '-package.json.bak')
  if (!existsSync(backup)) { copyFileSync(manifestPath, backup); changes.push('已备份 profile 清单到 ' + relative(packageRoot, backup)) }
  else changes.push('备份已存在，保留不覆盖：' + relative(packageRoot, backup))
  writeFileSync(manifestPath, JSON.stringify(profileManifest, null, 2) + '\n')
}

// —— 4. node_modules 软链 ——
const linkType = process.platform === 'win32' ? 'junction' : 'dir'
if (uninstall) {
  if (existsSync(linkPath)) { removeLink(linkPath); changes.push('移除链接 ' + linkPath) }
} else {
  let relink = true
  if (existsSync(linkPath)) {
    const stats = lstatSync(linkPath)
    if (stats.isSymbolicLink()) {
      if (process.platform === 'win32') {
        // junction 的 readlink 结果可能带 \\?\ 前缀，且它一定是目录；直接重建最稳。
        removeLink(linkPath)
      } else {
        const current = resolve(profileDir, 'node_modules', readlinkSync(linkPath))
        if (current === packageRoot) relink = false
        else removeLink(linkPath)
      }
    } else {
      fail(linkPath + ' 已存在且不是软链（可能是真实目录），拒绝覆盖，请先手动处理。')
    }
  }
  if (relink) {
    mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
    symlinkSync(packageRoot, linkPath, linkType)
    changes.push('建立软链 node_modules/' + name)
  }
}

// —— 5. 校验解析结果 ——
const require = createRequire(join(profileDir, 'package.json'))
const resolved = uninstall ? null : require.resolve(name)
const resolvedClient = uninstall ? null : require.resolve(name + '/client')
if (!uninstall) {
  if (resolve(resolved) !== resolve(join(packageRoot, manifest.main ?? 'index.js'))) fail('解析到 ' + resolved + '，不是本包，已中止。')
  if (resolve(resolvedClient) !== resolve(join(packageRoot, 'client.js'))) fail('客户端半解析异常：' + resolvedClient)
}

console.log('[install] profile  : ' + profile + '（' + profileDir + '）')
console.log('[install] 动作     : ' + (uninstall ? '卸载' : '安装'))
for (const change of changes) console.log('[install]   - ' + change)
if (changes.length === 0) console.log('[install]   - 无需改动（已是目标状态）')
if (!uninstall) {
  console.log('[install] 宿主半   : ' + resolved)
  console.log('[install] 客户端半 : ' + resolvedClient)
  console.log('[install] 下一步   : 完全退出并重新打开应用，才会重新组合插件。')
}
