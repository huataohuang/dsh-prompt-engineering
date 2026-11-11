// 跨平台守卫：运行时代码不得引入平台相关依赖，打包脚本不得依赖平台 tar/shell。
// 目标是 macOS / Windows / Linux 用同一份产物，且不因路径分隔符或 shell 差异失效。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(root, relative), 'utf8')

test('运行时两半不引入任何 Node 内置模块或进程 API', () => {
  for (const file of ['index.js', 'client.js']) {
    const source = read(file)
    assert.equal(/from\s+'node:/.test(source), false, file + ' 不应 import node: 模块')
    assert.equal(/require\(\s*'node:/.test(source), false, file + ' 不应 require node: 模块')
    assert.equal(/child_process|process\.platform|process\.env/.test(source), false, file + ' 不应读取进程/平台信息')
    assert.equal(/[A-Za-z]:\\\\/.test(source), false, file + ' 不应出现 Windows 盘符路径')
  }
})

test('浏览器半的路由常量是文档相对形式（挂载点与外壳无关）', () => {
  const source = read('client.js')
  const match = /var ROUTE = '([^']+)'/.exec(source)
  assert.ok(match, 'client.js 必须声明 ROUTE')
  assert.equal(match[1].startsWith('/'), false, 'ROUTE 必须是文档相对路径（不能以斜杠开头）')
  assert.equal(match[1], 'api/prompt-engineering/optimize')
  assert.match(source, /new URL\(ROUTE, document\.baseURI\)/)
})

test('宿主半注册的路由是 app 归属的绝对路径，且两半路径一致', () => {
  const host = read('index.js')
  const path = /const ROUTE_PATH = '([^']+)'/.exec(host)
  assert.ok(path, 'index.js 必须声明 ROUTE_PATH')
  assert.equal(path[1].startsWith('/api/'), true, 'Connection 精确路由必须位于 /api 之下')
  const client = /var ROUTE = '([^']+)'/.exec(read('client.js'))
  assert.equal(path[1].slice(1), client[1], '两半的路径必须互为去斜杠形式')
})

test('打包脚本走纯 Node 校验，不调用平台 tar 或 shell', () => {
  const source = read('scripts/pack.mjs')
  assert.match(source, /from '\.\/lib\/tar\.mjs'/, 'pack.mjs 必须用自带的 tar 读取器校验')
  assert.equal(/execFileSync\(\s*'tar'/.test(source), false, 'pack.mjs 不得调用平台 tar')
  assert.equal(/shell:\s*true/.test(source), false, 'pack.mjs 不得开启 shell')
  assert.match(source, /process\.platform === 'win32' \? 'npm\.cmd' : 'npm'/, 'Windows 下必须解析 npm.cmd')
  assert.match(source, /process\.platform === 'win32' \? 'pnpm\.cmd' : 'pnpm'/)
})

test('包清单不限制操作系统，且文件清单覆盖运行所需', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.equal(Object.hasOwn(manifest, 'os'), false, '不得用 os 字段限制平台')
  assert.equal(Object.hasOwn(manifest, 'cpu'), false)
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'docs']) {
    assert.ok(manifest.files.includes(file), 'files 需包含 ' + file)
  }
  assert.equal(manifest.dsh.client.platform, 'web')
})
