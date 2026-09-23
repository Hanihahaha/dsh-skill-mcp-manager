# dsh-skill-mcp-manager

[中文](README.zh.md)

A DeepSeek Harness (DSH) plugin for managing Skills and MCP servers from a session, including a dedicated DSH Web settings section.

> **Compatibility:** audited and fixed against `@deepseek-ai/dsh` **0.1.7-alpha.2** (cordis **4.0.4**). What changed, and which contracts were re-verified, is recorded in [CHANGELOG.md](CHANGELOG.md).

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

## Changelog

Version history and the DeepSeek Harness compatibility record live in [CHANGELOG.md](CHANGELOG.md) (bilingual).

## License

MIT
