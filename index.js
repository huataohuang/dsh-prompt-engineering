/**
 * 提示词工程 · 宿主半（Host）
 *
 * 职责：在 DSH 宿主的「app 归属路由」上开一个接口，用当前会话（或默认）模型
 * 把用户草稿改写为一条更专业、更可执行的提示词。
 *
 * 为什么走 ctx.connection.fetch.register 而不是 Remote/自建 HTTP 服务：
 *   - Connection 的精确路由同时被 Web 外壳（ctx.webServer 上的 /api 前缀）与
 *     桌面外壳（dsh-app://app/ 把 app 归属路径转发给宿主）承载，因此同一份代码
 *     在浏览器与 Electron 里都成立，不需要固定端口、共享密钥或 CORS 白名单；
 *   - 只有「物主 Peer」能到达精确路由，其余主体由 Connection 统一回 403，
 *     鉴权与 Host/Origin 校验由连接层负责，插件不重复实现。
 *   客户端半用 document.baseURI 解析相对路径访问本路由（见
 *   .agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md）。
 *
 * 该调用只走 ctx.llm.stream，不进入任何会话日志；返回的改写稿也不会自动发送，
 * 必须由用户在预览面板中点「采用并替换」后才写回输入框。
 */

/** 浏览器用 document.baseURI 解析的相对路径，见下方 ROUTE_PATH 的去斜杠形式。 */
const ROUTE_PATH = '/api/prompt-engineering/optimize'

/** 插件名（Loader 行 id 由 cordis.patch.yml 指定，这里供日志与自省使用）。 */
export const name = 'dsh-prompt-engineering'

/**
 * connection：注册 app 归属路由；llm：调用模型。
 * 两者都在 Web/桌面组合里默认存在，缺失时应当启动即失败而不是静默失效。
 */
export const inject = ['connection', 'llm']

/** 允许的改写模式；未知值一律回落到 auto。 */
const MODES = new Set(['auto', 'structure', 'concise', 'expert', 'rigorous'])

/** 输入上限（字符）：超过则拒绝，避免把整篇文档塞进一次改写。 */
const MAX_DRAFT = 12000
const MAX_EXTRA = 2000
const MAX_CONTEXT = 4000

/** 输出上限：中文提示词约 1200 字，英文约 900 词。 */
const MAX_OUTPUT_TOKENS = 2048

/** 与「专业改写」匹配的低温度：稳定、少发挥。 */
const TEMPERATURE = 0.25

/** 单次改写的最长等待时间；与调用方断开信号一起生效。 */
const TIMEOUT_MS = 60000

const BASE_RULES_ZH = [
  '你是资深提示词工程师。唯一任务：把用户草稿改写成一条更专业、更可执行、更不容易被大模型误解的提示词。',
  '',
  '第一步：判断场景',
  '先判断草稿属于什么场景（写代码、写文书、做分析、做创意、做翻译、知识查询、做计划、生活事务等），按该场景最有效的方式组织；不要把非技术需求硬塞进「写代码」的框子，也不要给技术需求套用文学化表达。',
  '',
  '改写准则：',
  '1. 忠于原意：不改变用户的目标，不新增用户没要求的任务，不臆造事实、数据或引用。',
  '2. 保留硬约束：文件名、路径、命令、代码、版本号、数字、日期、专有名词、报错原文、接口名一律原样保留，不得翻译或改写。',
  '3. 只扩写、不回答：把需求或问题本身写得更清楚，绝不替用户解决问题、不给出答案、不输出解决方案。',
  '4. 不臆造上下文：用户没提供的信息用【待补充：…】占位，不要编造。',
  '5. 面向模型组织：用第二人称祈使句；按需要给出「目标 / 背景 / 约束 / 输出格式」，没有信息量的空标签不要写。',
  '6. 明确交付形态：写清楚要什么形态的结果（可直接运行的代码、JSON 字段、Markdown 表格、分点清单）以及长度与详略程度。',
  '7. 消歧：遇到多种合理解释时选最合理的一种，并在提示词中写明该假设。',
  '8. 不擅自加料：不主动添加用户没提到的技术选型、教程/指南要求、代码片段要求或扩展任务。',
  '9. 语言（最高优先级）：与用户草稿保持同一种语言；草稿混用语言时保持自然混用。语言规则只用于本次改写，绝不允许把「用户输入是中文」「需用中文回答」这类语言说明写进结果。',
  '10. 精炼：不超过原文的 2 倍且最多 800 字；原文已经足够专业时只做最小必要的完善。不堆砌同义修饰，不复述本规则。',
  '',
  '输出要求（严格遵守）：',
  '- 只输出改写后的提示词正文，不要任何解释、前言、后记、致歉、备注或「以下是…」之类的话。',
  '- 不要用代码围栏把整条提示词包起来；提示词内部确有代码时才使用代码块。',
  '- 不要输出「提示词：」这样的标题前缀，也不要输出语言分析或其它元信息。',
  '',
  '反例（不要这样）：',
  '用户输入「帮我写个周报」→ 错误输出「用户输入是中文，需用中文回答。帮我写个周报」',
  '正例：',
  '「请根据我提供的工作记录写一份中文周报：按项目分节，每节写明本周进展、遇到的问题与下周计划；语气简洁专业，总长控制在 600 字以内，用 Markdown 输出。」',
].join('\n')

