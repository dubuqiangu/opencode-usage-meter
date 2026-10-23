# 边界情况与已知限制

## 边界处理

| 场景 | 处理 |
|---|---|
| 漏收 `execution.started`(TUI 中途打开) | `session.step.started` 的 `started` 数字补起始时间(仅当 `starts` 无记录) |
| 一轮多消息/多步 | 按 `messageID` 分别记账,`turnTotal` 求和 |
| 精确值按步计数(非累计) | `out > 当前估算` 门槛拒绝倒退的读数 |
| 双事件族同时到达 | `sessionVocab` 锁,先到者胜,后者忽略 |
| 工具执行间隙(无流) | 4s 新鲜度门槛使 `liveRate()` 返回空;footer 沿用本轮上次读数并淡化(0.7.35),右栏仍隐藏该项(见下文已结案段) |
| 子代理 session | 事件带各自 sessionID,状态天然隔离;查看子 session 时 footer 显示其自身速率 |
| 订阅失败(未知事件名等) | `listen()` try/catch,单个订阅失败不影响其余功能 |
| 插件卸载/热重载 | 清理函数:clearInterval + slot 注销(四处一致 try/catch,0.7.12 起 footer slot 不再是裸调用例外)+ 全部退订 + 各 factory release(0.7.12 起 sessionMetrics 也入列,清 1.5s 延迟重算定时器) |

## 已知限制

**计量与速率**:

1. 流式期速率为字符启发式估算(±20-30%);step 边界的精确校准可收敛,首条消息仍是未校准值
2. 精确 token 仅在 step 结束时到达;单步长流式期间速率完全依赖估算
3. 上轮时长/速率为进程内存态,重启清零(校准系数与设置除外,经 storage 持久化);0.7.5 起冷启动回填从消息记录回放上一轮,接手会话立即可见,但**回放轮之前**的历史轮次读数不可恢复
4. 采纳精确值瞬间,窗口速率可能短暂波动
5. 极短消息(<20 token)不参与校准
6. **step 精确值只采纳 `tokens.output`(0.7.6 审视确认)**:reasoning-heavy 模型在多步轮次的流式速率可能短暂低估;轮结束的权威结算(output+reasoning 全量)会纠正空闲终值,不影响终值精度
7. **回填负缓存残余(0.7.12/0.7.13)**:负缓存仅记**结构性无望**的会话(列表非空但无 user 锚点),且 0.7.13 起改为**60s 重扫窗**——上次尝试 60s 内不重扫、到点放行一次自愈(长会话消息窗截断/同步滞后把"user 锚点缺失"判定毒化的场景可恢复);瞬态不可回填(列表空/上轮在别处运行中)不记录、每次挂载重扫(in-memory `message.list`,开销可控)——footer 高频重挂成本有界,且 0.7.5 接手场景(别处轮次结束后下一挂载即恢复 `🏁/⚡`)不受影响
8. **回填 🏁 与实时结算仍有口径微差(0.7.12)**:实时结算从 `execution.started`(轮次开跑)起算,回填从该轮窗口内首条 assistant 消息 `created` 起算——两者间首轮 prompt 处理耗时仅计入实时值,回填 🏁 可能略小;排队等待(用户发消息→执行开始)两者均不含(0.7.12 已消除回填侧)

**统计口径**:

- 压缩后窗口占用重置、会话累计继续增长——正常语义,非 bug
- 长会话 TUI 消息窗截断:窗口快照与轮数可能偏低(`N+` 标注下界),会话累计不受影响(权威聚合)
- 模型未配价时 cost 为 0,费用段隐藏
- ctx% 模型档位(平台级):同 id 多 context-tier 变体时可能取错档位;服务端未暴露 per-request 实际档位,原生面板精度等同,不做修
- `syncedChildren` 终身增长(0.7.6 审视确认,changelog 曾提及、此处补记):`/usage-full` 会话累计块每次渲染都会把新发现的子会话 id 记入模块级 Set 并触发一次性 `session.sync()`;Set 随插件实例生命周期只增不减。纯防重集合、体量为会话数量级、零宿主句柄,不做修
- `sessionModels` Map 终身增长(0.7.26 审视确认,与 syncedChildren 同性质):calibration 的会话→模型记录随插件实例生命周期只增不减,体量为会话数量级、零宿主句柄,不做修

