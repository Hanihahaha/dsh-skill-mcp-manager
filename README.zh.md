# dsh-skill-mcp-manager

[English](README.md)

DeepSeek Harness(DSH)插件:在会话内直接管理 Harness 的 **Skill** 和 **MCP 服务器**,并提供 **Web 设置页可视化界面**。

- **Skill**:列出、查看、创建、更新、删除 Harness 技能(写入 provider 根目录的 `SKILL.md` bundle,文件系统 watcher 即时生效)。
- **MCP**:列出、查看、添加、更新、移除、重载 MCP 服务器(操作 loader 中的 `@deepseek-ai/dsh-mcp-client` 条目,热插拔并持久化到 profile 配置)。
- **设置页 UI**(`dsh web`):设置 → "技能与 MCP" 分区,含 **技能** 与 **MCP** 两个标签页,可视化列表与表单,支持创建/编辑/删除/重载。

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
- 所有读写经由宿主命令桥(`/skill-mgr`、`/mcp-mgr`,JSON 协议)完成,每次变更都会作为命令记录写入会话日志,形成可追溯的审计节点。

## 提供的工具

### Skill 管理(`skill_manager_*`)

| 工具 | 作用 |
|---|---|
| `skill_manager_list` | 列出当前会话可见的全部技能:名称、描述、来源根、provider、模型/用户调用策略 |
| `skill_manager_get` | 获取单个技能的完整定义:正文、绝对路径、来源、策略、metadata |
| `skill_manager_roots` | 展示文件系统 provider 扫描的所有技能根目录及存在状态 |
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
- **设置页数据桥**:客户端 bundle 与宿主共用一套逻辑(`/skill-mgr`、`/mcp-mgr` 命令,JSON 协议)。浏览器通过固定 wire 契约 `ctx.remote.commands.execute(sessionId, line)` 调用宿主命令,拿到 JSON 结果渲染;命令生命周期记录(`command/run` / `command/done`)落在会话日志中,敏感输入不落盘(`recordInput: false`),响应中的 env/headers 值脱敏为 `**redacted**`。
- **客户端提供**:`dsh-client-modules` 扫描到本包的 `dsh.client` 声明后,把 `lib/client.js` 编入 boot 图并服务 `/plugins/dsh-skill-mcp-manager/client.js`,浏览器侧 Cordis 以普通插件条目应用它,注册 `settings.section`("技能与 MCP")与两个标签页。无需重新构建 DSH 前端。

## 开发

```bash
node test/smoke.mjs         # 宿主端:工具 + /skill-mgr、/mcp-mgr 命令协议(需 @deepseek-ai 依赖)
node test/client-smoke.mjs  # 客户端 bundle:加载、apply、插槽注册、命令桥与脱敏
```

## 许可

MIT
