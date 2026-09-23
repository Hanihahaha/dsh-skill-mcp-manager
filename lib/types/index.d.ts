/**
 * dsh-skill-mcp-manager — manage DeepSeek Harness skills and MCP servers.
 *
 * The plugin registers model-facing tools on `ctx.tools`
 * (`skill_manager_*`, `mcp_manager_*`), two human commands on `ctx.commands`
 * (`/skills`, `/mcp`), one policy section on `ctx.systemPrompt`, and one
 * authenticated Fetch route consumed by the Web settings client half.
 *
 * The route exists because the command path would append a `command/run` +
 * `command/done` pair to the session log for every list and mutation the
 * settings page performs, which the chat renders as a permanent
 * `skill-mgr · {…}` row carrying the whole JSON result.
 *
 * Verified against `@deepseek-ai/dsh` 0.1.7-alpha.2 (cordis 4.0.4).
 *
 * @module dsh-skill-mcp-manager
 */
import type { Context } from '@deepseek-ai/cordis';
import type Schema from '@deepseek-ai/schemastery';
/** Plugin identity used by the Loader registry. */
export declare const name = 'skill-mcp-manager';
/**
 * Authenticated Fetch route the browser half posts to, below Connection's `/api`
 * prefix (which owns the Host/Origin trust fence and the browser session). The
 * body is `{ endpoint, payload }`; the reply is `{ ok: true, value }` or
 * `{ ok: false, error: { code, message } }`. Endpoints are opaque dotted names
 * (`skill.snapshot`, `mcp.reload`, …).
 */
export declare const SETTINGS_PATH: '/api/dsh-skill-mcp-manager';
/** Services this plugin requires before it applies. */
export declare const inject: readonly ['skills', 'tools', 'loader', 'systemPrompt', 'commands'];
/** Schemastery config for the skill/MCP manager. */
export declare const Config: Schema<{
    /** Module specifier of the MCP plugin entry this manager owns. */
    mcpPlugin?: string;
    /** Default root selector for `skill_manager_create` when `root` is omitted. */
    skillDefaultRoot?: 'user' | 'project';
}>;
/** Apply the plugin on the settled context. */
export declare function apply(ctx: Context, config?: {
    mcpPlugin?: string;
    skillDefaultRoot?: 'user' | 'project';
}): void;
