# 把「提示词工程」发布到互联网上的 DSH 插件市场

## 0. 先看清机制（决定你要做什么）

- DSH **没有**「提交给官方商店」的入口：官方索引只收录 npm 上 @deepseek-ai 的包，第三方进不去。
- 所谓「插件市场」= **任意一个 https 静态地址上的 format 1 JSON 索引**；用户在 插件 → 发现 → 索引源 里粘贴它的最终 URL。
- 索引的每个版本必须指向一个安装来源：npm（name@version）或 git（git+url#40位小写commit）。
- 所以「上架」只有三步：**① 发安装源 → ② 生成并托管索引 → ③ 把索引 URL 给用户 / 让索引站收录**。

## 阶段 1：准备物料（在本机，已具备脚本）

1. 改版本号：编辑 package.json 的 "version"
2. 打包并记校验和：

        cd <本仓库目录>
        node scripts/pack.mjs --dest dist

3. 生成索引（当前走 git 通道；npm 发布之后再改回 npm 通道）：

        node scripts/make-index.mjs --version 0.2.2 --channel git \
          --git-url https://github.com/huataohuang/dsh-prompt-engineering \
          --git-commit <40位小写commit> \
          --timestamp $(date +%s) --out docs/market/index.json

4. 校验索引（用 DSH 官方 parseMarketIndex）：

        node --test tests/index.spec.mjs

**验证**：dist/ 下有 dsh-prompt-engineering-0.2.2.tgz 与 index.json；上面测试全绿。

## 阶段 2：把包发到安装源（二选一）

### A. npm（标准做法，推荐）

        npm login
        npm publish --access public

**验证**：npm view dsh-prompt-engineering version 打印 0.2.2；网页 https://www.npmjs.com/package/dsh-prompt-engineering 能打开。
**注意**：发之前先确认包名可用（feiwell 的 README 就提到 dsh-enhance-prompt 已被他人占用）；被占就改用 scope，例如 @你的名字/dsh-prompt-engineering。

### B. git 仓库（不需要 npm 账号）

        # 把本目录推到你自己的仓库
        git rev-parse HEAD      # 记下 40 位小写 commit

用户安装方式：

        dsh plugin --profile desktop add git+https://github.com/<你>/dsh-prompt-engineering.git#<40位commit>

**验证**：自己先用上面命令装一次、重启桌面版，图标出现。
**优点**：本包是纯 JS、没有构建脚本，git 安装**不需要** pnpm 的 allowBuilds 许可（有构建步骤的包才需要）。

## 阶段 3：托管索引（这一步做完才算「上架」）

1. 索引与图标已随仓库提交在 docs/market/。GitHub Pages 的源设为 **main 分支的 /docs 目录**后，最终直链即
   https://huataohuang.github.io/dsh-prompt-engineering/market/index.json
   （也可改用对象存储或自有服务器，只要把 index.json 与 icon.svg 放在同一目录）。
2. 必须是**最终直链**：http(s)、无用户名密码、无 # 片段、**不经 302 跳转**（短链与带跳转的 CDN 会被 DSH 拒收）。
3. 索引条目的 icon 写的是 icon.svg，相对索引地址解析，所以图标要和索引同目录。

**验证**：

        curl -sI https://<你的域名>/dsh-plugins/index.json | head -3

返回 200 且没有 Location 跳转，即为合格；浏览器打开应看到 JSON 原文。

## 阶段 4：让别人找到它（四种渠道，按投入排序）

1. **最小可行**：把索引 URL 直接发给用户 → 他们在 插件 → 发现 → 索引源 粘贴 → 安装。
2. **并入你已有的插件市场**：本仓库上级目录的「插件市场」项目现在只收官方包，把本插件的条目并进它的 index.json，你现有订阅者就能直接看到（同一份 format 1 格式，直接追加 plugins[] 一项）。
3. **提交第三方 DSH 索引站**：我在你的会话缓存里见到过两个域名——awesome-dsh-plugin.com、dshopen.org——但**没有联网核实**它们是否在线、是否接受投稿。【待核实：需查各站说明或联系维护者】
4. **提 PR 到任何你信任的 DSH 索引仓库**（索引就是一个 JSON 文件，审阅成本很低）。

## 阶段 5：维护与更新

- 每次发版：改 version → pack → make-index（**publishTimestamp 用真实发布时间**）→ 上传索引 → npm publish（或 git tag）。
- 索引里 versions 可以累积多个版本，DSH 按 SemVer 取匹配的最新版。
- DSH 升级后同步 package.json 的 engines.dsh（当前为 >=0.2.0 <0.3.0），否则新版本会被拒绝装载。

## 常见坑（都踩过或在校验器源码里确认过）

- 索引 URL 用了短链或会 302 的 CDN → DSH 拒收，必须给最终地址。
- git 源的 commit 必须是 **40 位小写十六进制**，写分支名会被校验器拒绝。
- publishTimestamp 必须是 Unix 秒整数，且是真实发布时间。
- npm 包名可能被占用；发之前先查。
- **手动改 profile 的 dsh.profile.bundles 会被应用归一化成「未启用」**：装完必须在 插件 → 已安装插件 里把开关打开，否则界面不出现（我们实际踩到过）。
