# Changelog / 变更记录

dsh-skill-mcp-manager 的版本变更与 DeepSeek Harness 适配记录。
Version history and DeepSeek Harness compatibility record for dsh-skill-mcp-manager.

| Plugin | DSH baseline            | cordis |
| ------ | ----------------------- | ------ |
| 0.3.0  | `0.1.7-alpha.2`         | 4.0.4  |
| 0.2.0  | `0.1.5-rc.1` (rc.2 pkgs)| 4.0.2  |
| 0.1.0  | `0.1.0-rc.6`            | 4.0.1  |

[中文](#中文) · [English](#english)

---

## 中文

### 0.3.0 — 适配 `@deepseek-ai/dsh` 0.1.7-alpha.2(cordis 4.0.4)

基准:`@deepseek-ai/dsh` **0.1.7-alpha.2**,cordis **4.0.4**(上一版按 `0.1.5-rc.1` / cordis `4.0.2` 编写)。

本轮唯一的**破坏性变更**:客户端会话 API 重构。

- **`ctx.sessions.list` 不再是「列表 + 当前选中」**。0.1.7 把选中态移出了会话域——`SessionListState` 现在只有 `{ ids, byId, phase, projectionsBySession }`,原来的 `current` 字段连同 `open()` / `clear()` 一起消失,文档写明 *"view selection remains outside the Controller"*。插件原先读 `getSnapshot().current` 取当前会话,在 0.1.7 上恒为 `undefined`,设置页会一直停在「需要先打开一个会话」。
  现改为读取**被主视图保留**的那一行:`Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)`,并用 `state.phase === "ready"` 作为首次拉取的闸门(否则列表尚未就绪时会误报「没有会话」)。这正是官方 0.1.7 的写法——`ui-layout`、`ui-cordis`、`ui-workspace`(4 处)、`ui-session`、`ui-agent-preset`、`settings-general` 共 8 处客户端代码都在用同一读法。`SessionSummary.cwd` 仍然存在,继续用于带出项目级技能根。
- **设置分区顺序号**。0.1.7 新增了 `agent-presets` 分区(order `20`),与插件原来的 `20` 相撞(同 order 只能靠注册顺序决定先后)。现改为 `25`,排在全部官方分区(account `-10` / general `0` / models `10` / plugins `15` / agent-presets `20`)之后。
- **`dsh.client.inject` 去掉 `@deepseek-ai/dsh-api-remotes`**。该行原本是为 `remote` 服务预取;上一版改用自有 Fetch 路由后客户端已不再消费任何 Remote 服务,留着是死条目。现仅保留实际提供 `slots` / `locale` / `connection` / `sessions` / `settings.section` 的五个包。
- **peerDependencies** 更新为 `^0.1.7-alpha.2`,cordis `~4.0.4`,`@deepseek-ai/schemastery` `~3.18.4`。

核对后确认**未变化**、因此本插件不改:host 端的 `defineTool`(`parameters` / `output.render` / `presentCall`)、`ctx.commands.register` 与 `CommandInvocation`、`ctx.systemPrompt.section` 与 `SECTION_ORDERS`(`TOOL_REPORT = 2900` / `TOOLS_SDK = 5000`,故 `2905` 仍正确)、`ctx.skills.list/get` 的 `SkillSummary` / `SkillDefinition`(0.1.7 只是把 `path` 上移为可选字段,属放宽)、`ctx.loader` 的 `entries/resolve/update` 与 `Entry.options/disabled/fiber`、`fs/observed` 事件形状、`dsh-skill-filesystem` 的根配置项、`dsh-mcp-client` 的 `Config` 联合与 `serverName` 正则、`ctx.agents.get(sessionId)`、profile 补丁层(`cordis:include` + 同目录 `cordis.patch.yml`);客户端侧的 `settings.section` + `children` 注册协议、`ctx.slots.*`(`register` 选项集未变)、`ctx.locale.register/bind`、`ConnectionFetchRoute`(`path` / `methods` / `requestBody` / `fetch`)——`/api` 前缀路由改为 `connection.admit(req)` + `connection/request` waterfall,但信任栅栏与浏览器令牌校验仍在路由之前,本插件的 Fetch 路由依旧只会在已认证请求下执行(未认证实测返回 401)。cordis `Fiber.State` 编号(`DISPOSED=4` / `UNLOADING=5`)在 4.0.4 未变。

顺带记录一个与插件无关、但验证时踩到的 0.1.7 线格式变化:`__DSH_BOOT__` 图行里的 `url` 从 `/plugins/…` 变成了相对路径 `plugins/…`(由宿主负责服务,bundle 不需要感知)。

### 0.2.0 — 适配 `@deepseek-ai/dsh` 0.1.5-rc.1(cordis 4.0.2)

基准:`@deepseek-ai/dsh` **0.1.5-rc.1**,`@deepseek-ai/dsh-*` 运行时包 **0.1.5-rc.2**,cordis **4.0.2**(上一版按 `0.1.0-rc.6` / cordis `4.0.1` 编写)。

逐项核对后修正的问题:

1. **设置页不再把命令记录写进会话**。原先设置页走 `ctx.remote.commands.execute(sessionId, "/skill-mgr …")`;每次命令调用都会向会话日志追加一对 `command/run` + `command/done`,而 `command/done` 的 `text` 正是命令返回的整段 JSON,聊天区因此把它渲染成一条永久的 `skill-mgr · {"skills":[…]}` / `mcp-mgr · {"servers":[]}` 行。设置页挂载时读取一次、每次改动后再刷新,所以一次设置访问就留下好几条大 JSON 行。现已改为插件自己的受认证 Fetch 路由 `/api/dsh-skill-mcp-manager`(11 个端点),**完全不产生会话事件**;同时移除了仅供该页使用的 `/skill-mgr`、`/mcp-mgr` 命令(它们会出现在斜杠菜单里,手动调用同样污染日志)。注意:旧版本已经写进日志的行属于会话历史,不会被改写,只影响之后再产生的输出。
2. **设置页数据桥调用缺少必填参数(同一处代码的功能性缺陷)**。`@deepseek-ai/dsh-commands` 的生成式 Remote 描述符把 `execute` 签名定为 `execute(agentId, line, submittedAttachments, signal?)`,其中 `submittedAttachments` 是 `source: 'json'` + `codec.mode: 'strict'` 的 **数组必填参数**:只传两个参数的调用会在到达宿主 handler 之前被参数校验直接拒绝。该路径现已整体删除(见上一条),取而代之的路由不受此约束。
3. **fiber 状态标签错位**。cordis 的 `Fiber.State` 为 `PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5`,旧的位置式映射把 `DISPOSED` 显示成 `unloading`、且完全没有处理 `UNLOADING=5`。现改为按状态常量建表,并与 `@deepseek-ai/dsh-host-plugin-inventory` 的公开投影保持一致(`DISPOSED → null`,即「没有存活实例」),未知数值降级为 `state:<n>`。
4. **技能根目录改为读取 provider 自身配置**。`@deepseek-ai/dsh-skill-filesystem` 的根集合是可配置的(`includeDefaultRoots` / `dshHome` / `agentsHome` / `customSkillDirs` / `bundledSkillDir`),旧代码硬编码四个默认根,一旦 profile 覆盖其中任一项,`skill_manager_roots` 的描述就会与实际扫描不符,且 `skill_manager_create root: "user"` 会写到 provider 根本不扫描的目录。现从 loader 中该 provider 条目的 `config` 推导根列表(含 `custom` 与只读的 `bundled`),`skill_manager_roots` 增加 `writable` 字段,扫描顺序与 provider 一致。
5. **引导段落顺序号过期**。`@deepseek-ai/dsh-system-prompt` 的 `SECTION_ORDERS` 已改为 500~10200 量级(工具段落在 1000~2900),旧的 `115` 会把管理说明排到 harness 身份说明之前;现取 `2905`,紧跟工具指引区块(`TOOL_REPORT = 2900`)。
6. **`dsh.client.inject` 指向已删除的包**。原清单中的 `@deepseek-ai/dsh-client-runtime` 在当前版本已不存在(该包不再发布);改为实际提供本插件所依赖服务的包。缺失的 inject 行本身只是「不预取」,不会致命,但会失去加载顺序保障。
7. **peerDependencies 版本区间**更新为 `^0.1.5-rc.1`(cordis `^4.0.2`),`@deepseek-ai/schemastery` 依赖升到 `^3.18.2`。

**为什么用 Fetch 路由而不是 `connection.rpc.handle`**:`HostConnectionService.rpc` 的 getter 读 `this.ctx`,而 cordis 会把服务 getter 里的上下文读取**绕回服务自己的 fiber**,于是 `rpc.handle` 内部的 `owner.webServer.register(...)` 在任何插件上下文里都解析不到 `webServer`(实测报 `cannot get property "webServer" without inject`)。`/api` Fetch 路由没有这个依赖:`connection.fetch.register` 只写服务自身的路由表,而分发它的 `/api` 前缀路由已经先做了信任栅栏与浏览器会话校验。线上同类实现见 `@deepseek-ai/dsh-client-ui-deliverables` 的 `/api/present.open`。

**一直未变的契约**:`defineTool` 的 `parameters` / `output.render` / `presentCall` 形状;`ctx.commands.register` 的 `CommandDefinition`(含 `recordInput`)与 `CommandInvocation`;`ctx.systemPrompt.section`;`ctx.skills.list/get` 的 `SkillSummary` / `SkillDefinition`(`invocation` / `source` / `provider` / `path` / `metadata` / `content`);`fs/observed` 事件的 `(target.displayPath, _observation, actor.name)` 形状与 `edit`/`write` 判定;`ctx.loader` 的 `entries/resolve/create/update/remove` 与 `Entry.options/disabled/fiber`;`@deepseek-ai/dsh-mcp-client` 的 `Config` 联合类型、`serverName` 正则与 `reconnect.*` 字段;profile 补丁层仍是 `cordis:include` 条目旁的同目录 `cordis.patch.yml`;客户端 `settings.section` + `children` 子槽位注册协议、`ctx.slots.*`、`ctx.locale.*` 与 `settings.section` 的 `hooks.tabs` 形状;以及 `connection.fetch` 精确路由契约(`path` 必须形如 `/api/<segment>`、`methods`、`requestBody`、`fetch(request) => Promise<Response>`)。

### 0.1.0 — 初版

面向 `@deepseek-ai/dsh` **0.1.0-rc.6**(cordis **4.0.1**):`skill_manager_*` / `mcp_manager_*` 工具、`/skills` 与 `/mcp` 命令、MCP 条目写入 profile 补丁层,以及 Web 设置页(技能 / MCP 两个标签页)。

---

## English

### 0.3.0 — `@deepseek-ai/dsh` 0.1.7-alpha.2 (cordis 4.0.4)

Baseline: `@deepseek-ai/dsh` **0.1.7-alpha.2**, cordis **4.0.4** (the previous revision targeted `0.1.5-rc.1` / cordis `4.0.2`).

One breaking change reached this plugin: the client session API was redesigned.

- **`ctx.sessions.list` is no longer "catalog plus current selection".** 0.1.7 moved selection out of the sessions domain: `SessionListState` is now `{ ids, byId, phase, projectionsBySession }`, the `current` field is gone along with `open()`/`clear()`, and the contract states that "view selection remains outside the Controller". The plugin read `getSnapshot().current`, which is now always `undefined` — the settings page would have sat on "open a session first" forever.
  It now reads the row the **main view retains**: `Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)`, gated on `state.phase === "ready"` so a catalog that has not finished its first pull reports "no session" rather than "none selected". This is the shipped 0.1.7 idiom — eight first-party client sites use it (`ui-layout`, `ui-cordis`, `ui-workspace` ×4, `ui-session`, `ui-agent-preset`, `settings-general`). `SessionSummary.cwd` still exists and still supplies the project skill roots.
- **Settings section order.** 0.1.7 added an `agent-presets` section at order `20`, colliding with this plugin's `20` (equal orders fall back to registration order). It is now `25`, after every shipped section (account `-10`, general `0`, models `10`, plugins `15`, agent-presets `20`).
- **`dsh.client.inject` dropped `@deepseek-ai/dsh-api-remotes`.** That row existed to pre-arrive the `remote` service; since the previous revision this bundle consumes no Remote service at all, so it was dead weight. The list now names only the packages that actually provide `slots`/`locale`/`connection`/`sessions` and declare `settings.section`.
- **peerDependencies** moved to `^0.1.7-alpha.2` (cordis `~4.0.4`) and `@deepseek-ai/schemastery` to `~3.18.4`.

Audited and left unchanged: the host-side `defineTool` (`parameters`/`output.render`/`presentCall`), `ctx.commands.register` and `CommandInvocation`, `ctx.systemPrompt.section` and `SECTION_ORDERS` (`TOOL_REPORT = 2900`/`TOOLS_SDK = 5000`, so `2905` still lands correctly), `ctx.skills.list/get`'s `SkillSummary`/`SkillDefinition` (0.1.7 only widened `path` to an optional `SkillSummary` field), `ctx.loader`'s `entries/resolve/update` and `Entry.options`/`disabled`/`fiber`, the `fs/observed` payload, `dsh-skill-filesystem`'s root config keys, the `dsh-mcp-client` `Config` union and `serverName` pattern, `ctx.agents.get(sessionId)`, and the profile patch layer (`cordis:include` + the sibling `cordis.patch.yml`); client-side the `settings.section` + `children` registration protocol, `ctx.slots.*` (the `register` option set is unchanged), `ctx.locale.register/bind`, and `ConnectionFetchRoute` (`path`/`methods`/`requestBody`/`fetch`) — the `/api` prefix route now uses `connection.admit(req)` plus a `connection/request` waterfall, but the trust fence still runs before dispatch, so this plugin's route only ever executes for authenticated requests (401 verified). cordis `Fiber.State` numbering (`DISPOSED=4`/`UNLOADING=5`) is unchanged in 4.0.4.

Incidental wire change noticed while verifying (not something the plugin touches): the `__DSH_BOOT__` graph row's `url` is now relative (`plugins/…`) instead of root-absolute (`/plugins/…`); the host serves it either way.

### 0.2.0 — `@deepseek-ai/dsh` 0.1.5-rc.1 (cordis 4.0.2)

Baseline: `@deepseek-ai/dsh` **0.1.5-rc.1** with `@deepseek-ai/dsh-*` runtime packages **0.1.5-rc.2** and cordis **4.0.2** (the revision before that targeted `0.1.0-rc.6` / cordis `4.0.1`).

1. **The settings page no longer writes command records into the session.** It used `ctx.remote.commands.execute(sessionId, "/skill-mgr …")`, and every command invocation appends a `command/run` + `command/done` pair whose `command/done` text is the command's whole JSON result — so the chat rendered a permanent `skill-mgr · {"skills":[…]}` / `mcp-mgr · {"servers":[]}` row. The page lists on mount and refreshes after every mutation, so one settings visit left several large JSON rows in the conversation. It now uses the plugin's own authenticated Fetch route `/api/dsh-skill-mcp-manager` (11 endpoints) and produces **no session events at all**; the `/skill-mgr` and `/mcp-mgr` commands that existed only to serve it are gone too (they also appeared in the slash menu, where a manual invocation polluted the log the same way). Rows already written by an older revision are session history and are not rewritten.
2. **The settings bridge dropped a required argument (same code path).** The generated Remote descriptor for `@deepseek-ai/dsh-commands#commands/execute` is `execute(agentId, line, submittedAttachments, signal?)`, where `submittedAttachments` is a required strict array parameter — a two-argument call was rejected by argument validation before reaching the host handler. That path is now deleted entirely; the replacement route has no such constraint.
3. **Fiber phase labels were misaligned.** cordis numbers `Fiber.State` as `PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5`; the old positional table reported a disposed entry as `unloading` and had no case for `UNLOADING=5`. Labels are now keyed by the state constants and mirror `@deepseek-ai/dsh-host-plugin-inventory`'s public projection (`DISPOSED → null`), with unknown values degrading to `state:<n>`.
4. **Skill roots are read from the provider's own config.** `@deepseek-ai/dsh-skill-filesystem` exposes `includeDefaultRoots`/`dshHome`/`agentsHome`/`customSkillDirs`/`bundledSkillDir`, so a hardcoded root list could disagree with discovery — and `skill_manager_create root: "user"` could write somewhere the provider never scans. The manager now derives the list from the mounted provider entries (including `custom` and the read-only `bundled` root) in the provider's scan order, and `skill_manager_roots` reports `writable`.
5. **Guidance section order was stale.** `@deepseek-ai/dsh-system-prompt`'s `SECTION_ORDERS` moved to the 500–10200 range (tool sections at 1000–2900), so the old `115` sorted the manager note ahead of the harness identity. It now uses `2905`, just after the tool-guidance block (`TOOL_REPORT = 2900`).
6. **`dsh.client.inject` named a removed package.** `@deepseek-ai/dsh-client-runtime` is no longer published; the list now names the packages that actually provide this client's services. A missing inject row is not fatal, but it silently drops the load-order guarantee.
7. **peerDependencies** moved to `^0.1.5-rc.1` (cordis `^4.0.2`) and `@deepseek-ai/schemastery` to `^3.18.2`.

**Why a Fetch route and not `connection.rpc.handle`.** `HostConnectionService.rpc`'s getter reads `this.ctx`, and cordis routes a service getter's context reads back through the **service's own** fiber — so `rpc.handle`'s internal `owner.webServer.register(...)` cannot resolve `webServer` from any plugin context (`cannot get property "webServer" without inject`, verified on a live `dsh web`). `/api` Fetch routes have no such dependency: `connection.fetch.register` only writes into the service's own route table, and the `/api` prefix route that dispatches it already applies the trust fence and the browser-session check. The equivalent first-party implementation is `dsh-client-ui-deliverables`.

**Contracts unchanged across revisions.** The `defineTool` `parameters`/`output.render`/`presentCall` shapes; `ctx.commands.register`'s `CommandDefinition` (including `recordInput`) and `CommandInvocation`; `ctx.systemPrompt.section`; `ctx.skills.list/get`'s `SkillSummary`/`SkillDefinition`; the `fs/observed` payload and `edit`/`write` actor check; `ctx.loader`'s `entries/resolve/create/update/remove` and `Entry.options`/`disabled`/`fiber`; the `@deepseek-ai/dsh-mcp-client` `Config` union, `serverName` pattern, and `reconnect.*` fields; the profile patch layer (`cordis.patch.yml` beside the `cordis:include` entry); the client-side `settings.section` + `children` registration protocol, `ctx.slots.*`, `ctx.locale.*`, and the `hooks.tabs` shape; and the `connection.fetch` exact-route contract (`path` shaped `/api/<segment>`, `methods`, `requestBody`, `fetch(request) => Promise<Response>`).

### 0.1.0 — initial release

Targeted `@deepseek-ai/dsh` **0.1.0-rc.6** (cordis **4.0.1**): the `skill_manager_*` / `mcp_manager_*` tools, the `/skills` and `/mcp` commands, MCP entries persisted into the profile patch layer, and the Web settings section with its Skills and MCP tabs.
