// 宿主半测试：不启动 DSH，直接驱动路由处理器与装载函数。
// 运行：node --test tests/host.spec.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, __test } from '../index.js'

const { handleOptimize, normalizeOutput, ROUTE_PATH } = __test

/** 造一个最小宿主上下文：捕获路由注册与模型调用参数。 */
function makeCtx(options = {}) {
  const routes = []
  const calls = []
  const disposers = []
  const ctx = {
    effect(fn) { disposers.push(fn()) },
    get(name) {
      if (name === 'agentDefaultModel' && options.defaultModel !== null) {
        return { currentSelection: () => options.defaultModel ?? { provider: 'def', model: 'def-model' } }
      }
      return undefined
    },
    llm: {
      stream(request) {
        calls.push(request)
        const chunks = options.chunks ?? [
          { type: 'block-start', index: 0, blockType: 'text' },
          { type: 'text-delta', index: 0, text: options.reply ?? '改写后的提示词' },
          { type: 'block-end', index: 0, block: { type: 'text', text: options.reply ?? '改写后的提示词' } },
          { type: 'finish', reason: options.finish ?? { kind: 'stop' } },
        ]
        return (async function* () { for (const chunk of chunks) yield chunk })()
      },
      async listProviders() { return options.providers ?? [] },
      async listModels() { return options.models ?? [] },
    },
    connection: {
      fetch: {
        register(route) { routes.push(route); return async () => {} },
      },
    },
  }
  return { ctx, routes, calls, disposers }
}

/** 造一个 POST 请求。 */
function post(body, headers = { 'content-type': 'application/json' }) {
  return new Request('http://127.0.0.1:3080/api/prompt-engineering/optimize', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('装载时注册 app 归属的精确路由', () => {
  const { ctx, routes } = makeCtx()
  apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, ROUTE_PATH)
  assert.equal(routes[0].path.startsWith('/api/'), true, '路径必须位于 /api 之下')
  assert.deepEqual(routes[0].methods, ['POST'])
  assert.equal(routes[0].requestBody, 'buffered')
  assert.equal(typeof routes[0].fetch, 'function')
})

test('正常改写：返回 ok:true 与改写稿，且提示词带上了草稿与模式规则', async () => {
  const { ctx, calls } = makeCtx({ reply: '请把 A 改成 B。\n- 约束：保留 C' })
  const response = await handleOptimize(ctx, post({
    text: '把A改成B，注意C', mode: 'structure', extra: '面向新人', context: '这是内部工具', locale: 'zh',
    provider: 'imatrix', model: 'SP-0001', sessionId: 's-1',
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.text, '请把 A 改成 B。\n- 约束：保留 C')
  assert.equal(body.value.provider, 'imatrix')
  assert.equal(body.value.model, 'SP-0001')
  assert.equal(body.value.mode, 'structure')
  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.equal(call.provider, 'imatrix')
  assert.equal(call.model, 'SP-0001')
  assert.equal(call.purpose, 'prompt-engineering')
  assert.equal(call.sessionId, 's-1')
  assert.match(call.system, /结构化/)
  const userText = call.messages[0].content[0].text
  assert.match(userText, /把A改成B，注意C/)
  assert.match(userText, /面向新人/)
  assert.match(userText, /这是内部工具/)
})

test('英文语言键走英文系统提示词', async () => {
  const { ctx, calls } = makeCtx()
  await handleOptimize(ctx, post({ text: 'fix the bug', locale: 'en', provider: 'p', model: 'm' }))
  assert.match(calls[0].system, /senior prompt engineer/)
  const userText = calls[0].messages[0].content[0].text
  assert.match(userText, /\[User draft\]/)
})

test('空草稿被拒', async () => {
  const { ctx, calls } = makeCtx()
  const body = await (await handleOptimize(ctx, post({ text: '   ' }))).json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'prompt-engineering/empty-draft')
  assert.equal(calls.length, 0)
})

test('超长草稿被拒', async () => {
  const { ctx } = makeCtx()
  const body = await (await handleOptimize(ctx, post({ text: 'x'.repeat(12001) }))).json()
  assert.equal(body.error.code, 'prompt-engineering/too-long')
})

test('非 JSON 请求体被拒', async () => {
  const { ctx } = makeCtx()
  const body = await (await handleOptimize(ctx, post('not json'))).json()
  assert.equal(body.error.code, 'prompt-engineering/bad-request')
})

test('GET 返回 405', async () => {
  const { ctx } = makeCtx()
  const request = new Request('http://127.0.0.1/api/prompt-engineering/optimize', { method: 'GET' })
  const response = await handleOptimize(ctx, request)
  assert.equal(response.status, 405)
})

test('没有可用模型时返回 no-model', async () => {
  const { ctx } = makeCtx({ defaultModel: null, providers: [] })
  const body = await (await handleOptimize(ctx, post({ text: '你好' }))).json()
  assert.equal(body.error.code, 'prompt-engineering/no-model')
})

test('默认模型服务兜底', async () => {
  const { ctx, calls } = makeCtx({ defaultModel: { provider: 'imatrix', model: 'SP-0001' } })
  const body = await (await handleOptimize(ctx, post({ text: '你好' }))).json()
  assert.equal(body.ok, true)
  assert.equal(calls[0].provider, 'imatrix')
  assert.equal(calls[0].model, 'SP-0001')
})

test('提供方列表兜底：取第一个提供方的第一个模型', async () => {
  const { ctx, calls } = makeCtx({ defaultModel: null, providers: [{ id: 'imatrix' }], models: ['SP-0001'] })
  const body = await (await handleOptimize(ctx, post({ text: '你好' }))).json()
  assert.equal(body.ok, true)
  assert.equal(calls[0].provider, 'imatrix')
  assert.equal(calls[0].model, 'SP-0001')
})

test('模型报错转成稳定的失败码', async () => {
  const { ctx } = makeCtx({
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { code: 'rate_limited', message: '429' } } }],
  })
  const body = await (await handleOptimize(ctx, post({ text: '你好', provider: 'p', model: 'm' }))).json()
  assert.equal(body.error.code, 'prompt-engineering/model-failed')
  assert.match(body.error.message, /rate_limited/)
})

test('模型只回了围栏或空内容时返回 empty-output', async () => {
  const { ctx } = makeCtx({ reply: '   ' })
  const body = await (await handleOptimize(ctx, post({ text: '你好', provider: 'p', model: 'm' }))).json()
  assert.equal(body.error.code, 'prompt-engineering/empty-output')
})

test('normalizeOutput 去掉整条结果的代码围栏与前缀', () => {
  assert.equal(normalizeOutput('```\n正文\n```'), '正文')
  assert.equal(normalizeOutput('优化后的提示词：正文'), '正文')
  assert.equal(normalizeOutput('Prompt: body'), 'body')
  assert.equal(normalizeOutput('  正文  '), '正文')
})

test('未知模式回落到 auto，长度字段被裁剪', async () => {
  const { ctx, calls } = makeCtx()
  const body = await (await handleOptimize(ctx, post({
    text: '你好', mode: '不存在的模式', extra: 'e'.repeat(2500), context: 'c'.repeat(4500), provider: 'p', model: 'm',
  }))).json()
  assert.equal(body.value.mode, 'auto')
  const userText = calls[0].messages[0].content[0].text
  assert.equal(userText.includes('e'.repeat(2000)), true)
  assert.equal(userText.includes('e'.repeat(2001)), false)
  assert.equal(userText.includes('c'.repeat(4000)), true)
  assert.equal(userText.includes('c'.repeat(4001)), false)
})
