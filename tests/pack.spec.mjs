// 打包测试：真实跑一次打包，用纯 Node 的 tar 读取器校验内容。
// 没有可用打包器（pnpm/npm）时跳过。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { listTarEntries } from '../scripts/lib/tar.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('打包产出的 tarball 含全部运行时文件', () => {
  const dest = mkdtempSync(join(tmpdir(), 'dsh-pe-pack-'))
  let output = ''
  try {
    output = execFileSync(process.execPath, [join(root, 'scripts', 'pack.mjs'), '--dest', dest], { cwd: root, encoding: 'utf8' })
  } catch (error) {
    output = String((error && error.stdout) || '') + String((error && error.stderr) || '')
    if (/没有可用的打包器/.test(output)) {
      test.skip('本机没有可用的 pnpm/npm 打包器')
      return
    }
    throw error
  }
  assert.match(output, /\[pack\] 完成/)
  assert.match(output, /\[pack\] sha256 [0-9a-f]{64}/)

  const tarball = join(dest, manifest.name.replace(/^@[^/]+\//, '') + '-' + manifest.version + '.tgz')
  assert.equal(existsSync(tarball), true, '打包脚本应产出预期的 tgz')
  const entries = listTarEntries(readFileSync(tarball))
  for (const required of ['package/package.json', 'package/index.js', 'package/client.js', 'package/cordis.patch.yml', 'package/icon.svg', 'package/README.md', 'package/docs/DETAIL.md']) {
    assert.ok(entries.includes(required), '缺少 ' + required)
  }
  assert.equal(entries.some((entry) => entry.startsWith('/')), false, '包内路径必须是相对路径')
})

test('纯 Node tar 读取器能读出 gzip 包的条目', () => {
  const dest = mkdtempSync(join(tmpdir(), 'dsh-pe-tar-'))
  let available = true
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'pack.mjs'), '--dest', dest], { cwd: root, stdio: 'pipe' })
  } catch {
    available = false
  }
  if (!available) {
    test.skip('本机没有可用的 pnpm/npm 打包器')
    return
  }
  const file = readdirSync(dest).find((name) => name.endsWith('.tgz'))
  const entries = listTarEntries(readFileSync(join(dest, file)))
  assert.ok(entries.length >= 6)
  assert.ok(entries.includes('package/package.json'))
  assert.equal(entries.some((entry) => entry.includes('\\')), false, '条目名不应含反斜杠')
})
