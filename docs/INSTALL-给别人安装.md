# 把「提示词工程」装到别人的 Donnie（Windows / macOS 桌面版）

> 这份文档可以直接整份转发给执行安装的人。
> 全程不需要联网、不需要 Node/npm、不需要管理员权限；只需要文件管理器、一个文本编辑器、一条命令。

## 0. 一句话结论

这个插件是 Donnie/DSH 的 **profile bundle**（不是「丢进某个插件文件夹就生效」的插件），
所以安装方式 = **把包放到目标机器任意位置 + 把它登记进 Donnie 的 desktop profile + 建立一个链接**。

判断依据：插件的 package.json 里声明了 dsh.bundle.patch（提供配置装载层）与 dsh.client（提供浏览器半）；
DSH 只从 profile 的 dsh.profile.bundles 列表和 profile 目录下的 node_modules 解析 bundle，没有别的入口。

| 项目 | 值 |
|---|---|
| 插件名 | dsh-prompt-engineering |
| 版本 | 0.2.2 |
| profile 名 | desktop（Donnie 桌面版固定用这个） |
| 宿主兼容范围 | engines.dsh: >=0.2.0 <0.3.0（即 Donnie 内部的 DSH 必须是 0.2.x） |
| 需要拷给对方的文件 | package.json、index.js、client.js、cordis.patch.yml、icon.svg（tests/、scripts/、dist/、docs/ 都不需要） |
| tar 包 sha256（可选核对） | ee47c243438c57dae78ae09849fd7cabc75a51f1f6eaafd9c1805e619f5c7fc1 |

装完的表现：输入框下方右侧、**模型选择器左边**多出一个星芒图标；点一下会把输入框里的草稿改写成更专业的提示词并替换回输入框。

---

## 第一部分：你在自己机器上准备（3 步）

### 1.1 确认插件文件完整

在**你的机器**上执行：

    cd <本仓库目录>          # 换成你机器上本仓库的路径，例如 ~/code/dsh-prompt-engineering
    ls -1 package.json index.js client.js cordis.patch.yml icon.svg

**验证**：这 5 个文件名全部打印出来，没有 No such file。

### 1.2 得到要传的目录

- **A（推荐，最省事）**：把整个目录「提示词工程」拷一份，重命名为 **dsh-prompt-engineering** 再传。
- **B（用 tar 包）**：把 dist/dsh-prompt-engineering-0.2.2.tgz 传给对方，让对方解压后把生成的 package 文件夹改名成 dsh-prompt-engineering。

**验证**：A 在自己机器上看一眼 dsh-prompt-engineering 里至少有 1.1 的 5 个文件；
B 先自己解压一次确认结构：

    tar -xzf dist/dsh-prompt-engineering-0.2.2.tgz && ls -1 package

> 目录名请用英文 dsh-prompt-engineering，不要保留中文名，JSON 路径在 Windows 上更不容易出问题。

### 1.3 把两样东西给对方

1. dsh-prompt-engineering 目录（或 dsh-prompt-engineering-0.2.2.tgz）；
2. 本文档第二部分以后的全部内容。

**验证**：对方回复「收到」，并核对目录里是那 5 个文件。

---

## 第二部分：对方在目标机器上执行

> 命令里的 <用户名> 一律替换成对方自己的系统用户名。
> 全程不需要管理员权限（最后建的链接 / junction 也不需要）。中途不要移动或删除插件目录，Donnie 通过链接指向它。

### macOS

**2.1 放置目录**

    mkdir -p ~/dsh-plugins
    # 把收到的 dsh-prompt-engineering 文件夹整个拖进 ~/dsh-plugins/
    ls -1 ~/dsh-plugins/dsh-prompt-engineering

验证：列出 package.json、index.js、client.js、cordis.patch.yml、icon.svg。

**2.2 完全退出 Donnie**

    osascript -e 'quit app "Donnie"'
    sleep 2
    pgrep -fl Donnie || echo "已完全退出"

验证：最后输出「已完全退出」。必须完全退出，否则改动会在退出时被覆盖。

**2.3 备份 profile 清单**

    cp ~/.dsh/profiles/desktop/package.json ~/.dsh/profiles/desktop/package.json.bak
    ls -l ~/.dsh/profiles/desktop/package.json.bak

验证：能看到 package.json.bak 这一行，大小与 package.json 相同。
若报 No such file or directory：说明这台机器还没启动过 Donnie，或 .dsh 不在默认位置 —— 停下来把完整报错发回来。