const BASE_RULES_EN = [
  'You are a senior prompt engineer. Your only job: rewrite the user draft into a more professional, more executable prompt that a large model is unlikely to misread.',
  '',
  'Step 1 - detect the scenario:',
  'Decide what kind of request this is (coding, writing, analysis, creative work, translation, knowledge lookup, planning, everyday tasks, ...) and organise it the way that scenario works best. Never force a non-technical request into a coding frame, and never dress a technical request in literary language.',
  '',
  'Rules:',
  '1. Stay faithful: never change the goal, never add unrequested tasks, never invent facts, data or citations.',
  '2. Preserve hard constraints verbatim: file names, paths, commands, code, versions, numbers, dates, proper nouns, raw error text and API names must not be translated or reworded.',
  '3. Expand, never answer: make the request itself clearer. Do not solve the problem, do not give the answer, do not output a solution.',
  '4. Do not invent context: for information the user did not give, use a placeholder instead of making it up.',
  '5. Structure for the model: use second-person imperatives. Include Goal / Context / Constraints / Output format as needed; never emit labels that carry no information.',
  '6. Fix the deliverable: state the shape of the answer (runnable code, JSON fields, a Markdown table, a bullet list) and how long or detailed it should be.',
  '7. Disambiguate: when several readings are plausible, pick the most reasonable one and state that assumption inside the prompt.',
  '8. Do not add extras: never introduce technologies, guides/how-tos, code-snippet requests or extra tasks the user did not mention.',
  '9. Language (highest priority): keep the language of the draft; if the draft mixes languages, keep a natural matching mix. Language rules govern your rewriting only - never write labels such as "User input is in Chinese" or "Respond in Chinese" into the result.',
  '10. Be concise: at most 2x the original and at most 800 characters; when the draft is already professional, make the smallest necessary improvement. Do not stack synonyms and do not restate these rules.',
  '',
  'Output contract (strict):',
  '- Output only the rewritten prompt body. No explanation, preface, afterword, apology, note or "here is..." sentence.',
  '- Do not wrap the whole prompt in a code fence; use code blocks only for code inside the prompt.',
  '- Do not prefix the answer with a "Prompt:" heading, and do not output language analysis or other meta information.',
  '',
  'Counter-example (do not do this):',
  'Input "write me a weekly report" -> wrong output "User input is English, respond in English. write me a weekly report"',
  'Correct:',
  '"Write a weekly report in English from the work log I provide: one section per project, each covering this week\'s progress, blockers and next week\'s plan. Keep it concise and professional, under 600 words, in Markdown."',
].join('\n')

const MODE_RULES_ZH = {
  auto: '模式：智能优化。草稿是一句模糊需求时，补齐目标、背景、约束与输出格式；草稿已较完整时，只做精炼与消歧，不要膨胀。',
  structure: '模式：结构化。必须分段并保留短标题，顺序为：目标、背景、约束、步骤、输出格式；每段只写有信息量的内容，缺失信息用【待补充：…】标注。',
  concise: '模式：精简。删掉礼貌性铺垫、重复表述与空泛限定词，合并同义要求；总长度不得超过原文，且必须保留全部硬约束。',
  expert: '模式：专家视角。在开头设定最贴合该任务的专业角色与经验年限，并补充该领域最容易被忽略的检查点、常见坑与质量标准。',
  rigorous: '模式：严谨契约。写成可验收的任务契约：输入、输出契约（字段或格式）、边界与例外、失败时的行为，最后给出验收标准清单。',
}