**已结案:运行中 ⚡ 消失(0.7.28 报告 → 0.7.35 定案)**:

- **取证来源**:0.7.28 装的临时探针(`src/tok-probe.ts`)实际在真机跑过——`%TEMP%\usage-meter-tok-probe.log` 全文 **122,685 行 / 12.3 MB**(2026-10-19 09:59 → 10-21 19:13)。0.7.34 移除它的理由是"唯一本地文件写、违反零采集红线 + 只读旁路",**不是**"无数据";日志已保留,需要时可重新加装复现
- **门原因分布**:`not-running` 75,612 / `stale>4s` 7,820 / `samples<2` 3,004 / `ok` 465 / `gate(dt-or-zero)` 252 / `no-start` 42
- **`samples<2` 不是缺陷**:running 状态下该类心跳共 5,311 条,切成 1,594 个连续段——1,304 段 ≤3s(正常的首样本播种延迟),186 段 ≥10s(最长 272s)。对全部 ≥10s 段逐段统计,**没有任何一段期间出现过真实流式 delta**(段内 `deltas/s` 恒为 0)。即这些"长时间无速率"全部对应"确实没有 token 在产生"(工具执行 / 思考无输出),此时显示任何数值都是谎报
- **`stale>4s` 是设计契约**:4s 新鲜度门的正常表现,不是 bug
- **曾误判、已回滚的两个改动**:① 认为 `finishTurn` 删 `rates` 后 `rateStateOf` 惰性重建导致样本流永久断供——实测窗口样本数可达 80,不存在断供;② 为零基线补样本——会伪造一个不存在的坐标(声称 500ms 前已有 0 token),把速率虚增(如 40 token ÷ 0.5s = 80 tok/s),违反"tok/s 精度不可退步"红线,已回滚且未提交
- **产品层处理(0.7.35,用户拍板)**:不改 4s 门、不改样本数学,改为**沿用上次实时读数并以 DIM 属性淡化**。诚实性由两条约束保证:① 只在本轮曾有过读数时沿用,本轮尚无读数则整段省略;② 记忆按「会话 + 本轮 starting 时间戳」双键,跨轮不串值
- **衍生限制**:`lastLiveRates` 为插件实例生命周期内每会话一条(与 `sessionModels`/`syncedChildren` 同性质:会话数量级、零宿主句柄),不做清理
- **右栏未同步(有意)**:`sidebar-metrics.tsx` 仍按 `liveRate()` 有值才显示 ⚡,4s 间隙会整项消失;footer 与右栏在此处口径不同。若要统一,把同一 `coalesceFooterRuns` + 记忆逻辑复用过去即可(需另评右栏块的高度抖动代价)

**宿主依赖与生命周期**:

- stats 端点带 `experimental`,OpenCode 升级可能变动 → 全部调用收敛在 `statsCall()` 单函数,便于替换
- client 方法路径依赖宿主版本 → 防御式候选路径探测,运行时验证
- 全量查询 `models[]` 可能上百行(探活/失败请求 tokens 为 0)→ 按输出过滤排序,只显示 Top 5
- **`panel.open` 宿主假设(0.7.12 #6 修复的有意权衡,备查)**:`/usage-full` 按 `ui.panel.open` 返回 **boolean** 语义判断成败(`!== true` 即降级弹窗);若未来宿主改为返回 Promise(异步 open)或其他非 true 对象,命令会误入弹窗降级、出现"面板 + 弹窗双表面"。当前实证宿主(v2.0.21)返回 boolean;如遇异步宿主需改为 await/then 链
- **`void updateSettingsStore(...)` promise 拒绝未挂 catch(0.7.29 已修)**:0.7.29 起 `settings.ts` 三处 toggle 与 `calibration.ts` 的持久化写均已链 `.catch(console.error)`,宿主 storage 写失败不再产生 unhandledRejection 噪音。本条留作历史记录
- **热重载生命周期(0.7.3 真机实证)**:`plugin update` 只改磁盘包,运行中宿主仍持旧代码;`/reload` 拆掉旧实例定时器与订阅但不从磁盘重载插件——表现为计时冻结、tok/s 停更。**更新后必须完整重启 TUI**
- **`.tsx` 组件无单测覆盖(0.7.36 审视)**:`test/test-loader.mjs` 只补 `.ts` 解析,`footer-status.tsx` / `sidebar-metrics.tsx` 里的门与渲染逻辑无法被 93 个用例加载;0.7.36 修掉的两个"挂载期早返回门"因此活过了 0.7.8→0.7.35 多轮真机验收。当前回归手段是 `@opentui/solid` 渲染探针(临时脚本,不入库)

**未取证的宿主语义(0.7.36 全量审视;插件侧无法证明,结论按此假设成立)**:

1. `context.storage.store` 的 `update(draft => ...)` 是"延迟回调 + 顺序应用同一 live draft"还是"调用时快照 + 立即提交"——直接影响 0.7.31 连点修复与设置弹窗 `s` 键;当前按前者设计,并用 deferred 模型单测锁定
2. `session.step.ended.tokens.output` 是"消息累计"还是"按步计数"——直接影响 `adoptExact` 的 `out > 当前估算` 门槛与 `turnTotal`
3. `context.data.session.sync(id)` 的返回语义(Promise / boolean / 静默失败)——直接影响 0.7.32 的 `syncedChildren` 释放时机
4. `context.data.session.message.list(id)` 是否始终同步返回数组(当前按同步数组消费)
5. 宿主是否会在轮次结束后补发旧 assistant 的 `message.updated`——影响空闲 `⚡` 的归属(`onMessageUpdated` 目前不校验"是否最后一轮/最后一条")
6. `app` slot 的 render 调用频率(一次 vs 多次)——0.7.36 的 keymap layer 5s 退避重试依赖它被重复调用;若宿主只调用一次,首次失败仍会整场失效,届时应改用受 release 管理的定时器
7. `session.text.delta` 与 `session.step.ended` 的 `assistantMessageID` 是否严格一致——不一致时同一输出会落 `_anon` 与实名两个桶,造成 est + exact 双计
8. `session.status()` 的返回形态(当前按字符串 `"running"` 判断)
9. `session.panel` slot 在 `panelAPI.close()` 后是否还会再渲染一次——0.7.36 起自关分支主动释放 `f` 层,不再依赖这一行为;若宿主确实重渲一次,`disposeFullscreenLayer()` 幂等,无副作用

**刻意不改项(0.7.36 审视结论,避免后续重复排查)**:

- `fetchToday` 在 `statsBusy` 时丢弃刷新(与 0.7.33 修过的 `fetchRange` 不同):60s tick 自愈,无数据丢失
- 子会话 `sync()` 失败无退避(面板打开期间每 500ms 重试):仅在面板打开时发生;若日志刷屏再加时间戳退避
- `ensureDetail` 允许并发调用:后返回者覆盖前者,聚合结构不会被破坏,下次刷新自愈
- `statsSource.release()` 不取消在飞请求、不清 `panelRefresh`:teardown 后最多多写一次只读结果
- `reactive-mount` 的 `dispose` / `release` 为空实现:正常路径已由宿主 computation 的 dispose 覆盖(探针实证旧 box children 1→0 且脱离父节点);"宿主注销 slot 但保留节点"未观测到
- `lastDurations` / `lastExactRates` / `lastAvgRates` / `backfillLastAttemptAt` 的 per-session Map 终身增长:与 `sessionModels` / `syncedChildren` 同性质(会话数量级、零宿主句柄)
- `backfillLastTurn` 成功路径会第二次调用 `message.list`:冗余但已被测试锁定,无正确性问题
- 右栏在 4s 间隙仍整项隐藏 ⚡(与 footer 的 DIM 淡化策略不同):统一需另评块高抖动代价,见上方 0.7.35 条目
