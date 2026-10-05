# 右栏 Stats 指标块(0.7.0)

会话右栏(Context/MCP/agents 区块下方)追加 `Stats` 区块,默认开启。

## 挂载机制

右栏是宿主侧栏,暴露 `sidebar.content` slot——宿主自己的 Context/MCP 区块(`feature-plugins/sidebar/context.tsx`/`mcp.tsx`)正是经此 slot 挂载。插件以同通道 `append: "sidebar.content"` 追加,落在宿主区块下方。经 v2.0.21 源码取证。

## 内容(0.7.1 起全英文图标行,分行展示;0.7.9 起头部可收起)

```
▼ Stats
⏱ 1m 02s
⚡ 73 tok/s
📊 13M / 500M (today)
🎯 96.3% (today)
```
| 行 | 说明 |
|---|---|
| `▼/▸ Stats` | 头部行,鼠标点击切换收起/展开(0.7.9),同 MCP/OMO-Slim 区块头 |
| `⏱` / `⏳` / `🏁` | 当前会话实时计时;空闲显示上轮终值(与 footer 同数据同口径) |
| `⚡` | 实时速率;空闲显示精确速率(或 avg 回退) |
| `📊 总量 / 含缓存 (today\|24h\|7d\|30d)` | 双口径(0.7.15):净计算量 in+out+reasoning / 含缓存总量(另计 cache R/W);cache 为零时只显示单数。维度跟随 `/usage-settings` 的 Σ 维度(0.7.7,默认今日) |
| `🎯 命中率 (today\|session)` | 缓存命中率,维度跟随 `/usage-settings` 的 hit 维度 |

设计约束:右栏为窄列,单行并排会挤压换行,故 ⏱/⚡ 分行;范围标注统一括号后缀。计时/速率行与 footer 同数据同口径,含 0.7.5 冷启动回填(重开终端接手的会话立即可见上轮终值)。

## 刷新机制(0.7.8 → 0.7.10 修正)

所有行文本在 `createMemo` 内计算,由 JSX 读取。0.7.8 把动态读取挪进 memo 的方向正确,但漏了最后一环:**宿主 `ui.slot` 的 render 返回元素后不建立任何跟踪 effect**——esbuild `--jsx=automatic` 下插值在组件调用时一次性求值,signal(500ms tick、stats、设置)变了也无人重绘。真机实证:同一会话空闲时右栏 ⏱ 不走秒(0.7.8 只在有活动时被宿主事件驱动的重挂掩盖)。

0.7.10 修正:槽位渲染层用**函数子节点**包裹(`<box width="100%" flexDirection="column">{() => <SidebarMetrics/>}</box>`)。@opentui/solid 的 reconciler 对函数子节点建 `createRenderEffect`(0.4.5/0.5.14 两版源码均确认,`insertExpression` 的 `t === "function"` 分支),组件体内读到的 memo/`now()` signal 从此全程被跟踪,signal 一变即重绘。与 OMO-Slim 的 `reactiveElement`(`insert(root, renderFn)`)同款模式。footer 段同步修复(`<text>{() => statusText()}</text>`),空闲 ⏱ 不再依赖宿主输入驱动的重绘。

0.7.11 补最后一环:**宿主 TUI 按需绘制**。signal → 跟踪 effect → renderable 树更新,都不触发屏幕刷新;屏幕只在有人调 `renderer.requestRender()` 时重绘(OMO-Slim 每次 `setSnapshot` 后都显式请求,这是它"实时"的直接原因)。0.7.10 真机表现"点击生效但要切 session 才可见"正是此因:树早已翻转,画面等宿主自身重绘。修复:tui.tsx 的 500ms tick 每次显式 `context.renderer?.requestRender?.()`——空闲 ⏱ 走秒、60s 统计拉取与任何设置变更 ≤500ms 内可见。

## 开关

`/usage-settings` 内按 `b` 切换(默认开);关闭后整块消失。开关为挂载期判定——翻转 store 后在宿主**下一次重挂右栏**(切会话/侧栏状态变化)时生效,非即时响应式拆除。生命周期纳入插件清理。

## 收起(0.7.9 → 0.7.10 修复"点击无反应")

点击 `▼/▸ Stats` 头部行切换收起:收起后只保留 `▸ Stats` 头部,指标行隐藏;再点恢复。状态经 `statsBlockCollapsed` 键持久化(缺键 = 展开),重启后保持。与 `b` 开关互不影响:`b` 控制整块有无,收起只折叠内容。

实现:全宽头部行 box 挂 JSX `onMouseUp`(经无头实证与 OMO-Slim 的 setProp 命令式挂法等价:插件安装目录 @opentui 0.5.14 全栈 + `createMockMouse` 模拟点击,JSX prop / ref+setProp / 带背景行三种挂法全部正常触发),头部标签 `selectable={false}`(TextRenderable 继承 TextBufferRenderable、selectable 默认 true,退出文本选区路径保证点击语义干净)。0.7.9 真机"点击无反应"的根因不是鼠标事件,而是上面 0.7.10 的刷新断裂——点击其实已翻转 store,界面从不重绘。另:测试任何新版本必须**完整重启 TUI**,`/reload` 会拆除旧实例接线并留下重复实例(见 guides/install.md)。

0.7.11 即时翻转:点击处理器先翻转**本地 `isCollapsed` signal**(同步驱动 memo → renderable 树即时更新),再持久化写 store(`toggleSettingsFlag`),最后立即 `requestRender()` 请求重绘——不等 500ms tick,点击即刻 ▼↔▸(OMO-Slim 同款交互链:本地信号即时 + 显式重绘请求)。挂载/重挂载时从 store 读取器重新初始化本地信号,重启后保持持久化状态。

0.7.12 跨实例回读:0.7.11 的本地镜像此前是 memo 的唯一数据源,"镜像持久值"名不副实——另一 TUI 实例翻转的收起态在本实例永不体现。修复:memo 现在回读持久读取器 `statsBlockCollapsed()`,仅在本地点击后 **2s 窗口内**(`lastLocalFlipAt` 时间戳)信任本地 signal(吸收 store 写异步落地、防回跳),其后持久值接管——跨实例同步在 ≤500ms tick 内恢复生效。
