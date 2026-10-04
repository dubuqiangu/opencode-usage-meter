# OpenCode V2 TUI 插件开发避坑清单

来自 opencode-usage-meter 0.6.x → 0.7.11 的真实踩坑记录(每条都有实证取证),面向所有写 TUI 插件(`@opencode/plugin/tui` + @opentui/solid)的开发者。按"会让你调一下午"的程度排序。

---

## 1. 宿主 TUI 按需绘制:树更新 ≠ 屏幕重绘(最隐蔽)

**症状**:signal 变了、renderable 树确实更新了,但屏幕纹丝不动;切 session、敲键盘、动光标才"突然"生效。

**根因**:宿主渲染器是**按需绘制**的——solid effect 更新了 renderable 树,但终端画面只在有人调 `renderer.requestRender()` 时才重画。宿主自己的组件更新时它会自己请求;你插件的数据变化没人替你请求。

**正确姿势**(OMO-Slim 同款):

```ts
// 任何驱动周期刷新的 timer 里,更新 signal 之后请求重绘
const timer = setInterval(() => {
  setNow(Date.now())
  context.renderer?.requestRender?.()   // ← 没有这行,树白更新
}, 500)

// 交互处理器里:本地 signal 即时翻转 + 立即请求重绘
onMouseUp={() => {
  setIsCollapsed(!isCollapsed())       // 本地 signal,即时驱动 memo/树
  persistToStore(...)                  // store 写入另行持久化
  context.renderer?.requestRender?.()  // 立即上屏,不等下一个 tick
}}
```

**反例**:只更新 signal、只写 storage store(哪怕 store 是响应式的)——树更新了但画面等宿主重绘。0.7.10 真机"点击生效但要切 session 才可见"就是这一坑。

---

## 2. 宿主 ui.slot 对直接返回的元素不建跟踪 effect

**症状**:组件"冻结"——只在宿主重挂(切 session)时刷新一次;timer/点击/store 变化全都不触发重绘。

**根因**:`context.ui.slot({ render: () => <MyComponent/> })` 直接返回元素时,esbuild `--jsx=automatic` 下 JSX 插值在**组件调用时一次性求值**,宿主对返回的元素不建立任何 solid 跟踪 effect——组件体内读的 signal 全部失联。

**正确姿势**:槽位渲染层用**函数子节点**包裹,reconciler 的 `insertExpression` 对函数子节点建 `createRenderEffect`:

```tsx
context.ui.slot({
  append: "sidebar.content",
  render: (props) =>
    props?.sessionID ? (
      <box width="100%" flexDirection="column">
        {() => <SidebarMetrics sessionID={props.sessionID} />}
      </box>
    ) : null,
})
```

与 OMO-Slim 的 `reactiveElement`(`box(...) + insert(root, renderFn)`)同款模式。footer 里的文本同样适用:`<text>{() => statusText()}</text>`。

---

## 3. Solid 组件函数体每次挂载只执行一次

**症状**:组件体里预计算的字符串/行数据永远停留在挂载那一刻。

**根因**:Solid 组件函数不是 React——不是每次渲染都重跑。**所有动态读取(now()/会话状态/stats signal/设置)必须放进 `createMemo`,JSX 插值读 memo**。memo 内无条件读一个高频 signal(如 500ms 的 now())还能兜住非响应式数据源(store 直写)的变更。

**注意**:这一条(0.7.8 修复)只是必要条件,还必须叠加上面第 1、2 条才构成完整链路:**memo 跟踪(0.7.8)→ 槽位函数子节点(0.7.10)→ requestRender(0.7.11)**,三环缺一不可。footer 的断裂容易被宿主高频重绘(输入/光标闪烁)掩盖——验证响应式请用空闲时的右栏,不要用 footer。

---

## 4. 无头复现环境是双 solid-js 实例,会给出假阴性

**症状**:在插件安装目录写无头复现脚本(bun + testRender),函数子节点、insert、spread 全部"冻结"——与真机表现矛盾。

**根因**(实证):Bun 下 `"solid-js"` 主入口、`"solid-js/dist/solid.js"`(探针侧)、以及 **@opentui/solid 内部的同名 dist 导入**解析为**不同模块实例**。solid 的 `Listener/Owner` 是模块级全局——跨实例时,@opentui/solid reconciler 创建的 effect 看不见你插件代码创建的 signal/memo(你的 signal 的 `readSignal` 只注册到你自己实例的 Listener)。验证手段:

```js
import * as opentuiSolid from "@opentui/solid"
import * as deepSolid from "solid-js/dist/solid.js"
deepSolid.createSignal === (await import("solid-js")).createSignal // false → 实例分裂
opentuiSolid.effect(() => { mySignal() })  // 冻结 → @opentui 的 effect 看不见你的 signal
```

