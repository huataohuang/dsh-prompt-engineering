# 维护者细节（提示词工程）

面向继续改这个插件的人：挂载点、协议、模型选择、提示词设计、发布流水线，以及明确不做的事。

## 目录

```
提示词工程/
├── package.json           # name / exports / dsh.bundle.patch / dsh.client / engines.dsh
├── cordis.patch.yml       # 装载层：插入宿主半（客户端半由 dsh.client 声明自动进入模块图）
├── index.js               # 宿主半：路由 + 模型调用（无构建，纯 ESM）
├── client.js              # 浏览器半：__ModuleLoader__ 懒 CJS bundle（无可选 require）
├── icon.svg
├── scripts/install-profile.mjs  # 不依赖 pnpm 的 profile 安装器（可 --uninstall 原样回滚）
├── scripts/pack.mjs             # 打包 tarball + 内容校验 + sha256
├── scripts/make-index.mjs       # 生成 format 1 插件索引
├── scripts/lib/tar.mjs          # 纯 Node tar 读取器
├── tests/                       # host / client / index / pack / portability
└── docs/DETAIL.md
```

没有任何构建步骤：两半都是可直接装载的 JS。这是刻意的——第三方 bundle 一旦引入 tsdown/typert codegen，
就必须自己维护一套与 DSH 版本同步的构建链；纯 JS 让升级成本只剩 `engines.dsh` 一行。

## 宿主半

- 只注册一条 **Connection 精确 Fetch 路由**：`POST /api/prompt-engineering/optimize`。
  `ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch })` 返回异步 disposer，
  按 DSH 惯例交给 `ctx.effect(fn, label)`。
- 为什么不用 Typert Remote：客户端 `$mount` 需要 **strict codec** 的生成物，而 codegen 要求包位于含
  `tsconfig.host.json` 与 `packages/` 的 workspace 根下——对仓外插件是硬阻塞。裸 `ctx.webServer.register`
  也不合适：它没有内置鉴权，且桌面外壳不经过它。
- 模型选择优先级（任一步失败都安静下沉）：请求体 `provider`+`model` → 会话已路由模型
  （`agent.session.requestHeader().config`）→ 会话创建时的 `agent.options` → `ctx.agentDefaultModel.currentSelection()`
  → `listProviders()/listModels()` 的第一个。
- 调用形态：`ctx.llm.stream({ provider, model, system, messages, temperature: 0.25, maxTokens: 2048, purpose: 'prompt-engineering', sessionId, signal })`，
  自行拼接 `text-delta`、读取 `finish`；`signal` = `AbortSignal.any([request.signal, AbortSignal.timeout(60000)])`。
- 该调用**不进入会话日志**，也不代替用户发送任何消息。`export const __test` 暴露内部函数供单测直接驱动。

## 浏览器半

- **只注册一个槽位**：`conversation.input.right`（list / session，当前无占用者），
  `id: 'prompt-engineering'`、`order: 60`。它渲染在 `.trailing > .standardControls`（模型选择器左侧、
  发送按钮之前）——正是 WorkBuddy 放优化入口的位置。
  - 不用 `conversation.input.activity`：那是 single 槽位且已被语音输入占用。
  - 不再注册 `conversation.input.overlay`：改「一点即优化」后不需要浮层面板。
- **外观**：28px 纯图标、无边框、透明底；hover/active/状态色/`@keyframes` 旋转写在插件自带的样式表里
  （`apply` 时注入 `<style id="dsh-prompt-engineering-style">`，卸载时移除），其余颜色一律走
  `--dsw-alias-*` 主题变量，自动适配明暗主题。
- **样式不能用内联**：`:hover`、`:focus-visible` 与旋转动画都需要样式表，所以有那一个 style 元素；
  用 id 去重，HMR 重复求值不会堆叠。
- **状态**：`entries` 以会话 id 为键，保存 `{ busy, tone, hint, latestDraft, latestPhase }`；订阅用
  `useState` + `useEffect` 手写（不依赖 React 18 的 `useSyncExternalStore`，兼容面更大）。
- **异步必须读最新草稿**：渲染期的 `draft` 快照会过期，所以每次渲染把最新值写进 `entry.latestDraft` /
  `entry.latestPhase`，回调里读 entry 上的值再决定是否写回。
- **写回草稿只走 `inputActions.setDraft(text)`**，并先判 `useInput(s => s.phase) === 'plain'`：该 API 是整条替换且没有
  返回值，发送事务进行中写进去会和 commit 互相覆盖。它进入撤销历史，所以用户 ⌘Z 可以退回。
  没有用 `insertText(text, span)`（span CAS）：语义是「插入」而不是「替换整条草稿」。
- `onMouseDown` 一律 `preventDefault()`，避免点图标时编辑器丢焦点；`aria-label` + 原生 `title` 承担
  全部可读反馈（没有面板可以承载错误文案）。
- 通信：`new URL('api/prompt-engineering/optimize', document.baseURI)` + `fetch(..., { credentials: 'same-origin' })`。
  **必须保持文档相对形式**（DSH 挂载点规则），写死 `/api/...` 在被前缀代理挂载时会失效。

## 提示词设计

系统提示词按语言（zh / en）与模式（auto / structure / concise / expert / rigorous）拼装，八条通用准则的核心是
「**不改变用户意图、不臆造、硬约束原样保留、缺信息用占位符、明确交付形态**」，输出契约要求模型只给改写正文。
`normalizeOutput` 再兜一层：剥掉整条结果的代码围栏与「优化后的提示词：」之类前缀。
改这些准则等于改产品行为（「更专业」的定义），请同步更新 `tests/host.spec.mjs` 里断言模式规则与语言分支的用例。

## 发布流水线

```bash
node --test tests/host.spec.mjs tests/client.spec.mjs tests/index.spec.mjs tests/pack.spec.mjs tests/portability.spec.mjs
node scripts/make-index.mjs --version X.Y.Z --channel npm --base-url <最终URL>
node scripts/pack.mjs
npm publish --access public
# 把 dist/index.json 上传到静态托管（npm 通道建议用真实发布时间戳重跑 make-index）
```

发布前检查清单：版本与 `engines.dsh` 对齐当前 DSH；tarball 含全部运行时文件（pack.mjs 会强制校验）；
`cordis.patch.yml` 的插件名与 `package.json` 的 `name` 一致；索引时间戳真实；git 通道钉 40 位小写 commit。

## 明确不做的事

- 不弹预览面板、不做二次确认、不代替用户发送消息、不把改写结果写进会话历史；
- 不落盘、不缓存草稿与结果；不引入自建 HTTP 服务、端口或共享密钥；
- 不接管 `conversation.input.activity` 等已被占用的 single 槽位；
- 不依赖 DSH 私有模块（只用 `ctx.connection` / `ctx.llm` / `ctx.slots` / `ctx.get()` 这些稳定面）。

## 后续可做

- 长按 / 右键切换改写方式（结构化、精简、专家、严谨契约），把 5 种模式重新暴露到 UI；
- 选中片段只优化选区（`captureInsertion` 的 span CAS）；
- 把会话最近几轮作为上下文交给改写（宿主半已有 sessionId，可从会话服务取）；
- 失败时给一次「重试」，而不是只把原因写进 title。
