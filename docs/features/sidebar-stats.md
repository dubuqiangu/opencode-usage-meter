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
| `⚡` | 实时速率;窗口失效(工具间隙 / 无 delta >4s)时**保留本轮上次读数并 DIM 淡化**(0.7.37,与 footer 同步),本轮从未有过读数则不显示;空闲显示精确速率(或 avg 回退) |
| `📊 总量 / 含缓存 (today\|24h\|7d\|30d)` | 双口径(0.7.15):净计算量 in+out+reasoning / 含缓存总量(另计 cache R/W);cache 为零时只显示单数。维度跟随 `/usage-settings` 的 Σ 维度(0.7.7,默认今日) |
| `🎯 命中率 (today\|session)` | 缓存命中率,维度跟随 `/usage-settings` 的 hit 维度 |

设计约束:右栏为窄列,单行并排会挤压换行,故 ⏱/⚡ 分行;范围标注统一括号后缀。计时/速率行与 footer 同数据同口径,含 0.7.5 冷启动回填(重开终端接手的会话立即可见上轮终值)。⚡ 的"窗口失效"路径自 0.7.37 起与 footer 完全一致(保留本轮上次读数并淡化,不再整项消失);代价是间隙期间块高不变、不抖动。

## 收起(当前实现)

点击 `▼/▸ Stats` 头部行切换收起:收起后只保留 `▸ Stats` 头部,指标行隐藏;再点恢复。状态经 `statsBlockCollapsed` 键持久化(缺键 = 展开),重启后保持。与 `b` 开关互不影响:`b` 控制整块有无,收起只折叠内容。

**单一数据源(0.7.30)**:收起态只有一份来源——持久化的响应式 store。memo 直接读读取器 `statsBlockCollapsed()`(官方 `storage.store` 返回 `solid-js/store` 响应式代理,官方注释 "stays live-synced across running TUI instances",写入落地自动重跑),没有本地镜像 signal、没有和解时间窗。点击处理只做一件事:把新值写回 store。因此:

- 跨 TUI 实例的折叠同步立即生效,不再有人为延迟
- 点击到生效 **≤500ms**(由 500ms tick 承担重绘);官方侧栏插件同样不手动 `requestRender()`
- 点击处理不需要复刻 memo 的取值规则——历史那套"本地信号遮蔽持久值"的边界坑从根上消失

头部交互:全宽头部行 box 挂 JSX `onMouseUp`(无头实证与 OMO-Slim 的 setProp 命令式挂法等价,`node[name] = value` 同一落点),头部标签 `selectable={false}`(TextRenderable 继承 TextBufferRenderable、`selectable` 默认 true,退出文本选区路径保证点击语义干净)。另:测试任何新版本必须**完整重启 TUI**,`/reload` 会拆除旧实例接线并留下重复实例(见 [install.md](../guides/install.md))。

<details>
<summary>历史注脚:0.7.9 → 0.7.30 收起机制演进</summary>

- **0.7.9**:引入头部可收起(状态写入 `statsBlockCollapsed`);真机"点击无反应"实为刷新断裂,鼠标事件本身正常
- **0.7.11**:点击处理器先翻转**本地 `isCollapsed` signal** 再持久化、立即 `requestRender()`,试图"即时翻转"
- **0.7.12**:memo 回读持久值,仅在**本地点击后 2s 窗口**(`lastLocalFlipAt`)内信任本地 signal,吸收 store 写异步落地、防回跳
- **0.7.16**:证伪——组件体插值消费点在 `createComponent` 的 `untrack` 下自挂载冻结,本地 signal 与 2s 窗口都救不了;消费点改叶子级函数子节点
- **0.7.30**:改用官方 `storage.store` 响应式代理作**单一数据源**,删除本地 `isCollapsed`、2s 窗口、点击路径 `requestRender()`;唯一行为差异是点击到生效上限从"瞬时"变为 ≤500ms

</details>

## 刷新机制(当前)

所有行文本在 `createMemo` 内计算 → memo 的每个动态消费点是**叶子级函数子节点**(`{() => blockState()}`;插值在 `createComponent` 的 `untrack` 下一次性冻结)→ 落入被跟踪的 render effect → 500ms tick 每次显式 `renderer.requestRender()` 上屏(宿主按需绘制,树更新本身不刷屏)。signal(500ms tick、stats、设置)一变即重绘,不依赖宿主重挂。

两个易踩的空态盲区(0.7.36 修复):右栏与 footer 都在组件体做过的"空态早返回门"(`if (…) return null`)是永久快照——`createComponent` 在 `untrack` 里执行组件体,该读取不建立依赖,而"stats 异步晚于 sidebar 首渲"是每次 TUI 启动必现的窗口。现改为 `hasContent` 布尔 memo + 子 thunk 门,可见性成为被跟踪依赖。

<details>
<summary>历史注脚:0.7.8 → 0.7.25 刷新链路演进</summary>

- **0.7.8**:把动态读取挪进 `createMemo`(方向正确),但漏了最后一环——宿主 `ui.slot` 的 render 返回元素后不建立跟踪 effect
- **0.7.10**:槽位渲染层用**函数子节点**包裹(`<box>{() => <SidebarMetrics/>}</box>`),但该 effect 只覆盖槽位边界,组件体内插值仍冻结
- **0.7.11**:补 `requestRender()`(宿主按需绘制,树更新本身不刷屏)
- **0.7.16**:右栏两个插值消费点改叶子级函数子节点
- **0.7.22 / 0.7.24**:根治"谁插入函数子节点谁拥有 effect"与寄生拷贝问题——slot render 改经插件自己的 `insert`(见 [reactive-mount.ts](../../src/reactive-mount.ts) 同名模块,机制终版见 [tui-plugin-pitfalls.md](../guides/tui-plugin-pitfalls.md) #13)
- **0.7.25**:TUI 入口改为预编译单文件 `dist/tui.js`,让全部裸导入解析到宿主运行时模块(与 slot 机制同图)

</details>

## 开关

`/usage-settings` 内按 `b` 切换(默认开);关闭后整块消失。0.7.36 起开关是**响应式判定**(并入 `hasContent` memo,≤500ms tick 内生效);此前是挂载期判定——翻转 store 后要等宿主**下一次重挂右栏**(切会话/侧栏状态变化)时才生效,这期间设置弹窗已显示"关"而块仍在屏幕上。生命周期纳入插件清理。
