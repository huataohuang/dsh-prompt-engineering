// 客户端半测试：迷你 React 渲染真实组件，覆盖「一点就优化」的完整链路与全部拒绝分支。
// 运行：node --test tests/client.spec.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

// ---- 浏览器环境桩 ----
const documentListeners = []
const headChildren = []
const head = {
  appendChild(element) {
    element.parentNode = head
    headChildren.push(element)
    return element
  },
  removeChild(element) {
    const at = headChildren.indexOf(element)
    if (at >= 0) headChildren.splice(at, 1)
    element.parentNode = null
    return element
  },
}
const doc = {
  baseURI: 'http://127.0.0.1:49660/',
  head,
  createElement() { return { id: '', textContent: '', parentNode: null } },
  getElementById(id) { return headChildren.find((element) => element.id === id) ?? null },
  addEventListener: (type, fn) => { if (type === 'keydown') documentListeners.push(fn) },
  removeEventListener() {},
}
try {
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN', clipboard: { writeText: async () => {} } }, configurable: true, writable: true })
} catch {
  globalThis.document = doc
}

// ---- 迷你 React ----
let CURRENT = null
function flatten(children) {
  const out = []
  const push = (value) => {
    if (value === null || value === undefined || value === false || value === '') return
    if (Array.isArray(value)) { value.forEach(push); return }
    out.push(value)
  }
  children.forEach(push)
  return out
}
function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
  return true
}
const fakeReact = {
  createElement(type, props, ...children) { return { type, props: props || {}, children: flatten(children) } },
  useState(initial) {
    const store = CURRENT
    const index = store.cursor
    store.cursor += 1
    if (store.hooks.length <= index) store.hooks[index] = typeof initial === 'function' ? initial() : initial
    const set = (value) => {
      const next = typeof value === 'function' ? value(store.hooks[index]) : value
      if (Object.is(next, store.hooks[index])) return
      store.hooks[index] = next
      store.render()
    }
    return [store.hooks[index], set]
  },
  useEffect(fn, deps) {
    const store = CURRENT
    const index = store.effectCursor
    store.effectCursor += 1
    const previous = store.effects[index]
    if (previous && sameDeps(previous.deps, deps)) return
    if (previous && typeof previous.cleanup === 'function') previous.cleanup()
    store.effects[index] = { deps, cleanup: fn() }
  },
}
function mount(Component, props) {
  const store = { hooks: [], effects: [], cursor: 0, effectCursor: 0, tree: null }
  store.render = () => {
    store.cursor = 0
    store.effectCursor = 0
    CURRENT = store
    try { store.tree = Component(props) } finally { CURRENT = null }
    return store.tree
  }
  store.render()
  return store
}

// ---- 装载客户端 bundle ----
let definition = null
globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
await import('../client.js')
assert.ok(definition, 'bundle 必须调用 window.__ModuleLoader__.load')
assert.equal(definition.id, 'dsh-prompt-engineering')
const plugin = definition.factory((id) => {
  if (id === 'react') return fakeReact
  throw new Error('unexpected require: ' + id)
})
assert.deepEqual(plugin.inject, ['slots'])

const registrations = []
const disposers = []
const slots = {
  inject(key, callback) { registrations.push({ key, cell: callback() }) },
  register(options, component) { return { options, component } },
}
plugin.apply({
  slots,
  effect(fn) { disposers.push(fn()) },
})
const cell = registrations[0].cell
const OptimizeButton = cell.component

// ---- 树工具 ----
function walk(node, visit) {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number') { visit(node); return }
  if (Array.isArray(node)) { node.forEach((item) => walk(item, visit)); return }
  visit(node)
  ;(node.children || []).forEach((child) => walk(child, visit))
}
function find(node, predicate) {
  let found = null
  walk(node, (item) => { if (found === null && item && typeof item === 'object' && predicate(item)) found = item })
  return found
}
function textOf(node) {
  let out = ''
  walk(node, (item) => { if (typeof item === 'string') out += item })
  return out
}
function click(node) {
  assert.ok(node, '按钮必须存在')
  node.props.onMouseDown({ preventDefault() {} })
  node.props.onClick({ preventDefault() {} })
}

