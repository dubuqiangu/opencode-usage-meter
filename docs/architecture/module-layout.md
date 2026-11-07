# 代码模块结构(0.7.2 拆分)

入口只做组装,按功能维度解耦;单文件超过 ~400 行或职责混杂即拆,改一处功能只碰一个文件。src/ 现共 **23 个文件**(tui 入口 + index 服务端占位 + 17 个功能模块 + 4 个 UI 组件)。

```
src/
  tui.tsx            入口:Plugin.define + 工厂装配 + 事件/slot/命令注册 + 清理
  index.ts           服务端入口占位(setup 为空,不承载业务逻辑)
  format.ts          纯格式化(format/fmtNum/fmtUSD)与 token 估算
  rate-model.ts      速率数学(滑动窗口/精确采纳)+ 事件访问器(纯函数)
  calibration.ts     每模型持久化校准(storage store + EMA 学习)
  settings.ts        /usage-settings 持久化设置 + 归一读取器/开关
  stats-source.ts    日级统计拉取/防抖刷新/跨零点/重试
  session-metrics.ts 每会话运行时状态 + session.*/message.* 事件处理
  footer-runs.ts     footer 行按色调合并(纯函数,可被 Node 测试加载)
  live-rate.ts       ⚡ 共享判定:保留本轮上次读数 + 淡化标记(供 footer 与右栏,0.7.37)
  hit-rate.ts        缓存命中率纯函数(日级 / 会话严格口径,0.7.27 提取)
  reactive-mount.ts  槽位响应式挂载(createElement box + 插件图内 insert,0.7.22/0.7.24)
  text-attributes.ts 内联的 DIM 属性位(避免 src 导入 @opentui/core)
  panel-content.ts   /usage-full 面板文本构建(窗口/本会话/子代理/明细)
  panel-session-lines.ts 面板头部 ⏱/⏳/🏁/Σ 组装纯函数(composePanelSessionLines,0.7.39;从 panel-content 提取)
  sidebar-block.ts   右栏块可见性/组装纯函数(shouldShowSidebarBlock / composeSidebarBlock,0.7.38)
  layer-lifecycle.ts keymap layer 创建退避与释放纯函数(shouldAttemptLayerCreate / createDisposableLayer,0.7.38)
  session-context.ts 会话上下文访问器(currentSessionID / isSessionRunning,0.7.38)
  durable-store.ts   耐久 store 打开封装(openStore,0.7.38)
  components/
    footer-status.tsx     prompt.footer.status 状态行组件
    sidebar-metrics.tsx   右栏 Stats 块组件
    stats-panel.tsx       面板/dialog 组件 + /usage-full 命令
    settings-dialog.tsx   /usage-settings 弹窗组件
```

> reactive-mount(0.7.22 引入,0.7.24 定为 OMO `reactiveElement` 同款)与 hit-rate(0.7.27 提取)是 0.7.2 拆分之后新增的模块;0.7.38 又提取 4 个纯函数模块(sidebar-block / layer-lifecycle / session-context / durable-store,提纯重构,行为零变化)。

## 模块接口(factory 模式)

setup 内的闭包状态拆为各 factory,依赖显式注入:

| 工厂 | 返回 | 依赖 |
|---|---|---|
| `createCalibration(context)` | `calibOf` / `learnCalibration` / `rememberSessionModel` / `release` | storage |
| `createSettings(context)` | store + 读取器 + 开关 | storage |
| `createStatsSource(context, totalScopeEnabled)` | `todayStats` 信号 / `fetchToday` / `scheduleStatsRefresh` / `checkMidnightRollover` / `release` | client |
| `createSessionMetrics({context, calibration, scheduleStatsRefresh})` | 事件处理器 + 每会话 Map(`starts`/`lastDurations`/`lastLiveRates`/...) + `release` | context, calibration |
| `createPanelContent(deps)` | 面板文本构建函数 + `ensureDetail` | context, sessionMetrics, statsSource, now |
| `createStatsPanel` / `createSettingsDialog` / `createSidebarMetrics` / `createFooterStatus` / `createReactiveSlotMount` | 各 UI 组件 / 响应式挂载器 | 对应数据模块 + `now` 信号 |