**2.4 改 profile 清单（两处）**

    open -e ~/.dsh/profiles/desktop/package.json

第一处，在 dsh.profile.bundles 列表里，给最后一项补逗号并新增一行：

    "bundles": [
      ...（原有内容保持不动）...
      "dsh-mcp-connector",
      "dsh-prompt-engineering"
    ]

第二处，在 dependencies 里新增一行：

    "dependencies": {
      "dsh-mcp-connector": "0.2.95",
      "dsh-prompt-engineering": "link:/Users/<用户名>/dsh-plugins/dsh-prompt-engineering"
    }

如果 dependencies 原本是空的，就整段写成一行：

    "dependencies": { "dsh-prompt-engineering": "link:/Users/<用户名>/dsh-plugins/dsh-prompt-engineering" }

保存后验证：

    grep -c dsh-prompt-engineering ~/.dsh/profiles/desktop/package.json
    python3 -c "import json,os;json.load(open(os.path.expanduser('~/.dsh/profiles/desktop/package.json')));print('JSON 合法')"

验证：grep 输出 2（两处都加上了）；JSON 合法。若 grep 输出 0 或 1，或 python3 报错，回去检查逗号。
（系统没有 python3 就跳过第二句，改为肉眼确认首字符是 { 、末字符是 }。）

**2.5 建立链接**

    ln -s ~/dsh-plugins/dsh-prompt-engineering ~/.dsh/profiles/desktop/node_modules/dsh-prompt-engineering
    ls -l ~/.dsh/profiles/desktop/node_modules/dsh-prompt-engineering

验证：输出形如 dsh-prompt-engineering -> /Users/<用户名>/dsh-plugins/dsh-prompt-engineering。
若提示 File exists，先删旧链接再建：rm ~/.dsh/profiles/desktop/node_modules/dsh-prompt-engineering

**2.6 打开插件开关（关键一步，别跳过）**

    open -a Donnie

打开 Donnie → 插件 → 已安装插件，找到 dsh-prompt-engineering，把它的开关**打开**。

> 为什么必须点这一下：Donnie 会自己管理 dsh.profile.bundles。手动写进去的条目在应用启动时会被
> 归一化成「已安装但未启用」（实测：日志里出现 enable=false），条目随之从清单里移除，插件不生效。
> 只有在界面里打开一次开关，应用才会把条目写回清单并真正装载。

验证：开关显示为打开状态。若列表里根本没有这一项：完全退出 Donnie，回到 2.4 与 2.5 复查。

**2.7 重启后验收**

完全退出 Donnie 再重新打开（不是刷新页面），验证见第三部分。

### Windows（PowerShell）

**2.1 放置目录**

    New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\dsh-plugins" | Out-Null
    # 把收到的 dsh-prompt-engineering 文件夹整个拖进 %USERPROFILE%\dsh-plugins\
    dir "$env:USERPROFILE\dsh-plugins\dsh-prompt-engineering"

验证：列出 package.json、index.js、client.js、cordis.patch.yml、icon.svg。

**2.2 完全退出 Donnie**

从托盘图标右键 → 退出（只关窗口不算退出），然后：

    Get-Process Donnie -ErrorAction SilentlyContinue

验证：没有任何输出。仍有输出就回托盘退出，不要用任务管理器强杀。

**2.3 备份 profile 清单**

    Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\package.json" "$env:USERPROFILE\.dsh\profiles\desktop\package.json.bak"
    dir "$env:USERPROFILE\.dsh\profiles\desktop\package.json*"

验证：看到 package.json 与 package.json.bak 两行。
若提示找不到路径：可能没启动过 Donnie，或设过 DSH_HOME —— 停下，把报错和 echo $env:DSH_HOME 的输出发回来。

**2.4 改 profile 清单（两处）**

    notepad "$env:USERPROFILE\.dsh\profiles\desktop\package.json"

同 macOS 的两处改动，但 JSON 里的路径写成正斜杠：

    "dsh-prompt-engineering": "link:C:/Users/<用户名>/dsh-plugins/dsh-prompt-engineering"

保存后验证：

    findstr dsh-prompt-engineering "$env:USERPROFILE\.dsh\profiles\desktop\package.json"

验证：打印两行（bundles 一行、dependencies 一行）。

**2.5 建立链接（junction，不需要管理员）**

    cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-prompt-engineering" "%USERPROFILE%\dsh-plugins\dsh-prompt-engineering"
    dir "$env:USERPROFILE\.dsh\profiles\desktop\node_modules" | findstr dsh-prompt-engineering

