# 提示词工程（dsh-prompt-engineering）

发送区一个星芒图标：**点一下**就把输入框里的草稿改写成更专业、更可执行、更不容易被模型误解的提示词，
直接替换回输入框——不弹面板、不要二次确认。

## 界面与交互

```
 ┌────────────────────────────────────────────────────────────┐
 │  / 写点什么……                                              │
 │                                                            │
 │  [＋] [工作区内修改 ▾]             [✦] [模型 ▾] [🎤] [发送] │
 └────────────────────────────────────────────────────────────┘
                                       ↑ 优化提示词（就这一个图标）
```

- **像原生控件**：28px 纯图标、无边框、悬停才显底色，与旁边的「＋」「模型」「麦克风」同一套尺寸与主题变量；
  位置在模型选择器左侧、发送按钮之前（与 WorkBuddy 的优化入口同款位置）。
- **一点即优化**：读取草稿 → 宿主模型改写 → 结果直接写回输入框。写回后可继续手改，
  **⌘Z / Ctrl+Z 可撤销**（走 DSH 的草稿 API，进入撤销历史）。
- **空输入不显示图标**（与 WorkBuddy 同款）：输入框为空时这个星芒整个不渲染，你一开始打字它才出现，草稿被清空又会消失。
- **状态都在图标上**：优化中星芒转圈；成功变对勾；输入框发送中 / 草稿被改 / 调用失败变感叹号，
  原因写在原生悬停提示里，绝不打断输入。
- **三条安全线**：草稿为空不发请求；输入框正在发送或执行中不写回；**优化期间你改了草稿就放弃覆盖**
  （只提示，保留你的新内容）。
- **按会话隔离**：状态存在会话上，同一会话下多个 composer 互不串台。
- 宿主接口仍支持 5 种改写方式（智能 / 结构化 / 精简 / 专家 / 严谨契约）与「额外要求 / 补充背景」字段，
  当前 UI 固定用 `auto`；想换成别的模式只需改客户端请求里的 `mode`，宿主无需改动。

## 安装

### 方式一：profile 安装器（推荐；不需要 pnpm，三平台一致）

```bash
node scripts/install-profile.mjs --profile desktop              # 桌面版 Donnie
node scripts/install-profile.mjs --profile web                  # 源码方式跑的 dsh web
node scripts/install-profile.mjs --profile desktop --uninstall  # 卸载（原样还原）
```

只做三处最小改动：profile 清单的 `dependencies` 与 `dsh.profile.bundles`、`pnpm-lock.yaml` 的 importer
记录、`node_modules` 里的软链（Windows 用 junction，免管理员权限）。**不运行 pnpm**，所以不会重装或裁剪
profile 里已有的依赖；安装前把 profile 清单备份到 `dist/_profile-backup/`。装完**完全退出并重新打开应用**。

### 方式二：`dsh plugin` 链接源码目录（开发调试，改完即生效）

前提是 PATH 上有 `pnpm`（DSH 运行时只带 `pnpm.mjs`）。报 `pnpm was not found` 时先做垫片：

```bash
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$(command -v node)" /path/to/pnpm.mjs > ~/.devbin/pnpm
chmod +x ~/.devbin/pnpm
PATH=~/.devbin:$PATH dsh plugin --profile web add "/绝对路径/提示词工程"
```

### 方式三：安装 tarball（分发/内测）

```bash
node scripts/pack.mjs
dsh plugin --profile web add ./dist/dsh-prompt-engineering-0.2.2.tgz
```

### 方式四：从 GitHub 直接安装（已公开，不需要 npm 账号）

```bash
dsh plugin --profile desktop add git+https://github.com/huataohuang/dsh-prompt-engineering.git#<40位commit>
```

`<40位commit>` 必须是 **40 位小写十六进制** commit，写分支名会被 DSH 校验器拒收。取当前最新：

```bash
git ls-remote https://github.com/huataohuang/dsh-prompt-engineering HEAD
```

本包是纯 JS、没有构建脚本，git 安装**不需要** pnpm 的 `allowBuilds` 许可。

### 方式五：通过「发现」标签页安装（索引源分发）

```bash
node scripts/make-index.mjs --version 0.2.2 --channel git \
  --git-url https://github.com/huataohuang/dsh-prompt-engineering \
  --git-commit <40位commit> --out 发布/index.json
```

上传 `发布/index.json` 与 `发布/icon.svg` 到**同一目录**的静态托管，在 **插件 → 发现 → 索引源**
粘贴索引的**最终 URL**。DSH 只接受 http(s)、无凭据、无 `#` 片段、**不重定向**的 URL；
短链与会 302 的 CDN 不可用。