const MODE_RULES_EN = {
  auto: 'Mode: smart. For a vague one-liner, fill in goal, context, constraints and output format; for an already complete draft, only tighten and disambiguate — do not inflate it.',
  structure: 'Mode: structured. Use short sections in this order: Goal, Context, Constraints, Steps, Output format. Keep only informative content and mark missing information with 【to fill in: …】.',
  concise: 'Mode: concise. Remove pleasantries, repetition and vague qualifiers; merge equivalent requirements. Never exceed the original length, and keep every hard constraint.',
  expert: 'Mode: expert. Open with the professional role and years of experience best suited to the task, then add the checkpoints, pitfalls and quality bar that this domain most often misses.',
  rigorous: 'Mode: rigorous contract. Write an acceptance-ready task contract: inputs, output contract (fields or format), boundaries and exceptions, behaviour on failure, and a final acceptance checklist.',
}

/** 语言键归一化：只区分中文与英文，其余按英文处理。 */
function normalizeLocale(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 拼装本次改写的系统提示词。 */
function systemPrompt(locale, mode) {
  if (locale === 'zh') {
    return BASE_RULES_ZH + '\n\n' + (MODE_RULES_ZH[mode] || MODE_RULES_ZH.auto)
  }
  return BASE_RULES_EN + '\n\n' + (MODE_RULES_EN[mode] || MODE_RULES_EN.auto)
}

/** 拼装用户消息：草稿 + 可选额外要求 + 可选补充背景。 */
function userMessage(locale, draft, extra, context) {
  const zh = locale === 'zh'
  const lines = [
    zh ? '【用户草稿】' : '[User draft]',
    draft,
  ]
  if (extra.length > 0) {
    lines.push('', zh ? '【额外要求】' : '[Extra requirements]', extra)
  }
  if (context.length > 0) {
    lines.push('', zh ? '【补充背景】' : '[Additional context]', context)
  }
  lines.push('', zh ? '请按规则输出改写后的提示词正文。' : 'Output only the rewritten prompt body, following the rules.')
  return lines.join('\n')
}

/** JSON 响应；错误也用 HTTP 200 + ok:false，调用方只需判 ok 分支。 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** 失败信封，与 file-upload 等 app 归属路由的 { ok:false, error } 形状保持一致。 */
function fail(code, message, details = {}) {
  return json({ ok: false, error: { code, message, details } })
}

/** 去掉模型可能加在整条结果外面的代码围栏与「提示词：」前缀。 */
function normalizeOutput(text) {
  let out = text.trim()
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(out)
  if (fenced !== null) out = fenced[1].trim()
  out = out.replace(/^(?:优化后(?:的)?提示词|改写后(?:的)?提示词|提示词|Prompt)\s*[:：]\s*/, '')
  return out.trim()
}

/** 从各种服务返回值里抽出 id 列表（字符串或 {id|model|name}）。 */
function toIdList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item : (item && (item.id || item.model || item.name)) || ''))
    .filter((id) => typeof id === 'string' && id.length > 0)
}

/**
 * 选择本次改写使用的模型，优先级：
 *   1. 调用方显式给出的 provider/model；
 *   2. 当前会话已路由的模型（requestHeader().config）；
 *   3. 当前会话创建时的模型（agent.options）；
 *   4. 宿主默认模型（agentDefaultModel.currentSelection()）；
 *   5. 第一个可用提供方的第一个模型。
 * 任何一步失败都不抛错，交给下一级兜底。
 */
async function resolveTarget(ctx, request) {
  if (typeof request.provider === 'string' && request.provider.length > 0
    && typeof request.model === 'string' && request.model.length > 0) {
    return { provider: request.provider, model: request.model }
  }
  if (typeof request.sessionId === 'string' && request.sessionId.length > 0) {
    try {
      const agents = ctx.get('agents')
      const agent = agents && typeof agents.get === 'function' ? agents.get(request.sessionId) : undefined
      const header = agent && agent.session && typeof agent.session.requestHeader === 'function'
        ? agent.session.requestHeader()
        : undefined
      const routed = header && header.config
      if (routed && routed.provider && routed.model) return { provider: routed.provider, model: routed.model }
      const options = agent && agent.options
      if (options && options.provider && options.model) return { provider: options.provider, model: options.model }
    } catch { /* 会话可能已释放：继续走默认模型 */ }
  }
  try {
    const defaultModel = ctx.get('agentDefaultModel')
    if (defaultModel && typeof defaultModel.currentSelection === 'function') {
      const selection = defaultModel.currentSelection()
      if (selection && selection.provider && selection.model) {
        return { provider: selection.provider, model: selection.model }
      }
    }
  } catch { /* 没有该服务：继续兜底 */ }
  try {
    const providers = toIdList(await ctx.llm.listProviders())
    for (const provider of providers) {
      const models = toIdList(await ctx.llm.listModels(provider))
      if (models.length > 0) return { provider, model: models[0] }
    }
  } catch { /* 列举失败：如实报 no-model */ }
  return null
}