验证：出现 <JUNCTION> dsh-prompt-engineering [C:\Users\<用户名>\dsh-plugins\dsh-prompt-engineering]。
若提示已存在该文件，先删旧的：cmd /c rmdir "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-prompt-engineering"

**2.6 打开插件开关（关键一步，别跳过）**

从开始菜单打开 Donnie → 插件 → 已安装插件，找到 dsh-prompt-engineering，把它的开关**打开**。

> 为什么必须点这一下：Donnie 会自己管理 dsh.profile.bundles，手动写进去的条目在启动时会被归一化成
> 「已安装但未启用」（实测日志出现 enable=false），条目随之从清单移除。只有界面里打开一次开关，
> 应用才会写回清单并真正装载。

验证：开关显示为打开状态。若列表里没有这一项：完全退出 Donnie，回到 2.4 与 2.5 复查。

**2.7 重启后验收**

完全退出 Donnie 再重新打开，验证见第三部分。

---

## 第三部分：整机验收（3 条全过才算装好）

1. **图标出现**：输入框下方右侧、模型选择器左边、发送按钮之前，有一个星芒图标（不带文字、不描边）。
   没出现 → 先确认「插件 → 已安装插件」里 dsh-prompt-engineering 的开关是**打开**的，
   再回到 2.4 确认 bundles 改了两处、2.5 的链接指向正确、2.2 确实完全退出了。
2. **能就地优化**：输入「把A改成B，注意C」，点星芒图标 → 图标先转圈（正在优化）→ 变对勾，
   输入框内容被替换成一条结构化提示词（含目标、约束等）。3~10 秒属正常。
   替换后按 ⌘Z（macOS）/ Ctrl+Z（Windows）能退回原文。
3. **失败可读**：若图标变感叹号，鼠标停在图标上看提示文字 —— 那就是失败原因（例如未选模型、凭证缺失），
   把这句提示原样发回来即可定位。

## 第四部分：卸载 / 回滚

macOS：

    rm ~/.dsh/profiles/desktop/node_modules/dsh-prompt-engineering
    cp ~/.dsh/profiles/desktop/package.json.bak ~/.dsh/profiles/desktop/package.json
    osascript -e 'quit app "Donnie"'; sleep 2; open -a Donnie

Windows：

    cmd /c rmdir "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-prompt-engineering"
    Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\package.json.bak" "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Force

> Windows 上删 junction 必须用 rmdir，不要用 del /S 或 Remove-Item -Recurse，那会连源目录里的文件一起删掉。

## 第五部分：出问题时请回传这 4 样

1. 出问题的步骤号（例如 2.4）；
2. 那条命令的完整输出（截图或复制文字）；
3. Windows：findstr dsh-prompt-engineering "%USERPROFILE%\.dsh\profiles\desktop\package.json" 的输出；
   macOS：grep dsh-prompt-engineering ~/.dsh/profiles/desktop/package.json 的输出；
4. Donnie 版本号：菜单「关于 Donnie」的截图。

---

## 附 1：需要提前向对方确认的 3 件事

1. **Donnie 版本必须是 0.2.x**（插件声明 engines.dsh: >=0.2.0 <0.3.0）。不在范围内时 Donnie 会拒绝装载。
   查法：让对方发「关于 Donnie」的截图。
2. **.dsh 的实际位置**：若对方设过环境变量 DSH_HOME，profile 不在默认目录。
   查法：macOS 执行 echo $DSH_HOME，Windows 执行 echo $env:DSH_HOME，有输出就发来。
3. **是否已至少启动过一次 Donnie**：没启动过就没有 profiles/desktop/package.json，2.3 会失败。
   让对方先打开一次 Donnie、再完全退出。

## 附 2：更省事的长期方案（现已可用）

插件已公开，两条路都不用再传文件：

- **直接安装**（对方要开一次终端）：

      dsh plugin --profile desktop add git+https://github.com/huataohuang/dsh-prompt-engineering.git#<40位commit>

- **走「发现」标签页**（最省事，全程不开终端）：**插件 → 发现 → 索引源 → 粘贴**

      https://huataohuang.github.io/dsh-prompt-engineering/market/index.json

装完重启 Donnie。上面的「文件传输 + 手动登记」保留作离线兜底。

注：npm 通道尚未发布（registry 查询 dsh-prompt-engineering 返回 404），当前可用的是 git 通道。
