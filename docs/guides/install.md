# 安装 / 更新 / 验证 / 卸载

面向「零基础也能照做」的分步指南:每一步都可**原样复制**到终端,并给出**期望输出**与失败排查。每步之间不需要理解原理,照着做即可。

---

## 0. 前置条件(先逐条确认)

| 依赖 | 要求 | 检查命令 | 期望输出 |
|---|---|---|---|
| OpenCode | **V2 及以上**(实测基准 `v2.2.5`) | `opencode --version` | 版本号 ≥ 2 |
| Node.js | **≥ 22** | `node --version` | `v22.x` 或更高 |
| PowerShell | **7+**(命令为 `pwsh`;Windows 自带的是 5.x,`pwsh` 通常需另装) | `pwsh --version` | `PowerShell 7.x` |
| git | 任意近期版本(`plugin add github:` 依赖 git 拉取) | `git --version` | `git version 2.x` |
| gh | **仅维护者需要**(发布自验证);普通用户不需要 | `gh --version` | 版本号即可 |

> **Windows 特别注意**:本文 PowerShell 命令里用 `$env:USERPROFILE` 表示用户目录,**不要用 `~`**——PowerShell 的多数命令与 git 都不展开 `~`,会报「找不到路径」。路径分隔符用反斜杠 `\`。

若 `git` 缺失,`opencode plugin add github:...` 会失败——先装 git 再继续。

---

## 1. 一键安装(推荐)

在**任意目录**执行(注意 PowerShell 用 `;` 串联,不是 `&&`):

```powershell
opencode plugin add github:dubuqiangu/opencode-usage-meter; opencode service restart
```

**期望输出**:

- 第一条命令进程结束码为 0,输出里出现已添加/installed 之类字样,且**没有** `error` / `failed to clone` / 网络超时字样;
- 第二条 `service restart` 正常退出(若提示服务未在运行也可忽略,下一步会重开 TUI)。

**成功长什么样**:命令不报错即可进行下一步;真正的效果在 TUI 里验证(见第 4 步)。**不要**用 `opencode plugin list` 判断——见第 4 步的说明。

### 之后必须完整重启 TUI

关闭**所有**正在运行的 OpenCode TUI 进程,然后重新打开。热重载说明见第 6 步。

---

## 2. 备选安装方式(一键失败时用)

### 2a. 克隆到全局插件目录(OpenCode 自动发现)

```powershell
git clone https://github.com/dubuqiangu/opencode-usage-meter.git "$env:USERPROFILE\.config\opencode\plugins\usage-meter"
```

**期望输出**:`Cloning into '...'... done.`(或 `Resolving deltas: 100% ... done.`),退出码 0。之后同样执行 `opencode service restart` 并完整重启 TUI。

> Linux/macOS 下把 `"$env:USERPROFILE\.config\..."` 换成 `~/.config/opencode/plugins/usage-meter` 即可。

### 2b. 在配置里指定本地路径

编辑 `$env:USERPROFILE\.config\opencode\opencode.json`,在顶层 `plugins` 数组里加入本仓库的**绝对路径**(Windows 的 `file://` 是**三斜杠 + 盘符 + 正斜杠**,例如 `file:///D:/workSpace/...`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///D:/workSpace/python/aicode/opencode/opencode-usage-meter"
  ]
}
```

保存后执行 `opencode service restart` 并完整重启 TUI。

---

## 3. 更新

```powershell
opencode plugin update github:dubuqiangu/opencode-usage-meter; opencode service restart
```

**期望输出**:命令不报错;`service restart` 正常退出。**更新后必须完整重启 TUI**(见第 6 步),否则运行中的宿主仍持旧代码——表现为计时冻结、tok/s 停更。

> 版本号只用平铺 semver(如 `0.7.38`);带 `-probe` 之类预发布后缀会让 `plugin update` 挂起,补丁位正常推进即可。

---

## 4. 普通用户:如何确认装好 / 装的是什么版本

**不要依赖 `opencode plugin list`**:在部分 CLI 版本(实测基准 v2.2.5)上,它对 `github:` 插件会输出 `No plugins found`,即使插件已正确注册。请用下面两个可靠方法。

### 4a. 读已安装包的版本(最可靠)

```powershell
$dir = Get-ChildItem "$env:USERPROFILE\.cache\opencode\npm" -Directory -Filter "git-opencode-usage-meter-*" -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ChildItem $_.FullName -Directory } |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName "node_modules\opencode-usage-meter\package.json" } |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
(Get-Content $dir -Raw -Encoding UTF8 | ConvertFrom-Json).version
```

**期望输出**:一个版本号,如 `0.7.38`。装完/更新后它应与目标版本一致。

### 4b. 确认宿主配置里已注册

```powershell
(Get-Content "$env:USERPROFILE\.config\opencode\opencode.json" -Raw -Encoding UTF8 | ConvertFrom-Json).plugins
```

**期望输出**:一个字符串数组,其中**包含** `github:dubuqiangu/opencode-usage-meter`。

### 4c. 真机确认(最终判据)

1. 完整重启 TUI(见第 6 步);
2. 进入任意会话,发一条消息;
3. 底部状态行出现 `⏱ …   ⚡ … tok/s`(运行中跳动),跑完变 `🏁 …   ⚡ … tok/s`。右栏 `Stats` 块出现 `⏱/⚡/📊/🎯` 行。

看到 `⏱` 与 `⚡` 跳动即安装成功。

---

## 5. 维护者:一键安装自验证(发布后必跑)

> 这是**维护者发布自验证**,不是普通用户的验证手段。普通用户装完**没有本地仓库**,无法执行此脚本——跳过本节即可。

它从**仓库根目录**验证:本地 HEAD 已推送 → `plugin update` → 注册 commit 与 HEAD 一致 → 落盘版本与 `package.json` 一致 → src/test/docs/dist 文件树与仓库镜像一致 → `tui` export 目标存在 → `opencode.json` 已注册。

**必须在仓库根目录运行**:

```powershell
pwsh scripts/verify-install.ps1
```

**期望输出**:逐行 `PASS`,最后一行 `VERIFY OK — vX.Y.Z @ <commit> fully installed`,退出码 0。任一行 `FAIL` 都不得视为发布完成,先修复再重跑。

> 脚本只核对**磁盘安装态**;运行中的 TUI 仍持旧代码,仍须完整重启。

---

## 6. 排障

**「插件更新了但界面没变 / 计时冻结」**
`plugin update` 只改磁盘包,**运行中的宿主仍持旧代码**;`/reload` 会拆掉旧实例的接线(slot/订阅/定时器)但**不会从磁盘重载插件本体**,还会留下重复死实例。**每次更新/重装后必须完整重启 TUI**:**关闭所有** OpenCode TUI 进程(PowerShell 里 `Get-Process` 看有没有残留的 opencode 进程),再重新打开;`/reload` 不算重启。

**「想从宿主日志里找插件的报错」**
实测(0.7.19):**插件自身的 `console.error` / 输出不会进入宿主 `opencode.log`**(全量读 26MB 日志得到 0 行插件输出)。别在宿主日志里找插件自己的日志——只能看到宿主的**结构化事件与 `stage=load` 加载失败**。宿主日志路径:`$env:USERPROFILE\.local\share\opencode\log\opencode.log`。

**「`~/.config/...` 报找不到路径」**
PowerShell / git 不展开 `~`。改用 `"$env:USERPROFILE\.config\opencode\plugins\usage-meter"`(双引号包裹,反斜杠)。

**「`plugin add github:` 失败 / 卡住」**
多为网络或代理问题:确认能 `git ls-remote https://github.com/dubuqiangu/opencode-usage-meter.git`(有输出即可);代理环境下给 git 配代理。也可能是未安装 `git`(见第 0 步)。

**「状态行始终没有 ⏱」**
① 确认已完整重启 TUI(不是 `/reload`);② 用第 4a/4b 步确认已注册且版本正确;③ 换一个新会话发一条消息——全新空会话在发消息前无任何显示属正常。宿主 `stage=load` 加载失败会在 `opencode.log` 里出现,可按插件名过滤。

---

## 7. 卸载

```powershell
opencode plugin remove github:dubuqiangu/opencode-usage-meter; opencode service restart
```

**确认已卸载**(输出应**不含**本插件):

```powershell
(Get-Content "$env:USERPROFILE\.config\opencode\opencode.json" -Raw -Encoding UTF8 | ConvertFrom-Json).plugins
```

若曾经用第 2a 步克隆过,再删除目录:`Remove-Item -Recurse -Force "$env:USERPROFILE\.config\opencode\plugins\usage-meter"`,然后完整重启 TUI。

---

> 变更历史见 [changelog.md](../decisions/changelog.md);热重载机制取证见 [runtime-lessons.md](../architecture/runtime-lessons.md)。
