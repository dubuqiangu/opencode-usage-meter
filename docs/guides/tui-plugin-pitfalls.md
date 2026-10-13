# OpenCode V2 TUI 插件开发避坑清单

来自 opencode-usage-meter 0.6.x → 0.7.11 的真实踩坑记录(每条都有实证取证),面向所有写 TUI 插件(`@opencode/plugin/tui` + @opentui/solid)的开发者。按"会让你调一下午"的程度排序。

---

## 1. 宿主 TUI 按需绘制:树更新 ≠ 屏幕重绘(最隐蔽)

**症状**:signal 变了、renderable 树确实更新了,但屏幕纹丝不动;切 session、敲键盘、动光标才"突然"生效。

**根因**:宿主渲染器是**按需绘制**的——solid effect 更新了 renderable 树,但终端画面只在有人调 `renderer.requestRender()` 时才重画。宿主自己的组件更新时它会自己请求;你插件的数据变化没人替你请求。

**修订(0.7.16,doc-only)**:本条"树更新了但屏幕不动"的机制来自 OMO-Slim 源码推断,该形态在真机从未被直接观测过。0.7.16 真机新观测:流式输出期间(宿主自身高频重绘)footer 数值全程停在挂载期快照——高频宿主重绘救不动,说明当前统一症状是**树根本不更新**(插件侧 solid 运行时无效,见 3a 修订与 #13),而非"更新了没人画"。`requestRender` 仍是必要环节、保留;但排查冻结时先验"树是否在更新",再怀疑绘制。

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

**根因**:Solid 组件函数不是 React——不是每次渲染都重跑。**所有动态读取(now()/会话状态/stats signal/设置)必须放进 `createMemo`,且 memo 的每个 JSX 消费点必须是函数子节点(`{() => blockState()}`),不能是插值(`{blockState()}`)**——esbuild `--jsx=automatic` 下插值在组件调用时一次性求值,读到的值从挂载起冻结。memo 内无条件读一个高频 signal(如 500ms 的 now())还能兜住非响应式数据源(store 直写)的变更。

**注意**:这一条(0.7.8 修复)只是必要条件,还必须叠加上面第 1、2 条才构成完整链路:**memo 跟踪(0.7.8)→ 函数子节点(0.7.10)→ requestRender(0.7.11)**,三环缺一不可。footer 的断裂容易被宿主高频重绘(输入/光标闪烁)掩盖——验证响应式请用空闲时的右栏,不要用 footer。

### 3a. 槽位边界的函数子节点救不了组件体内部(0.7.16 真机证实)

**症状**:右栏 Stats 点击 ▼/▸ 不即时展开/收起,切换 session 才生效;空闲时右栏 ⏱ 也不走秒。0.7.10-0.7.15 四轮修复全部只过代码审查,真机从未通过。**0.7.16 真机修订**:footer 空闲同样不走秒,且流式输出期间(宿主高频重绘)数值全程停在挂载期快照——此前"footer 正常"是输入/重挂掩盖的假象,footer 从来不是可靠基线(见第 3 条末注)。本条的"插值 vs 函数子节点"结论只覆盖 JSX 消费层;冻结的更上游根因(插件侧 solid 无效,server 构建/实例分裂二选一)见 #13(0.7.17-probe 定案中)。

**根因**:`createComponent` 对组件函数体 `untrack`(solid.js:`return untrack(() => Comp(props))`)——槽位渲染层的函数子节点包裹确实为**它自己**建了 render effect,但该 effect 的全部工作只是调用一次 `<SidebarMetrics/>`;组件体内所有 `blockState()` **插值**读取发生在 untrack 作用域里,既不注册到外层 effect、也不在任何自身 effect 内,树从挂载起冻结,`requestRender` 画的永远是同一棵树。切 session 触发宿主重挂、组件体重跑,才读到新值——症状"要切 session"正源于此。

**正确姿势**:动态叶子一律函数子节点——文本走 `<text>{() => ...}</text>`(insertExpression 对函数子节点建 createRenderEffect,thunk 内的读取在自身 effect 的 Listener 作用域内注册,0.4.5/0.5.14 两版源码均确认),结构分支走 `{() => cond ? null : <text>{() => ...}</text>}`。footer 的 `<text fg={muted}>{() => statusText()}</text>` 一直是对的;0.7.16 把右栏两个插值消费点补成同款后三环才真正闭合。

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
- **0.7.19 修订(实证):插件 console.error/output 根本不进 opencode.log**——2026-10-11 全量读取 26MB 宿主日志(横跨 0.7.8-0.7.18、宿主 2.0.x)得到 **0 行**插件输出,历史错误路径(如"session stats fetch failed")同样缺席,证明该通道从未通过。宿主日志只记自己的结构化事件;插件要落日志必须**自己写文件**(OMO-Slim 即如此,它的 `oh-my-opencode-slim.*.log` 是自己写的)。0.7.19 起探针直写 `~\.local\share\opencode\usage-meter-probe.log`

---

## 12. 调试方法论(分层取证,别跳步)

1. **事件层**:mockMouse 无头复现点击 → 排除/坐实事件挂法
2. **机制层**:读 reconciler/运行时源码(两版对比),确认跟踪路径存在
3. **实例层**:signal/effect 同一性探针(第 4 条)——决定无头结论是否可信
4. **端到端**:真机行为对照(空闲 ⏱ 走不走秒是最便宜的活性探针)
5. **用户三问**:真机表现细节("切换 session 后变了吗")往往一句话定位缺的是绘制而非跟踪

---

*实证来源:opencode-usage-meter 0.7.8/0.7.10/0.7.11 三轮修复;OMO-Slim 落盘包对照;@opentui/solid 0.4.5/0.5.14 源码;8 个无头探针脚本。相关决策记录见 [../decisions/changelog.md](../decisions/changelog.md)。*

## 13. "谁插入函数子节点,谁拥有渲染 effect"——插件 slot 不许把函数子节点交给宿主去插(0.7.22 机制终版)

**症状**:空闲 footer/右栏全部冻结在挂载期快照;流式期间宿主高频重绘也不救;点击的本地 signal 翻转 + 立即 requestRender 同样不生效;只有切走再切回(重挂)刷新。屏幕有两种表现、同一条根因链:挂载时数据已就绪 → 显示冻结旧值(⏱ 定格不走秒、tok/s 停旧值);挂载时无数据 → 相关段按设计隐藏且永不出现(footer 指标整段不见、右栏 tok/s "消失"、轮次中重挂时定格"运行中但速率未播种"瞬态)。另:`requestRender` 每拍都被调、探针里 memo 重算上万次——树死但插件侧全活。

**机制链(0.7.20-0.7.22 三轮真机探针 + 源码取证)**:① **H1 证伪**——宿主 bun 把裸 `"solid-js"` 解析成可用响应式构建(SSR 空函数论不成立);② **同构建双模块实例确实存在且必须消除**——solid 的响应式全局(observer 栈)每模块实例私有,跨实例订阅登记不进;0.7.21 统一 `dist/solid.js` 后探针 `bareSignalEqDist:true`,但**叶子 thunk 仍只等于重挂数**——实例统一是必要非充分;③ **终版根因 = effect 归属**:slot render 直接返回含函数子节点的 JSX 时,执行 insertExpression 的是**宿主**——用宿主自己的 @opentui/solid 拷贝和宿主图里的 solid 实例建 createRenderEffect;插件 memo 在插件图里,跨图订阅失败,叶子 thunk 只在挂载时求值一次。0.7.10/0.7.16 的"函数子节点包裹"修复依赖"谁挂树谁建 effect",而真机上挂树的永远是宿主——这就是四轮代码审查全过、真机全冻的原因。OMO-Slim 落盘包实证活体模式:`reactiveElement` 返回前用**自己的** @opentui/solid `insert` 把 render 函数插进 core box,effect 全部活在自己图里,宿主只拿到普通 Renderable。

**正确姿势(0.7.22 已实施)**:两层缺一不可——(a) 插件全部 solid 原语导入走 `"solid-js/dist/solid.js"`(与插件图内 @opentui/solid 的 insert 同实例);(b) 每个动态 slot 的 render 一律返回 `createReactiveSlotMount` 的 root box(见 `src/reactive-mount.ts`):插件自己 `createElement("box")` + `insert(box, renderFn)`,renderFn 内才是真正组件;宿主重挂时 swap 旧图即 dispose(footer 高频重挂,不换图会每 500ms tick 泄漏一条写死节点的 effect 链);teardown 全量 release。配套:宿主 status() 读取 try 包裹(服务重启后客户端可抛,毒化的是插件图整条链)。探针证据链:`~\.local\share\opencode\usage-meter-probe.log` 2026-10-11/12 多轮进程。

**0.7.23 增补——createRoot 分离根会丢 RendererContext**:0.7.22 真机首启即崩,宿主报 `Plugin usage-meter crashed in slot sidebar.content: No renderer found`。机制:@opentui/solid 的 `createElement` 内部是 `useContext(RendererContext)`——renderer 挂在 **solid owner 链的 context** 上(宿主调 slot render 时已提供,这正是旧 JSX 路径能建 box 的原因);而 solid 的 `createRoot(fn)` 不带第二参数时建**分离根**(`root.context = null`),context 查找落空 → `createElement("box")` 抛错。修复:`swap()` 恰在宿主调用的 slot render 栈上执行,此刻 `getOwner()` 拿到的 ambient owner 就带着宿主提供的 context,把它作为 `createRoot` 第二参数(detachedOwner)传入——solid 源码实证 `root.context = current.context`(引用继承),新根即继承 RendererContext。要点:mount 必须在 slot render 时机(而非 setup 期)捕获 owner,setup 期 `getOwner()` 为 null。

**0.7.24 终案——问题根本不在 createRoot,在"寄生拷贝"**:0.7.23(getOwner 继承)真机**仍然崩**,且探针 `otuiEffectEqDist:false` 早已示警:@opentui/solid 内部的 solid 实例与我们 src 的 dist 导入**从来不是同一个**(0.5.17 的 stamp 里 @opentui/solid 自带嵌套 solid-js)。决定性对照:**OMO-Slim 的 stamp 里既没有 @opentui/solid 也没有 solid-js**,其 `import { createElement, insert, setProp } from "@opentui/solid"` 与 `import { createSignal } from "solid-js"`(裸 specifier)解析到**宿主为插件 TUI 代码外置提供的模块**——与宿主 slot 机制同一个图,RendererContext/owner 链天然在场,`reactiveElement`(无 createRoot,ambient 位置 createElement+insert)活体。而我们 0.7.20 钉的 peerDependencies 让 stamp 装了**本地寄生拷贝**:我们的全部导入落在寄生拷贝上,寄生 solid 的 Owner 在宿主调 slot render 时永远是 null → `No renderer found` 必炸。修复(0.7.24):**peerDependencies 整体移除**(寄生拷贝不再安装,运行时解析落宿主拷贝)、src 全部 solid 导入改回裸 `"solid-js"`(宿主别名只证过裸 specifier;`dist/solid.js` 子路径未证)、reactive-mount 改为 OMO `reactiveElement` 逐字同款(无 createRoot——统一图下宿主 slot 机制的计算树负责生命周期,重挂时 solid 会 dispose 旧 owned effect 链)。探针(0.7.17-0.7.23)随之整体 revert,唯 tick 全包 try/catch 保留为永久改进。

## 14. peerDependencies 开放范围会在某次 update 时突然解析到上游新大版本(0.7.19 真机失败实证)

**症状**:0.7.19 发版后用户完整重启,插件直接加载失败,宿主日志(stage=load)报 `Environment variable "OPENTUI_FORCE_UNICODE" is already registered with different configuration`——Existing 是 "Force Mode 2026 Unicode support…"(宿主/先加载的 0.5.x 注册的),New 是 "Use the Unicode width method (mode 2027)…"(本插件 stamp 里的 @opentui 0.6.0 注册的)。

**根因链条**:① peerDependencies 写 `>=0.5.8` 开放范围,`plugin update` 每次落盘都按**当时**最新解析——0.7.18 安装时解析到 0.5.17(正常),0.7.19 安装时上游刚发布 0.6.0 就解析到它;② 0.6.0 改了环境变量注册描述;③ 宿主把"同名环境变量、不同注册配置"当**硬失败**,插件在 stage=load 直接中止。本地 bun 单测 probe.ts 完全正常、OMO-Slim 的 tui2.js 也大量用 node:* 内建——两条反证都指向"不是 node: 导入的锅",别被 0.7.19 同批改动的探针文件通道带偏。

**0.7.24 订正——钉版比开放范围更糟:peers 本身就是病根**:0.7.20 钉 `0.5.17` 消除了版本漂移炸加载,但真机新证据(见 #13 0.7.24 终案)表明:**只要 peerDependencies 声明了 @opentui/* 或 solid-js,stamp 就会装出本地拷贝,插件的所有导入便落在与宿主 slot 机制不同的模块图上**——版本漂移炸加载只是它最响的一种死法,更阴的是寄生拷贝让 RendererContext/owner 链永不在场(`No renderer found`)、信号订阅跨图失效(整树冻结)。对照实证:OMO-Slim 的 package.json **完全不声明** @opentui/* 与 solid-js(无 dependencies/peerDependencies/devDependencies 条目),stamp 里也确实没有这些包,运行时裸 specifier(`"solid-js"`、`"@opentui/solid"`)由宿主外置提供、与宿主 slot 机制同图,活体。

**正确姿势(0.7.24 定版)**:TUI 插件**不声明** @opentui/core、@opentui/solid、solid-js 的任何依赖条目——宿主为插件 TUI 代码外置提供它们(OMO-Slim 同款);src 里用**裸 specifier** 导入(`"solid-js"`/`"@opentui/solid"`,勿用 `solid-js/dist/solid.js` 子路径——宿主别名只实证过裸 specifier)。stamp 级 npm 安装没有 node_modules 可解析时,由宿主运行时接管;`@opencode/plugin` 保持在 dependencies。0.7.19 的 env-var 炸加载在此姿势下不复存在(寄生拷贝根本不会安装)。本地开发/UT:测试只 import 纯逻辑模块(format/rate-model/settings/calibration/session-metrics/stats-source),不经 solid,零 devDependency 也全绿;esbuild bundle 校验用 `--external:@opentui/* --external:solid-js` 免本地解析。

## 15. prerelease 版本号会让 `plugin update` 无限挂起(0.7.17-probe 实证,0.7.20 后补录)

**症状**:发探针版拟用 `0.7.17-probe`,`opencode plugin update` 三次挂起超时;GitHub 三端点(repos/tags/releases)逐一 curl 全通,排除网络与仓库侧问题;把版本号改成平铺的 `0.7.17` 后 update 秒级成功。

**根因**:宿主 update 流程对带 prerelease 后缀的版本号处理有坑(疑似降级比较/匹配逻辑死等),`-probe` 这类后缀即触发。

**正确姿势**:发版版本号**只用平铺 semver 补丁位推进**(0.7.17 → 0.7.18),探针版/试验版也照常占用正式版本号,探针性质写进 commit message 和 changelog 即可。证据链见 [../decisions/changelog.md](../decisions/changelog.md) 0.7.17 条目。
