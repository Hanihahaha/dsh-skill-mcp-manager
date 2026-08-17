# dsh-skill-mcp-manager

[中文](README.zh.md)

A DeepSeek Harness (DSH) plugin for managing Skills and MCP servers from a session, including a dedicated DSH Web settings section.

## Capabilities

- **Skills:** list, inspect, create, update, and delete `SKILL.md` bundles in available provider roots.
- **MCP servers:** list, inspect, add, update, remove, and reload `@deepseek-ai/dsh-mcp-client` entries.
- **Web settings:** adds a Skills & MCP section with separate tabs, forms, and lifecycle actions.

## Install

```powershell
# Run from the repository root.
dsh plugin --profile web add ".\packages\dsh-skill-mcp-manager"
```

The bundle patch adds `skill-mcp-manager`; the package's `dsh.client` declaration exposes `lib/client.js` to the existing DSH Web boot graph. Restart `dsh web` after installation.

## Tools

### Skill tools

| Tool | Purpose |
|---|---|
| `skill_manager_list` | List Skills visible in the current session. |
| `skill_manager_get` | Read one complete Skill definition. |
| `skill_manager_roots` | List scanned Skill roots. |
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
node test/smoke.mjs
node test/client-smoke.mjs
```

## License

MIT