`tui.tsx` 按原顺序创建工厂、注册事件与 slot、组装清理函数——**行为零变化**的纯结构调整。

0.7.38 提纯出的 4 个纯函数模块(被 `.tsx` 组件调用,行为零变化):

- `sidebar-block.ts` — 右栏块可见性与组装:导出 `shouldShowSidebarBlock`(可见性判定)、`composeSidebarBlock`(按状态组装块内容)
- `layer-lifecycle.ts` — keymap layer 生命周期:导出 `shouldAttemptLayerCreate`(5s 退避重试判定)、`createDisposableLayer`(创建并登记释放)
- `session-context.ts` — 会话上下文访问:导出 `currentSessionID`(当前会话 id)、`isSessionRunning`(运行中判定)
- `durable-store.ts` — 耐久 store 打开:导出 `openStore`(统一打开 + 失败日志去重,见 [known-issues.md](../decisions/known-issues.md))

## 单元测试(test/,0.7.4 起)

零 devDependency:Node ≥ 22 原生 type stripping + `node:test`;`npm test` 执行。共 **17 个文件**(16 个 `*.test.ts` + 解析钩子 `test-loader.mjs`)。

```
test/
  test-loader.mjs            仅测试用的模块解析钩子(src 内无扩展名 TS 互导 → 重试 .ts)
  format.test.ts             时长/数量/费用格式化、CJK token 估算
  rate-model.test.ts         消息/轮次记账、滑窗采样、liveRate 门槛、事件信封访问器
  settings.test.ts           设置默认值、旧版本存储归一、开关持久化、连点竞态(0.7.31)
  calibration.test.ts        校准默认值、EMA 学习与 0.25-4 钳位、按模型持久化
  stats-source.test.ts       number 入参契约、信封解包、防抖与 30s 重试独立(0.7.6)、在途切维度补抓(0.7.33)、15s 超时
  session-metrics.test.ts    轮次生命周期:启动/delta/精确采纳/防双计锁/空闲精确速率结算/冷启动回填(含三重防护)/新轮清值(0.7.36)
  panel-content.test.ts      ensureDetail 正常路径与 15s 超时降级(0.7.26)
  panel-session-lines.test.ts 面板头部组装纯函数 composePanelSessionLines(0.7.39)
  hit-rate.test.ts           日级 / 会话严格口径公式与显示舍入(0.7.27)
  live-rate.test.ts          保留上次实时读数 + 淡化判定(0.7.37)
  footer-runs.test.ts        footer 行按色调合并纯函数(0.7.35)
  sidebar-block.test.ts      右栏块可见性/组装纯函数(0.7.38)
  layer-lifecycle.test.ts    keymap layer 创建退避/释放纯函数(0.7.38)
  session-context.test.ts    会话上下文访问器(currentSessionID / isSessionRunning,0.7.38)
  durable-store.test.ts      openStore 打开/去重与失败降级(0.7.38)
  delivery-contract.test.ts  发布形态契约:package.json / dist 产物 / src 姿势 / staleness 哨兵(0.7.25)
```

覆盖纯函数层与 factory 层;UI 组件(solid-js 渲染)与宿主交互不在 UT 范围,按项目惯例走真机验证。

## 关键约定

- `package.json` 的 `exports["./tui"]: "./dist/tui.js"`(0.7.25 起投递为**预编译单文件**)是 OpenCode 发现 TUI 插件的约定。改 src 后必须 `npm run build:tui` 重建并提交 `dist/tui.js`——宿主只对入口级裸导入提供运行时模块,裸 TSX 多文件形态会在 stage=load 解析失败;`npm test` 的 delivery-contract staleness 哨兵会拦住"改了 src 忘构建"
- JSX 组件文件首行 `/** @jsxImportSource @opentui/solid */` pragma;`solid-js` / `@opentui/*` 一律用**裸 specifier** 导入,插件**不声明、不安装**本地拷贝(见 [tui-plugin-pitfalls.md](../guides/tui-plugin-pitfalls.md) #13/#14)
- keymap layer 必须从组件作用域注册(app slot render),不得在 `setup()` 直接调用(见 [runtime-lessons.md](runtime-lessons.md))
- 耐久 store 由宿主管理,factory 的 `release` 对其保持 no-op(接口对齐用),仅定时器/订阅需要显式释放
