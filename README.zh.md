# dsh-skill-mcp-manager

[English](README.md)

DeepSeek Harness(DSH)插件:在会话内直接管理 Harness 的 **Skill** 和 **MCP 服务器**,并提供 **Web 设置页可视化界面**。

> **兼容版本**:已按 `@deepseek-ai/dsh` **0.1.5-rc.1**(cordis **4.0.2**)逐项核对并修正,改动见文末「版本适配记录」。

- **Skill**:列出、查看、创建、更新、删除 Harness 技能(写入 provider 根目录的 `SKILL.md` bundle,文件系统 watcher 即时生效)。
- **MCP**:列出、查看、添加、更新、移除、重载 MCP 服务器(操作 loader 中的 `@deepseek-ai/dsh-mcp-client` 条目,热插拔并持久化到 profile 配置)。
- **设置页 UI**(`dsh web`):设置 → "技能与 MCP" 分区,含 **技能** 与 **MCP** 两个标签页,可视化列表与表单,支持创建/编辑/删除/重载;所有流量走插件自己的受认证 Fetch 路由,**操作设置页不会在对话里留下任何记录**。

## 安装

```bash
# 在仓库根目录执行；相对路径会锚定到当前目录
dsh plugin --profile web add ".\dsh-skill-mcp-manager"
```

包内 `cordis.patch.yml` 声明了 `dsh.bundle`,安装后会自动作为 bundle 层插入 `skill-mcp-manager` 条目;`package.json` 另声明 `dsh.client`(web 平台),web 启动时 `dsh-client-modules` 会把 `lib/client.js` 加入 boot 图并通过 `/plugins/dsh-skill-mcp-manager/client.js` 提供。**重启 `dsh web` 后生效**(设置页需要 web 界面)。

## 设置页可视化

重启 `dsh web` 后,打开 **设置(齿轮)** → 左侧新增 **"技能与 MCP"** 分区:

- **技能标签页**:列出全部技能(名称 / 描述 / 来源 / 调用策略徽标),支持新建(选择用户级或项目级根)、编辑正文与 frontmatter、删除(带确认)。
- **MCP 标签页**:列出服务器(名称 / 传输方式 / 启用状态 / fiber 状态 / 工具数),支持添加(stdio 或 streamable-http 表单)、编辑、重载、删除(带确认)。
- 环境变量与请求头等敏感值不会回显;编辑时留空表示保持不变。
- 所有读写都经由插件自己的**受认证 Fetch 路由** `/api/dsh-skill-mcp-manager`(位于 Connection 的 `/api` 前缀之下,由它负责 Host/Origin 信任栅栏与浏览器会话校验),**不会在会话里留下任何记录**:设置页打开时读取一次、每次改动后再刷新,若改走命令桥(`commands.execute`)会为每次调用写入一对 `command/run` + `command/done`,其文本正是命令返回的整段 JSON,于是在对话里表现为一条永久的 `skill-mgr · {"skills":[…]}` 大行。打开设置页前需要有一个当前会话——会话身份随请求带给宿主,用于定位工作目录与技能层。

## 提供的工具

### Skill 管理(`skill_manager_*`)

| 工具 | 作用 |
|---|---|
| `skill_manager_list` | 列出当前会话可见的全部技能:名称、描述、来源根、provider、模型/用户调用策略 |
| `skill_manager_get` | 获取单个技能的完整定义:正文、绝对路径、来源、策略、metadata |
| `skill_manager_roots` | 展示文件系统 provider 实际扫描的技能根目录:来源、路径、是否存在、是否可写入(读取 provider 自身配置,`dshHome` / `agentsHome` / `customSkillDirs` / `bundledSkillDir` 覆盖都会反映出来) |
| `skill_manager_create` | 创建技能为 `<root>/<name>/SKILL.md`;名称需为 kebab-case,`root` 支持 `user` / `project` / 绝对路径 |
| `skill_manager_update` | 原地更新技能的前置元数据与正文;省略字段保持不变,传 `null` 删除 `when_to_use` / `metadata` |
| `skill_manager_delete` | 删除技能(文件或整个 bundle 目录);**破坏性操作,需 `confirm: true`** |

技能文件格式与 `@deepseek-ai/dsh-skill-filesystem` 完全一致(`---` 包裹的 YAML frontmatter:`name` / `description` / `whenToUse` / `disable-model-invocation` / `user-invocable` / `metadata`)。

### MCP 管理(`mcp_manager_*`)

| 工具 | 作用 |
|---|---|
| `mcp_manager_list` | 列出全部 MCP 服务器:条目 id、serverName、传输方式、端点、启用状态、fiber 阶段、已发布工具数 |
| `mcp_manager_get` | 获取单个服务器的完整配置(env/headers 以表达式引用形式脱敏展示)与实时状态 |
| `mcp_manager_add` | 添加服务器(stdio 或 streamable-http),立即激活并持久化 |
| `mcp_manager_update` | 更新服务器配置(含切换传输方式、改名 serverName),热重启生效 |
| `mcp_manager_reload` | 强制断开重连并重新发现工具 |
| `mcp_manager_remove` | 移除服务器;**破坏性操作,需 `confirm: true`** |