### 发布到 npm

```bash
npm publish --access public
```

包名 `dsh-prompt-engineering` 是未占用命名空间；改用组织 scope 时同步改 `package.json` 的 `name` 与
`cordis.patch.yml` 的插件行即可（索引脚本从 package.json 读 name）。

## 跨平台（Windows / macOS / Linux）

运行时两半都没有平台依赖：不 import 任何 `node:` 模块、不读 `process.platform`/`process.env`、
不拼平台路径、不调 shell。与宿主的通道是 `document.baseURI` 上的 `fetch`，Web 外壳与桌面外壳
（`dsh-app://app/` 转发 app 归属路径）同一套代码。`package.json` 不声明 `os`/`cpu`；`.gitattributes` 固定 LF。

脚本同样跨平台：`pack.mjs` 依次尝试 DSH 自带 pnpm → `pnpm.cmd` → `npm.cmd`，并用自带的纯 Node
tar 读取器校验压缩包（不调用平台 `tar`、不依赖 shell 展开 glob）；`install-profile.mjs` 只用 `node:fs` 与
`node:path`，Windows 上建 junction。

**验证情况**：macOS 上跑通全部 34 项测试与真实安装；Windows 未实机执行，
`tests/portability.spec.mjs` 作为守卫会阻止后续引入平台相关依赖。首次在 Windows 发布前建议跑一遍测试命令。

## 兼容性

`package.json` 声明 `engines.dsh` 为 `>=0.2.0 <0.3.0`，与当前 DSH 0.2.2-alpha.3 / Donnie v0.8.x 对齐
（DSH 用 `includePrerelease` 判定，预发布版本可通过）。升级 DSH 后同步调整该范围再发新版本。

## 失败码

接口统一返回 HTTP 200 + `{ ok, value | error }`，图标按 `error.message` 提示：

| code | 含义 |
|---|---|
| `prompt-engineering/bad-request` | 请求体不是 JSON 对象 |
| `prompt-engineering/empty-draft` | 草稿为空 |
| `prompt-engineering/too-long` | 草稿超过 12000 字符 |
| `prompt-engineering/no-model` | 找不到可用模型（先选会话模型或配置默认模型） |
| `prompt-engineering/model-failed` | 模型调用失败（限流、超时、适配器报错等） |
| `prompt-engineering/cancelled` | 用户取消或超过 60s 超时 |
| `prompt-engineering/empty-output` | 模型返回空内容 |
| `prompt-engineering/transport` | 客户端侧：网络或外壳未接通 |

## 测试

```bash
# 显式列出文件：CMD/PowerShell 不展开 glob，三平台写法一致
node --test tests/host.spec.mjs tests/client.spec.mjs tests/index.spec.mjs tests/pack.spec.mjs tests/portability.spec.mjs
```

- `tests/host.spec.mjs`（14 项）：直接驱动路由处理器，覆盖路径注册、各失败码、模型选择优先级、提示词组装与输出净化。
- `tests/client.spec.mjs`（10 项）：迷你 React 渲染真实组件，覆盖「一点即优化」全链路与全部拒绝分支
  （空草稿、发送中、草稿被改、模型报错、空结果、多会话隔离、卸载清理）。
- `tests/index.spec.mjs`（3 项）：用 DSH 自带的 `parseMarketIndex` 校验生成的索引，并覆盖非法输入被拒。
- `tests/pack.spec.mjs`（2 项）：真实打包，用纯 Node 的 tar 读取器校验 tarball 内容。
- `tests/portability.spec.mjs`（5 项）：跨平台守卫。

## 架构一句话

浏览器半用 `document.baseURI` 相对路径请求 `/api/prompt-engineering/optimize`；宿主半用
`ctx.connection.fetch.register` 注册这条 app 归属路由，用 `ctx.llm.stream` 调模型。这条路同时被
Web 外壳（`/api` 前缀）与桌面外壳（`dsh-app://app/` 转发 app 归属路径）承载，因此不需要自建 HTTP 服务、
固定端口、共享密钥或 CORS 白名单；鉴权与 Host/Origin 校验由 Connection 负责。细节见 [docs/DETAIL.md](docs/DETAIL.md)。

## 隐私

- 只有你点下那个图标时，输入框里的草稿才会随请求发给你当前选择或默认的模型提供方。
- 宿主半不写文件、不写会话日志；按钮状态只存在于当前页面内存（按会话）。
- 接口是 app 归属路由，仅本机同源页面可用；不会代替你发送任何消息。
