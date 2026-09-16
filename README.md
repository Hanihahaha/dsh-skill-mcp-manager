# dsh-skill-mcp-manager

[中文](README.zh.md)

A DeepSeek Harness (DSH) plugin for managing Skills and MCP servers from a session, including a dedicated DSH Web settings section.

> **Compatibility:** audited and fixed against `@deepseek-ai/dsh` **0.1.5-rc.1** (cordis **4.0.2**). See [Version compatibility](#version-compatibility) for what changed.

## Capabilities

- **Skills:** list, inspect, create, update, and delete `SKILL.md` bundles in available provider roots.
- **MCP servers:** list, inspect, add, update, remove, and reload `@deepseek-ai/dsh-mcp-client` entries.
- **Web settings:** adds a Skill & MCP section with separate tabs, forms, and lifecycle actions. All traffic goes over the plugin's own authenticated Fetch route, so operating the page writes nothing to the conversation.

## Install

```powershell
# Run from the repository root.
dsh plugin --profile web add ".\dsh-skill-mcp-manager"
```

The bundle patch adds `skill-mcp-manager`; the package's `dsh.client` declaration exposes `lib/client.js` to the existing DSH Web boot graph. Restart `dsh web` after installation.

## Tools

### Skill tools

| Tool | Purpose |
|---|---|
| `skill_manager_list` | List Skills visible in the current session. |
| `skill_manager_get` | Read one complete Skill definition. |
| `skill_manager_roots` | List every root the filesystem provider actually scans, with whether each exists and whether the manager may create into it (read from the provider's own config, so `dshHome`/`agentsHome`/`customSkillDirs`/`bundledSkillDir` overrides are reflected). |
| `skill_manager_create` | Create a kebab-case Skill bundle. |
| `skill_manager_update` | Update a Skill's metadata or body. |
| `skill_manager_delete` | Delete a Skill after explicit confirmation. |

### MCP tools

| Tool | Purpose |
|---|---|
| `mcp_manager_list` | List configured MCP servers and runtime status. |
| `mcp_manager_get` | Inspect one server configuration and status. |
| `mcp_manager_add` | Add and activate a persistent server entry. |
| `mcp_manager_update` | Update and hot-reload a server entry. |
| `mcp_manager_reload` | Reconnect and rediscover server tools. |
| `mcp_manager_remove` | Remove a server after explicit confirmation. |

## Commands

- `/skills` lists visible Skills without involving the model.
- `/mcp` lists MCP servers and their status without involving the model.

The settings page does **not** use commands: `commands.execute` appends a `command/run` + `command/done` pair to the session log on every call, and the `command/done` text is the command's entire JSON result, which the chat renders as a permanent `skill-mgr · {…}` row. The page talks over the plugin's own authenticated Fetch route instead, so no such row is produced (rows already written by an older revision are session history and are not rewritten).

## Configuration

Override the package configuration in the profile `cordis.patch.yml`:

```yaml
- id: skill-mcp-manager
  config:
    mcpPlugin: '@deepseek-ai/dsh-mcp-client'
    skillDefaultRoot: user
```

MCP changes are stored in the profile user patch layer and survive `dsh web` restarts. Sensitive environment variables and headers are never returned in plaintext.

## Development

```powershell
node test/smoke.mjs         # host: 12 tools, /skills + /mcp, every settings route endpoint
node test/client-smoke.mjs  # browser bundle: load, apply, slot registration, route calls, "never logs"
```

## Version compatibility

Baseline: `@deepseek-ai/dsh` **0.1.5-rc.1** with `@deepseek-ai/dsh-*` runtime packages **0.1.5-rc.2** and cordis **4.0.2** (the previous revision targeted `0.1.0-rc.6` / cordis `4.0.1`).

Fixed in this revision:

1. **The settings page no longer writes command records into the session.** It used `ctx.remote.commands.execute(sessionId, "/skill-mgr …")`, and every command invocation appends a `command/run` + `command/done` pair whose `command/done` text is the command's whole JSON result — so the chat rendered a permanent `skill-mgr · {"skills":[…]}` / `mcp-mgr · {"servers":[]}` row. The page lists on mount and refreshes after every mutation, so one settings visit left several large JSON rows in the conversation. It now uses the plugin's own authenticated Fetch route `/api/dsh-skill-mcp-manager` (11 endpoints) and produces **no session events at all**; the `/skill-mgr` and `/mcp-mgr` commands that existed only to serve it are gone too (they also appeared in the slash menu, where a manual invocation polluted the log the same way). Rows already written by an older revision are session history and are not rewritten.
2. **The settings bridge dropped a required argument (same code path).** The generated Remote descriptor for `@deepseek-ai/dsh-commands#commands/execute` is `execute(agentId, line, submittedAttachments, signal?)`, where `submittedAttachments` is a required strict array parameter — a two-argument call was rejected by argument validation before reaching the host handler. That path is now deleted entirely; the replacement route has no such constraint.
3. **Fiber phase labels were misaligned.** cordis 4.0.2 numbers `Fiber.State` as `PENDING=0 / LOADING=1 / ACTIVE=2 / FAILED=3 / DISPOSED=4 / UNLOADING=5`; the old positional table reported a disposed entry as `unloading` and had no case for `UNLOADING=5`. Labels are now keyed by the state constants and mirror `@deepseek-ai/dsh-host-plugin-inventory`'s public projection (`DISPOSED → null`), with unknown values degrading to `state:<n>`.
4. **Skill roots are read from the provider's own config.** `@deepseek-ai/dsh-skill-filesystem` exposes `includeDefaultRoots`/`dshHome`/`agentsHome`/`customSkillDirs`/`bundledSkillDir`, so a hardcoded root list could disagree with discovery — and `skill_manager_create root: "user"` could write somewhere the provider never scans. The manager now derives the list from the mounted provider entries (including `custom` and the read-only `bundled` root) in the provider's scan order, and `skill_manager_roots` reports `writable`.
5. **Guidance section order was stale.** `@deepseek-ai/dsh-system-prompt`'s `SECTION_ORDERS` now spans 500–10200 (tool sections at 1000–2900), so the old `115` sorted the manager note ahead of the harness identity. It now uses `2905`, just after the tool-guidance block (`TOOL_REPORT = 2900`).
6. **`dsh.client.inject` named a removed package.** `@deepseek-ai/dsh-client-runtime` is no longer published; the list now names the packages that actually provide this client's services: `dsh-api-remotes`, `dsh-api-session-controller` (`sessions`), `dsh-client-connection` (`connection`), `dsh-client-locale` (`locale`), `dsh-client-ui-renderer` (`slots`), `dsh-client-ui-settings` (the `settings.section` declaration). A missing inject row is not fatal, but it silently drops the load-order guarantee.
7. **peerDependencies** moved to `^0.1.5-rc.1` (cordis `^4.0.2`) and `@deepseek-ai/schemastery` to `^3.18.2`.

Contracts audited and left unchanged: the `defineTool` `parameters`/`output.render`/`presentCall` shapes; `ctx.commands.register`'s `CommandDefinition` (including `recordInput`) and `CommandInvocation`; `ctx.systemPrompt.section`; `ctx.skills.list/get`'s `SkillSummary`/`SkillDefinition`; the `fs/observed` payload and `edit`/`write` actor check; `ctx.loader`'s `entries/resolve/create/update/remove` and `Entry.options`/`disabled`/`fiber`; the `@deepseek-ai/dsh-mcp-client` `Config` union, `serverName` pattern, and `reconnect.*` fields; the profile patch layer (`cordis.patch.yml` beside the `cordis:include` entry); the client-side `settings.section` + `children` registration protocol, `ctx.slots.*`, `ctx.locale.*`, and the `hooks.tabs` shape; and the `connection.fetch` exact-route contract (`path` shaped `/api/<segment>`, `methods`, `requestBody`, `fetch(request) => Promise<Response>`) — the shipped equivalent is `@deepseek-ai/dsh-client-ui-deliverables`' `/api/present.open`.

### Why a Fetch route and not `connection.rpc.handle`

`HostConnectionService.rpc`'s getter reads `this.ctx`, and cordis routes a service getter's context reads back through the **service's own** fiber — so `rpc.handle`'s internal `owner.webServer.register(...)` cannot resolve `webServer` from any plugin context (`cannot get property "webServer" without inject`, verified on a live `dsh web`). `/api` Fetch routes have no such dependency: `connection.fetch.register` only writes into the service's own route table, and the `/api` prefix route that dispatches it already applies the trust fence and the browser-session check. The equivalent first-party implementation is `dsh-client-ui-deliverables`.

## License

MIT