MCP 配置字段与 `@deepseek-ai/dsh-mcp-client` 文档一致:`transport` / `serverName` / `command` / `args` / `env` / `cwd` / `url` / `headers` / `toolCallTimeoutMs` / `failOnStartupError` / `reconnect.*`。`serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}` 且全局唯一。

## 人类命令

- `/skills` — 直接列出当前技能(不经模型)。
- `/mcp` — 直接列出 MCP 服务器与状态。

> 设置页**不**使用命令:`commands.execute` 每次调用都会向会话日志追加 `command/run` + `command/done`,聊天区会把它渲染成一条永久的 `skill-mgr · {…}` 行。设置页改走下述私有通道,因此这些行不会再出现(旧版本已写入日志的行属于会话历史,不会被改写)。

## 配置

在 profile 的 `cordis.patch.yml` 中可覆盖:

```yaml
- id: skill-mcp-manager
  config:
    mcpPlugin: '@deepseek-ai/dsh-mcp-client' # 管理的 MCP 插件条目名
    skillDefaultRoot: user                   # 新建技能默认根:user | project
```

## 工作原理

- **Skill**:所有读写都发生在 provider 扫描的根目录内;写入后插件通过 `fs/observed` 事件同步通知 provider 失效,下一次 `ctx.skills` 观测即可见。
- **MCP**:通过 profile 的用户补丁层 `cordis.patch.yml`(`dsh --profile` 每次启动都读取、且不会被重置的文件)持久化 MCP 服务器条目:增删改会原子重写该文件中的 `insert` 列表,并由补丁层 HMR watcher 热重排 loader 树,因此**重启 `dsh web` 后服务器依然保留**。若补丁层不可达(如测试 mock),则回退为仅热插拔的 `ctx.loader` 操作。
- **设置页数据通道**:宿主在 `ctx.inject(["connection"], …)` 中调用 `ctx.connection.fetch.register({ path: "/api/dsh-skill-mcp-manager", methods: ["POST"], requestBody: "buffered", fetch })` 注册一条**受认证 Fetch 路由**;浏览器侧用普通的同源 `fetch("/api/dsh-skill-mcp-manager", {method:"POST"})` 调用,请求体为 `{ endpoint, payload }`,响应为 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`。端点:`skill.snapshot` / `skill.get` / `skill.create` / `skill.update` / `skill.delete` / `mcp.snapshot` / `mcp.get` / `mcp.add` / `mcp.update` / `mcp.remove` / `mcp.reload`。路由不写任何会话事件,响应中的 env/headers 值脱敏为 `**redacted**`。请求体携带 `sessionId`(及会话摘要里的 `cwd`),宿主据此解析出存活 Agent 以还原技能作用域与工作目录;两者都缺失时退化为全局技能层 + 用户级根。之所以用 Fetch 路由而不是 `connection.rpc.handle`,是因为后者会通过 Connection 服务自身的上下文中转 `webServer` 读取,而该上下文看不到 `webServer`(cordis 会把服务 getter 里 `this.ctx` 的读取绕回服务自己的 fiber);Fetch 路由注册表只写服务自身的表,没有这一依赖。`/api` 前缀路由先做信任栅栏与浏览器令牌校验,未认证请求返回 401。
- **客户端提供**:`dsh-client-modules` 扫描到本包的 `dsh.client` 声明后,把 `lib/client.js` 编入 boot 图并服务 `/plugins/dsh-skill-mcp-manager/client.js`,浏览器侧 Cordis 以普通插件条目应用它,注册 `settings.section`("技能与 MCP")与两个标签页。无需重新构建 DSH 前端。

## 开发

```bash
node test/smoke.mjs         # 宿主端:12 个工具、/skills 与 /mcp、Settings 路由全部端点(需 @deepseek-ai 依赖)
node test/client-smoke.mjs  # 客户端 bundle:加载、apply、插槽注册、路由调用与"绝不写会话日志"断言
```

## 版本适配记录

基准:`@deepseek-ai/dsh` **0.1.5-rc.1**,`@deepseek-ai/dsh-*` 运行时包 **0.1.5-rc.2**,cordis **4.0.2**(上一版按 `0.1.0-rc.6` / cordis `4.0.1` 编写)。

逐项核对后修正的问题:

1. **设置页不再把命令记录写进会话(本次修复的 UI 现象)**。原先设置页走 `ctx.remote.commands.execute(sessionId, "/skill-mgr …")`;每次命令调用都会向会话日志追加一对 `command/run` + `command/done`,而 `command/done` 的 `text` 正是命令返回的整段 JSON,聊天区因此把它渲染成一条永久的 `skill-mgr · {"skills":[…]}` / `mcp-mgr · {"servers":[]}` 行。设置页挂载时读取一次、每次改动后再刷新,所以一次设置访问就留下好几条大 JSON 行。现已改为插件自己的受认证 Fetch 路由 `/api/dsh-skill-mcp-manager`(11 个端点),**完全不产生会话事件**;同时移除了仅供该页使用的 `/skill-mgr`、`/mcp-mgr` 命令(它们会出现在斜杠菜单里,手动调用同样污染日志)。注意:旧版本已经写进日志的行属于会话历史,不会被改写,只影响之后再产生的输出。
2. **设置页数据桥调用缺少必填参数(同一处代码的功能性缺陷)**。当前 `@deepseek-ai/dsh-commands` 的生成式 Remote 描述符把 `execute` 签名定为 `execute(agentId, line, submittedAttachments, signal?)`,其中 `submittedAttachments` 是 `source: 'json'` + `codec.mode: 'strict'` 的 **数组必填参数**:只传两个参数的调用会在到达宿主 handler 之前被参数校验直接拒绝。该路径现已整体删除(见上一条),取而代之的路由不受此约束。
3. **fiber 状态标签错位**。cordis 4.0.2 的 `Fiber.State` 为 `PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5`,旧的位置式映射把 `DISPOSED` 显示成 `unloading`、且完全没有处理 `UNLOADING=5`。现改为按状态常量建表,并与 `@deepseek-ai/dsh-host-plugin-inventory` 的公开投影保持一致(`DISPOSED → null`,即"没有存活实例"),未知数值降级为 `state:<n>`。
4. **技能根目录改为读取 provider 自身配置**。`@deepseek-ai/dsh-skill-filesystem` 的根集合是可配置的(`includeDefaultRoots` / `dshHome` / `agentsHome` / `customSkillDirs` / `bundledSkillDir`),旧代码硬编码四个默认根,一旦 profile 覆盖其中任一项,`skill_manager_roots` 的描述就会与实际扫描不符,且 `skill_manager_create root: "user"` 会写到 provider 根本不扫描的目录。现从 loader 中该 provider 条目的 `config` 推导根列表(含 `custom` 与只读的 `bundled`),`skill_manager_roots` 增加 `writable` 字段,扫描顺序与 provider 一致。
5. **引导段落顺序号过期**。`@deepseek-ai/dsh-system-prompt` 的 `SECTION_ORDERS` 已改为 500~10200 量级(工具段落在 1000~2900),旧的 `115` 会把管理说明排到 harness 身份说明之前;现取 `2905`,紧跟工具指引区块(`TOOL_REPORT = 2900`)。
6. **`dsh.client.inject` 指向已删除的包**。原清单中的 `@deepseek-ai/dsh-client-runtime` 在当前版本已不存在(该包不再发布);现改为实际提供本插件所依赖服务的包:`dsh-api-remotes` / `dsh-api-session-controller`(`sessions`)/ `dsh-client-connection`(`connection`)/ `dsh-client-locale`(`locale`)/ `dsh-client-ui-renderer`(`slots`)/ `dsh-client-ui-settings`(`settings.section` 声明)。缺失的 inject 行本身只是"不预取",不会致命,但会失去加载顺序保障。
7. **peerDependencies 版本区间**更新为 `^0.1.5-rc.1`(cordis `^4.0.2`),`@deepseek-ai/schemastery` 依赖升到 `^3.18.2`。

核对后确认**未变化**、因此保持原样契约:`defineTool` 的 `parameters` / `output.render` / `presentCall` 形状;`ctx.commands.register` 的 `CommandDefinition`(含 `recordInput`)与 `CommandInvocation`;`ctx.systemPrompt.section`;`ctx.skills.list/get` 的 `SkillSummary` / `SkillDefinition`(`invocation` / `source` / `provider` / `path` / `metadata` / `content`);`fs/observed` 事件的 `(target.displayPath, _observation, actor.name)` 形状与 `edit`/`write` 判定;`ctx.loader` 的 `entries/resolve/create/update/remove` 与 `Entry.options/disabled/fiber`;`@deepseek-ai/dsh-mcp-client` 的 `Config` 联合类型、`serverName` 正则与 `reconnect.*` 字段;profile 补丁层仍是 `cordis:include` 条目旁的同目录 `cordis.patch.yml`;客户端 `settings.section` + `children` 子槽位注册协议、`ctx.slots.*`、`ctx.locale.*` 与 `settings.section` 的 `hooks.tabs` 形状;以及 `connection.fetch` 精确路由契约(`path` 必须形如 `/api/<segment>`、`methods`、`requestBody`、`fetch(request) => Promise<Response>`)——官方同类实现见 `@deepseek-ai/dsh-client-ui-deliverables` 的 `/api/present.open`。

## 许可

MIT
