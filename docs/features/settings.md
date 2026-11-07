# /usage-settings 设置弹窗

可扩展的用量设置入口(0.6.7 引入),命令同时进命令面板("用量设置(footer 指标维度等)")。

## 配置项(五项)

| 键 | 配置项 | 默认 | 说明 |
|---|---|---|---|
| `d` | hit 维度 | 今日汇总 | `今日汇总`(全 session 日级 `read ÷ (read+input)`)⇄ `当前会话`(严格口径 `read ÷ (input+read+write)`,显示为 `hit·s`) |
| `s` | Σ/📊 总耗维度(0.7.7) | 今日 | 今日(本地零点起)→ 近24小时 → 近7日 → 近30日 滚动窗口循环;footer Σ / 右栏 📊 / 面板头部共用;非今日时强制显示范围标签;0.7.12 起切换即触发该维度拉取(不等 60s 周期),0.7.13 起按切换后的目标维度显式拉取(消除与 store 异步写落地的竞态),**0.7.33 起在途抓取未回来时再次切换不再被丢弃**——记住最新请求的维度,在途调用 settle 后自动补抓一次(只保留最新,中间维度无需排队) |
| `f` | footer Σ 段 | 关 | 0.7.0 起默认关,opt-in |
| `h` | footer hit 段 | 关 | 0.7.0 起默认关,opt-in |
| `b` | 右栏指标块 | 开 | 见 [sidebar-stats.md](sidebar-stats.md) |

`Esc` 关闭;全部选择自动持久化,弹窗内状态响应式刷新(响应式 store 宿主上 signal 直读即时刷新;非响应式 store 宿主由 memo 内无条件 `now()` 读取兜底,0.7.13 补齐,≤500ms 内可见)。各指标何时显示/隐藏的一页速查 → [display-logic.md](display-logic.md)

## 持久化机制

`storage.store("usage-meter.settings")`,官方 storage API,跨重启、跨 TUI 实例同步。旧版本存储缺新键时,读取器按文档默认值归一(footer 两键缺=关,sidebar 缺=开),无需迁移。

**0.7.31 连点竞态修复**:toggle 改为在 store 写入回调里读取 draft 的当前值再取反(`typeof liveValue === "boolean" ? liveValue : currentValue`,缺键时回落到调用方归一化值)。此前接收调用方快照、在写入前先取反——store 写入是异步的,两次点击落在首次提交前会读到同一旧值、写两次相同结果,表现为"点了没反应"。`toggleHitScope`/`cycleTotalScope` 同步改用 draft 值。

## 为什么走"命令 + storage"而非配置文件

历史实证基准 v2.0.21 宿主无插件 options 配置通道(dev 的 `{package, options}` 不回传插件,已取证),故配置经命令修改 + storage 持久化自洽。宿主就绪后可加配置文件直读,见 [roadmap.md](../decisions/roadmap.md)。

## 兜底

命令面板另有"切换 hit 维度"直切命令(带 toast 反馈),防个别宿主弹窗内 keybind 注册失败。