**结论**:无头环境(安装目录 + bun)**不能验证跨模块响应链**——reconciler 内部 effect 与插件 signal 天然分裂。真机(宿主 exe)内模块统一,OMO-Slim 同款机制实时可用。**切勿因为无头复现失败回滚真机上正确的代码**;先跑实例同一性探针。

---

## 5. `/reload` 不是测试手段

`/reload` 会拆除旧实例的接线(slot/订阅/定时器断开)**但不重载插件本体**,还会留下重复死实例——你测的可能是一个旧版本死块。测任何新版本必须**完整重启 TUI**。0.7.9"点击无反应"的部分真机反馈就来自点到了旧实例。

---

## 6. 宿主锁 @opentui 版本 ≠ 插件安装目录版本

宿主 exe 内锁 @opentui/solid 0.4.5(opencode 仓库 root package.json 决定);插件安装目录自带 0.5.14,`@opentui/solid/jsx-runtime` 从安装目录解析。两版 reconciler 关键路径(`insertExpression` 函数子节点分支)目前一致,但**依赖内部实现前要两版源码都读**:0.4.5 在宿主 exe 内(`C:\Users\<user>\AppData\Local\Temp` 下解包 tarball 可取证),0.5.14 在安装目录 `node_modules/@opentui/solid/index.js`。

---

## 7. 可点击文本要退出选区路径

`TextRenderable` 继承 `TextBufferRenderable`,`selectable` **默认 true**——点击可交互标签可能进入文本选区路径。可点击的标签加 `selectable={false}`:

```tsx
<text fg={base} selectable={false}>{"▼ Stats"}</text>
```

---

## 8. 鼠标事件:JSX prop 挂法没有问题,别急着改命令式

无头实证(@opentui 0.5.14 全栈 + `createMockMouse`):`<box onMouseUp={...}>` JSX prop、`ref + setProp` 命令式、带背景行三种挂法**全部正常触发**,经同一 `node[name] = value` 落点。点击"无反应"时先查刷新链路(第 1-3 条),不是事件挂法。

---

## 9. keymap.layer 必须从组件作用域注册

`setup()` 直接调 `context.keymap.layer(...)` 抛 `Keymap.Provider is missing`(且被吞掉,命令静默注册失败)。从 `app` slot 的 render 内注册(组件作用域内 `Keymap.Provider` 已建立),并缓存 dispose 以幂等防重。

---

## 10. client API 路径按宿主版本逐一核对

`experimental.session.stats` 在 v2.0.21 不存在(实际路径 `client.session.stats`);`from/to` 要传 number(schema 校验,不是文档暗示的字符串)。客户端方法缺失要定时重试而非一次性判死。取证方式:读宿主源码 + 真机日志,别猜。

---

## 11. 无头测试环境工具箱

- 运行时:须 **bun**(node 无 `node:ffi`,@opentui/core 起不来);脚本放**插件安装目录根**(否则解析不到 @opentui/*)
- `testRender(node)` 接受 thunk(`RendererContext` 挂载时建立,JSX 须惰性调用);`createTestRenderer` 提供 `mockMouse.click(x,y)` / `captureCharFrame()` / `waitForVisualIdle()`
- **测试渲染器同样按需绘制**:改树之后要自己 `renderer.requestRender()` 再等帧——`waitForVisualIdle` 不会替你重画(这让第 4 条的假阴性更迷惑)
- 主题 token(如 `fg="&text.muted"`)在无头下告警 `Invalid hex color, defaulting to magenta`,不影响断言
- Windows:宿主日志 `~\.local\share\opencode\log\opencode.log` 被进程锁,读它要 `FileShare ReadWrite` 打开;PowerShell 先 `[Console]::OutputEncoding = UTF8` 再跑脚本,否则中文全花

---

## 12. 调试方法论(分层取证,别跳步)

1. **事件层**:mockMouse 无头复现点击 → 排除/坐实事件挂法
2. **机制层**:读 reconciler/运行时源码(两版对比),确认跟踪路径存在
3. **实例层**:signal/effect 同一性探针(第 4 条)——决定无头结论是否可信
4. **端到端**:真机行为对照(空闲 ⏱ 走不走秒是最便宜的活性探针)
5. **用户三问**:真机表现细节("切换 session 后变了吗")往往一句话定位缺的是绘制而非跟踪

---

*实证来源:opencode-usage-meter 0.7.8/0.7.10/0.7.11 三轮修复;OMO-Slim 落盘包对照;@opentui/solid 0.4.5/0.5.14 源码;8 个无头探针脚本。相关决策记录见 [../decisions/changelog.md](../decisions/changelog.md)。*
