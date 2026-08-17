/**
 * dsh-skill-mcp-manager — manage DeepSeek Harness skills and MCP servers.
 *
 * The plugin registers model-facing tools on `ctx.tools`
 * (`skill_manager_*`, `mcp_manager_*`), two human commands on `ctx.commands`
 * (`/skills`, `/mcp`), and one policy section on `ctx.systemPrompt`.
 *
 * @module dsh-skill-mcp-manager
 */
import type { Context } from '@deepseek-ai/cordis';
import type Schema from '@deepseek-ai/schemastery';
/** Plugin identity used by the Loader registry. */
export declare const name = 'skill-mcp-manager';
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