// ---- fetch 桩 ----
const fetchCalls = []
let respond = () => Promise.resolve(okResponse({ text: '改写结果', provider: 'p', model: 'm' }))
globalThis.fetch = (url, init) => { fetchCalls.push({ url, init }); return respond(url, init) }
const okResponse = (value) => new Response(JSON.stringify({ ok: true, value }), {
  status: 200, headers: { 'content-type': 'application/json' },
})
const errResponse = (code, message) => new Response(JSON.stringify({ ok: false, error: { code, message, details: {} } }), {
  status: 200, headers: { 'content-type': 'application/json' },
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeSession(sessionId, draft, phase) {
  const inputState = { draft, phase: phase || 'plain' }
  const applied = []
  const props = {
    sessionId,
    useInput: (selector) => selector(inputState),
    inputSession: null,
    inputActions: { setDraft: (value) => { applied.push(value); inputState.draft = value } },
  }
  return { inputState, applied, props }
}

test('只注册一个发送区槽位，并把样式表挂到 head', () => {
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].key, 'conversation.input.right')
  assert.equal(cell.options.id, 'prompt-engineering')
  assert.equal(cell.options.name, 'conversation.input.right')
  const style = doc.getElementById('dsh-prompt-engineering-style')
  assert.ok(style, '应注入插件样式表')
  assert.match(style.textContent, /width:28px/)
  assert.match(style.textContent, /border:0/)
  assert.match(style.textContent, /hover/)
})

test('按钮是纯图标：无文案、有 aria-label，草稿非空时可见', () => {
  const session = makeSession('s-icon', '把A改成B')
  const store = mount(OptimizeButton, session.props)
  const button = find(store.tree, (item) => item.type === 'button')
  assert.equal(textOf(button), '', '不得渲染任何文字')
  assert.equal(button.props['aria-label'], '优化提示词')
  assert.equal(button.props['data-empty'], 'false')
  assert.equal(button.props['data-tone'], 'idle')
  assert.match(button.props.title, /优化提示词/)
})

test('与 WorkBuddy 同款：草稿为空不渲染图标，输入后自动出现，清空后再次消失', () => {
  const session = makeSession('s-hide-empty', '   ')
  const store = mount(OptimizeButton, session.props)
  assert.equal(find(store.tree, (item) => item.type === 'button'), null, '空草稿不得渲染图标')

  session.inputState.draft = '把A改成B'
  store.render()
  const button = find(store.tree, (item) => item.type === 'button')
  assert.ok(button, '有输入后应自动出现')
  assert.equal(button.props['data-empty'], 'false')
  assert.match(button.props.title, /优化提示词/)

  session.inputState.draft = ''
  store.render()
  assert.equal(find(store.tree, (item) => item.type === 'button'), null, '清空后应再次消失')
})
test('一点即优化：请求体正确，成功后直接替换输入框', async () => {
  const session = makeSession('s-run', '把A改成B，注意C')
  const store = mount(OptimizeButton, session.props)
  const before = fetchCalls.length
  respond = () => new Promise((resolve) => { respond.resolve = resolve })
  click(find(store.tree, (item) => item.type === 'button'))

  assert.equal(fetchCalls.length, before + 1)
  const call = fetchCalls[fetchCalls.length - 1]
  assert.equal(call.url, 'http://127.0.0.1:49660/api/prompt-engineering/optimize')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(call.init.body), {
    text: '把A改成B，注意C',
    mode: 'auto',
    locale: 'zh',
    sessionId: 's-run',
  })
  assert.equal(find(store.tree, (item) => item.type === 'button').props['data-tone'], 'busy')
  assert.match(find(store.tree, (item) => item.type === 'button').props.title, /正在优化/)

  respond.resolve(okResponse({ text: '请把 A 改成 B。\n约束：保留 C', provider: 'imatrix', model: 'SP-0001' }))
  await tick()
  await tick()
  assert.deepEqual(session.applied, ['请把 A 改成 B。\n约束：保留 C'])
  assert.equal(session.inputState.draft, '请把 A 改成 B。\n约束：保留 C')
  const button = find(store.tree, (item) => item.type === 'button')
  assert.equal(button.props['data-tone'], 'done')
  assert.match(button.props.title, /已替换输入框内容/)
})