/** 消费一次流式生成，返回拼接后的文本与用量。 */
async function generate(ctx, options) {
  let text = ''
  let finish
  let usage
  for await (const chunk of ctx.llm.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') finish = chunk.reason
    else if (chunk.type === 'usage') usage = chunk.usage
  }
  if (finish !== undefined && finish.kind !== 'stop') {
    const failure = finish.failure || {}
    const code = failure.code || finish.kind
    const message = failure.message || finish.kind
    throw new Error(code + ': ' + message)
  }
  return { text, usage }
}

/** 处理一次 /api/prompt-engineering/optimize 请求。 */
async function handleOptimize(ctx, request) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: { code: 'prompt-engineering/bad-request', message: 'only POST is supported', details: {} } }, 405)
  }
  let body
  try {
    body = await request.json()
  } catch {
    return fail('prompt-engineering/bad-request', '请求体必须是 JSON')
  }
  if (body === null || typeof body !== 'object') {
    return fail('prompt-engineering/bad-request', '请求体必须是 JSON 对象')
  }

  const rawDraft = typeof body.text === 'string' ? body.text : ''
  const draft = rawDraft.trim()
  if (draft.length === 0) {
    return fail('prompt-engineering/empty-draft', '草稿为空，先在输入框写下你的需求')
  }
  if (rawDraft.length > MAX_DRAFT) {
    return fail('prompt-engineering/too-long', '草稿超过 ' + MAX_DRAFT + ' 字符，请精简后再试')
  }
  const extra = typeof body.extra === 'string' ? body.extra.trim().slice(0, MAX_EXTRA) : ''
  const context = typeof body.context === 'string' ? body.context.trim().slice(0, MAX_CONTEXT) : ''
  const locale = normalizeLocale(body.locale)
  const mode = MODES.has(body.mode) ? body.mode : 'auto'

  const target = await resolveTarget(ctx, body)
  if (target === null) {
    return fail('prompt-engineering/no-model', '当前没有可用的模型，请先在输入框选择模型')
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)])
  const options = {
    provider: target.provider,
    model: target.model,
    system: systemPrompt(locale, mode),
    messages: [{ role: 'user', content: [{ type: 'text', text: userMessage(locale, draft, extra, context) }] }],
    temperature: TEMPERATURE,
    maxTokens: MAX_OUTPUT_TOKENS,
    purpose: 'prompt-engineering',
    signal,
  }
  if (typeof body.sessionId === 'string' && body.sessionId.length > 0) options.sessionId = body.sessionId

  let result
  try {
    result = await generate(ctx, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (signal.aborted) {
      return fail('prompt-engineering/cancelled', request.signal.aborted ? '已取消' : '模型调用超时')
    }
    return fail('prompt-engineering/model-failed', '模型调用失败：' + message)
  }

  const text = normalizeOutput(result.text)
  if (text.length === 0) {
    return fail('prompt-engineering/empty-output', '模型没有返回内容，请重试或更换模型')
  }
  return json({
    ok: true,
    value: {
      text,
      provider: target.provider,
      model: target.model,
      mode,
      usage: result.usage === undefined ? null : result.usage,
    },
  })
}

/**
 * 装载插件：注册 app 归属的改写路由。
 * @param ctx - 宿主上下文（inject 已保证 connection 与 llm 就绪）。
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleOptimize(ctx, request),
    }),
    'prompt-engineering: optimize route',
  )
}

/** 供单元测试直接驱动请求处理器（不经过 Loader）。 */
export const __test = { handleOptimize, normalizeOutput, resolveTarget, systemPrompt, ROUTE_PATH }