test('请求期间草稿被改动：放弃覆盖，保留用户的新输入', async () => {
  const session = makeSession('s-changed', '初稿')
  const store = mount(OptimizeButton, session.props)
  respond = () => new Promise((resolve) => { respond.resolve = resolve })
  click(find(store.tree, (item) => item.type === 'button'))

  session.inputState.draft = '用户自己接着写的'
  store.render()
  respond.resolve(okResponse({ text: '改写稿', provider: 'p', model: 'm' }))
  await tick()
  await tick()

  assert.deepEqual(session.applied, [], '不得覆盖用户的新草稿')
  const button = find(store.tree, (item) => item.type === 'button')
  assert.equal(button.props['data-tone'], 'warn')
  assert.match(button.props.title, /已放弃覆盖/)
})

test('输入框发送中：不发请求也不写回', () => {
  const session = makeSession('s-frozen', '初稿', 'sending')
  const store = mount(OptimizeButton, session.props)
  const before = fetchCalls.length
  click(find(store.tree, (item) => item.type === 'button'))
  assert.equal(fetchCalls.length, before)
  assert.deepEqual(session.applied, [])
  const button = find(store.tree, (item) => item.type === 'button')
  assert.equal(button.props['data-tone'], 'warn')
  assert.match(button.props.title, /发送或执行中/)
})

test('模型报错：不写回，标题展示失败原因', async () => {
  const session = makeSession('s-error', '初稿')
  const store = mount(OptimizeButton, session.props)
  respond = () => Promise.resolve(errResponse('prompt-engineering/no-model', '当前没有可用的模型，请先在输入框选择模型'))
  click(find(store.tree, (item) => item.type === 'button'))
  await tick()
  await tick()
  assert.deepEqual(session.applied, [])
  const button = find(store.tree, (item) => item.type === 'button')
  assert.equal(button.props['data-tone'], 'error')
  assert.match(button.props.title, /优化失败：当前没有可用的模型/)
})

test('模型返回空内容：不写回，提示重试', async () => {
  const session = makeSession('s-blank', '初稿')
  const store = mount(OptimizeButton, session.props)
  respond = () => Promise.resolve(okResponse({ text: '   ', provider: 'p', model: 'm' }))
  click(find(store.tree, (item) => item.type === 'button'))
  await tick()
  await tick()
  assert.deepEqual(session.applied, [])
  assert.match(find(store.tree, (item) => item.type === 'button').props.title, /没有返回内容/)
})

test('多会话互不串台', async () => {
  const first = makeSession('s-a', '甲会话')
  const second = makeSession('s-b', '乙会话')
  const firstStore = mount(OptimizeButton, first.props)
  const secondStore = mount(OptimizeButton, second.props)
  respond = () => new Promise((resolve) => { respond.resolve = resolve })
  click(find(firstStore.tree, (item) => item.type === 'button'))
  assert.equal(find(firstStore.tree, (item) => item.type === 'button').props['data-tone'], 'busy')
  assert.equal(find(secondStore.tree, (item) => item.type === 'button').props['data-tone'], 'idle')
  respond.resolve(okResponse({ text: '甲改写', provider: 'p', model: 'm' }))
  await tick()
  await tick()
  assert.deepEqual(first.applied, ['甲改写'])
  assert.deepEqual(second.applied, [])
})

test('卸载时移除样式表并清理会话状态', () => {
  assert.ok(doc.getElementById('dsh-prompt-engineering-style'))
  for (const dispose of disposers) dispose()
  assert.equal(doc.getElementById('dsh-prompt-engineering-style'), null)
})
