//#region lib/types/index.js
/**
 * Manage DeepSeek Harness skills and MCP servers from inside a session.
 *
 * The plugin registers model-facing `skill_manager_*` and `mcp_manager_*`
 * tools on `ctx.tools`, a human-facing `/skills` and `/mcp` command pair on
 * `ctx.commands`, one policy section on `ctx.systemPrompt`, and one
 * authenticated Fetch route (`/api/dsh-skill-mcp-manager`) that serves the Web
 * Settings client half. The route exists because the command path would log a
 * `command/run` + `command/done` pair — rendered by the chat as a permanent
 * `skill-mgr · {…}` row — for every list and mutation the page performs.
 *
 * Skills are ordinary files in the provider roots scanned by
 * `@deepseek-ai/dsh-skill-filesystem` (project `.dsh/skills`, `.agents/skills`,
 * user `$DSH_HOME/skills`, `~/.agents/skills`, plus any `customSkillDirs`).
 * The manager writes `<root>/<name>/SKILL.md` bundles with kebab-case names and
 * YAML frontmatter; the filesystem provider's host watcher picks the mutation
 * up and invalidates the catalog, so the next `ctx.skills` observation sees it.
 *
 * MCP servers are `@deepseek-ai/dsh-mcp-client` loader entries. The manager
 * persists them into the profile's patch layer (`cordis.patch.yml`, the
 * `dsh --profile` user layer that every boot reads and never resets) and
 * hot-applies the change by letting the patch-layer HMR watcher re-compose
 * the loader tree, so a server survives `dsh web` restarts. Where no patch
 * layer is reachable (test mocks), it falls back to live `ctx.loader`
 * create/update/remove without durable persistence.
 *
 * Verified against `@deepseek-ai/dsh` 0.1.5-rc.1 (cordis 4.0.2); see the
 * "Version compatibility" section of the README for the audited contracts.
 *
 * @module dsh-skill-mcp-manager
 */
import { homedir } from "node:os";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
const { dump: dumpYaml, load: parseYaml } = yaml;
import z from "@deepseek-ai/schemastery";
import { isSkillName } from "@deepseek-ai/dsh-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
//#endregion
//#region constants
/** Plugin identity used by the Loader registry and tool result headers. */
const name = "skill-mcp-manager";
/** Services this plugin requires before it applies. */
const inject = ["skills", "tools", "loader", "systemPrompt", "commands"];
/** Default MCP plugin entry name the manager owns. */
const DEFAULT_MCP_PLUGIN = "@deepseek-ai/dsh-mcp-client";
/** Default skills loader entry whose configuration describes the scanned roots. */
const DEFAULT_SKILL_PLUGIN = "@deepseek-ai/dsh-skill-filesystem";
/** MCP `serverName` grammar enforced by `@deepseek-ai/dsh-mcp-client`. */
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/**
 * Cordis `Fiber.State` values (cordis 4.0.2). The numbering is load-bearing:
 * `DISPOSED` is 4 and `UNLOADING` is 5, so a positional label table silently
 * mislabels every disposed entry as "unloading".
 */
const FIBER_STATE = {
	PENDING: 0,
	LOADING: 1,
	ACTIVE: 2,
	FAILED: 3,
	DISPOSED: 4,
	UNLOADING: 5
};
/**
 * Public phase label per root Fiber state, mirroring the complete projection
 * `@deepseek-ai/dsh-host-plugin-inventory` publishes (`FIBER_PHASE`): every
 * state maps to a label except `DISPOSED`, which reports `null` because the
 * entry no longer owns a live plugin instance. Keeping the two in step means a
 * manager row and the Plugins settings row describe one entry identically.
 */
const FIBER_LABELS = {
	[FIBER_STATE.PENDING]: "pending",
	[FIBER_STATE.LOADING]: "loading",
	[FIBER_STATE.ACTIVE]: "active",
	[FIBER_STATE.FAILED]: "failed",
	[FIBER_STATE.DISPOSED]: null,
	[FIBER_STATE.UNLOADING]: "unloading"
};
/**
 * Order for the policy guidance section, just after the tool-guidance block
 * (`@deepseek-ai/dsh-system-prompt`'s `SECTION_ORDERS` places `TOOL_REPORT` at
 * 2900 and `TOOLS_SDK` at 5000), so the manager's note reads with the other
 * tool sections instead of ahead of the harness identity.
 */
const GUIDANCE_ORDER = 2905;
/** Prompt section name registered on the system prompt. */
const GUIDANCE_SECTION = "tool:skill-mcp-manager";
//#endregion
//#region config
/** Schemastery config for the skill/MCP manager. */
const Config = z.object({
	mcpPlugin: z.string().default(DEFAULT_MCP_PLUGIN),
	skillDefaultRoot: z.union([z.const("user"), z.const("project")]).default("user")
});
/** Validate config even when apply is called directly outside Loader normalization. */
function resolveConfig(config = {}) {
	const mcpPlugin = config.mcpPlugin ?? DEFAULT_MCP_PLUGIN;
	if (typeof mcpPlugin !== "string" || mcpPlugin.trim().length === 0) throw new TypeError("mcpPlugin must be a non-empty module specifier");
	const skillDefaultRoot = config.skillDefaultRoot ?? "user";
	if (skillDefaultRoot !== "user" && skillDefaultRoot !== "project") throw new TypeError("skillDefaultRoot must be 'user' or 'project'");
	return { mcpPlugin, skillDefaultRoot };
}
//#endregion
//#region shared rendering
/** Generic, args-only pending presentation shared by every manager tool. */
function present(title, kind, rawInput) {
	return {
		card: "generic",
		title,
		kind,
		...(rawInput === void 0 ? {} : { rawInput })
	};
}
/** Reusable canonical output: render any JSON value as text. */
function jsonOutput(schema) {
	return {
		schema,
		render: (_args, value) => [{
			type: "text",
			text: JSON.stringify(value, null, 2)
		}]
	};
}
/** Build the value schema for a list of records. */
function listSchema(itemSchema) {
	return {
		type: "array",
		items: itemSchema
	};
}
/** Stable compact skill summary shared by list and command output. */
function skillSummaryValue(skill) {
	return {
		name: skill.name,
		description: skill.description,
		...(skill.whenToUse === void 0 ? {} : { whenToUse: skill.whenToUse }),
		source: skill.source,
		provider: skill.provider,
		modelInvocable: skill.invocation.modelInvocable,
		userInvocable: skill.invocation.userInvocable
	};
}
const SKILL_SUMMARY_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		name: { type: "string", required: true },
		description: { type: "string", required: true },
		whenToUse: { type: "string" },
		source: { type: "string", required: true },
		provider: { type: "string", required: true },
		modelInvocable: { type: "boolean", required: true },
		userInvocable: { type: "boolean", required: true }
	}
};
/** One scanned skill root shared by the roots tool and the `/skill-mgr snapshot` payload. */
const SKILL_ROOT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		source: { type: "string", required: true },
		path: { type: "string", required: true },
		exists: { type: "boolean", required: true },
		writable: { type: "boolean", required: true }
	}
};
//#endregion
//#region skill helpers
/**
 * Resolve the nearest project root the skill provider would use for `cwd`:
 * the nearest ancestor containing `.git`, falling back to `cwd` itself. This
 * mirrors `@deepseek-ai/dsh-skill-filesystem`'s own `findProjectRoot`.
 */
async function projectRootOf(cwd) {
	let current = resolve(cwd);
	while (true) {
		try {
			await access(join(current, ".git"), fsConstants.F_OK);
			return current;
		} catch {}
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}
/**
 * Read every mounted filesystem skill provider's configuration. The provider's
 * root set is configurable (`dshHome`, `agentsHome`, `includeDefaultRoots`,
 * `customSkillDirs`, `bundledSkillDir`), so a manager that hardcodes the default
 * roots would disagree with discovery — and `skill_manager_create root: "user"`
 * would write somewhere the provider never scans — whenever a profile overrides
 * any of them.
 */
function skillProviderConfigs(ctx) {
	const configs = [];
	for (const entry of ctx.loader.entries()) {
		if (entry.options.name !== DEFAULT_SKILL_PLUGIN) continue;
		const config = entry.options.config;
		configs.push(config !== null && typeof config === "object" ? config : {});
	}
	return configs;
}
/**
 * Resolve the ordered skill roots one provider config describes, in the
 * provider's own scan order: project roots, then custom roots, then user roots,
 * then the bundled root. `writable` marks the roots the manager may create into;
 * the bundled root belongs to the deployment and is report-only.
 */
function skillRootsOfConfig(config, project) {
	const includeDefaultRoots = config.includeDefaultRoots ?? true;
	const dshHome = resolveDshHome(typeof config.dshHome === "string" ? config.dshHome : void 0);
	const agentsHome = resolve(typeof config.agentsHome === "string" && config.agentsHome.length > 0 ? config.agentsHome : process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents"));
	const roots = [];
	if (includeDefaultRoots && project !== void 0) {
		roots.push({ source: "project-dsh", path: join(project, ".dsh", "skills"), writable: true });
		roots.push({ source: "project-agents", path: join(project, ".agents", "skills"), writable: true });
	}
	if (Array.isArray(config.customSkillDirs)) for (const dir of config.customSkillDirs) if (typeof dir === "string" && dir.length > 0) roots.push({
		source: "custom",
		path: resolve(dir),
		writable: true
	});
	if (includeDefaultRoots) {
		roots.push({ source: "user-dsh", path: join(dshHome, "skills"), writable: true });
		roots.push({ source: "user-agents", path: join(agentsHome, "skills"), writable: true });
		const bundled = typeof config.bundledSkillDir === "string" && config.bundledSkillDir.length > 0 ? config.bundledSkillDir : process.env.DSH_BUNDLED_SKILL_DIR;
		if (typeof bundled === "string" && bundled.length > 0) roots.push({ source: "bundled", path: resolve(bundled), writable: false });
	}
	return roots;
}
/**
 * Resolve every skill root the mounted filesystem providers scan for `cwd`, in
 * scan order and de-duplicated by path. When no provider entry is reachable
 * (unit tests, or a composition that mounts skills some other way) this falls
 * back to the provider defaults so the manager still reports a usable map.
 */
async function skillRoots(ctx, cwd) {
	const project = cwd === void 0 ? void 0 : await projectRootOf(cwd);
	const configs = skillProviderConfigs(ctx);
	const list = configs.length > 0 ? configs.flatMap((config) => skillRootsOfConfig(config, project)) : skillRootsOfConfig({}, project);
	const seen = /* @__PURE__ */ new Set();
	const roots = [];
	for (const root of list) {
		const key = root.path.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		roots.push(root);
	}
	return roots;
}
/**
 * Map a user-facing root selector ("user", "project", or an absolute path) to
 * one root record. "user" and "project" resolve through the mounted provider's
 * own configuration so a create lands where discovery will see it.
 */
async function resolveSkillRoot(ctx, cwd, selector, defaultSelector) {
	const roots = await skillRoots(ctx, cwd);
	if (selector === void 0 || selector === "") selector = defaultSelector;
	if (selector === "user") {
		const root = roots.find((candidate) => candidate.source === "user-dsh");
		if (root === void 0) throw new Error("no user skill root is configured; pass an absolute path instead");
		return root;
	}
	if (selector === "project") {
		const root = roots.find((candidate) => candidate.source === "project-dsh");
		if (root === void 0) throw new Error("no project skill root is available; open a session with a workspace or pass an absolute path");
		return root;
	}
	if (isAbsolute(selector)) return { source: "custom", path: resolve(selector), writable: true };
	throw new Error(`root must be "user", "project", or an absolute path, got ${JSON.stringify(selector)}`);
}
/** Render one frontmatter mapping in the provider's accepted YAML dialect. */
function renderFrontmatter(data) {
	const out = {};
	out.name = data.name;
	out.description = data.description;
	if (typeof data.whenToUse === "string" && data.whenToUse.length > 0) out.whenToUse = data.whenToUse;
	if (data["disable-model-invocation"] === true) out["disable-model-invocation"] = true;
	if (data["user-invocable"] === false) out["user-invocable"] = false;
	if (data.metadata !== void 0 && data.metadata !== null) out.metadata = data.metadata;
	return dumpYaml(out, { lineWidth: -1, noRefs: true }).trimEnd();
}
/** Render a complete skill file: frontmatter block plus Markdown body. */
function renderSkillFile(data, body) {
	const frontmatter = renderFrontmatter(data);
	const trimmedBody = (body ?? "").trim();
	return `---\n${frontmatter}\n---\n\n${trimmedBody}\n`;
}
/**
 * Parse a skill file into its YAML data mapping and body, matching the
 * provider's `---` delimited frontmatter grammar. Returns undefined when the
 * file has no well-formed frontmatter.
 */
function parseSkillFileText(raw) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return void 0;
	const start = firstLineEnd + 1;
	let lineStart = start;
	while (lineStart <= raw.length) {
		const nextNewline = raw.indexOf("\n", lineStart);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
			const front = raw.slice(start, lineStart);
			const body = nextNewline < 0 ? "" : raw.slice(nextNewline + 1);
			let data;
			try {
				data = parseYaml(front);
			} catch {
				return void 0;
			}
			if (typeof data !== "object" || data === null || Array.isArray(data)) return void 0;
			return { data, body };
		}
		if (nextNewline < 0) return void 0;
		lineStart = nextNewline + 1;
	}
	return void 0;
}
/**
 * Notify the skill-filesystem provider synchronously that a skill path changed,
 * using the same `fs/observed` event shape the first-party write tool emits.
 * The provider's listener checks `actor.name` and invalidates its catalog, so
 * the tool's follow-up `ctx.skills.list()` observation is deterministic instead
 * of waiting for the Chokidar stability window.
 */
function observeSkillPath(ctx, path) {
	ctx.emit("fs/observed", { displayPath: path }, { kind: "present" }, { name: "write" });
}
/** Write one skill file and synchronously invalidate the provider catalog. */
async function writeSkillFile(ctx, path, data, body) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, renderSkillFile(data, body), "utf8");
	observeSkillPath(ctx, path);
}
/** Remove one skill file (or its whole `<name>/` bundle directory). */
async function removeSkillPath(ctx, path) {
	const target = basename(path) === "SKILL.md" ? dirname(path) : path;
	await rm(target, { recursive: true, force: true });
	observeSkillPath(ctx, path);
}
//#endregion
//#region mcp helpers
/** Iterate the loader entries this manager owns (the configured MCP plugin). */
function mcpEntries(ctx, mcpPlugin) {
	return [...ctx.loader.entries()].filter((entry) => entry.options.name === mcpPlugin);
}
/** Find one MCP loader entry by its `serverName`, or undefined. */
function findMcpByServerName(ctx, mcpPlugin, serverName) {
	return mcpEntries(ctx, mcpPlugin).find((entry) => entry.options.config?.serverName === serverName);
}
/** Find one MCP loader entry by full loader id, or throw a domain error. */
function findMcpById(ctx, id) {
	let entry;
	try {
		entry = ctx.loader.resolve(id);
	} catch {
		return void 0;
	}
	return entry;
}
/** Whether a loader id is already taken anywhere in the tree. */
function entryIdExists(ctx, id) {
	try {
		ctx.loader.resolve(id);
		return true;
	} catch {
		return false;
	}
}
/**
 * Human label for an entry's current root Fiber phase; null without a live
 * fiber and null for a disposed one (both mean "no live instance"), matching
 * the inventory service's own projection. An unknown numeric state degrades to
 * a readable `state:<n>` rather than being silently mislabelled.
 */
function fiberStateLabel(entry) {
	const fiber = entry.fiber;
	if (fiber === void 0) return null;
	const label = FIBER_LABELS[fiber.state];
	return label === void 0 ? `state:${fiber.state}` : label;
}
/** Replace `!!js` expression nodes with `{ $js: <expression> }` for JSON output. */
function cleanConfig(value) {
	if (value !== null && typeof value === "object" && "__jsExpr" in value) return { $js: value.__jsExpr };
	if (Array.isArray(value)) return value.map(cleanConfig);
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [key, item] of Object.entries(value)) out[key] = cleanConfig(item);
		return out;
	}
	return value;
}
/** Tools registered for one MCP server under the `mcp__<server>__` namespace. */
function mcpToolNames(ctx, serverName, scope) {
	const prefix = `mcp__${serverName}__`;
	return ctx.tools.schemas(scope).map((tool) => tool.name).filter((toolName) => toolName.startsWith(prefix));
}
/** Compact MCP server summary shared by list, get, and command output. */
function mcpServerValue(ctx, entry, scope, includeTools = true) {
	const config = entry.options.config ?? {};
	const tools = mcpToolNames(ctx, config.serverName, scope);
	return {
		id: entry.id,
		serverName: config.serverName,
		transport: config.transport ?? null,
		...(config.command === void 0 ? {} : { command: config.command }),
		...(config.url === void 0 ? {} : { url: config.url }),
		enabled: !entry.disabled,
		state: fiberStateLabel(entry),
		toolCount: tools.length,
		...(includeTools ? { tools } : {})
	};
}
const MCP_SERVER_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: { type: "string", required: true },
		serverName: { type: "string", required: true },
		transport: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
		command: { type: "string" },
		url: { type: "string" },
		enabled: { type: "boolean", required: true },
		state: { oneOf: [{ type: "string" }, { type: "null" }], required: true },
		toolCount: { type: "integer", required: true },
		tools: { type: "array", items: { type: "string" }, required: true }
	}
};
/** Validate and normalize an MCP server config from tool arguments. */
function buildMcpConfig(args, base = {}) {
	const config = { ...base };
	if (args.transport !== void 0) config.transport = args.transport;
	if (config.transport !== "stdio" && config.transport !== "streamable-http") throw new Error(`transport must be "stdio" or "streamable-http", got ${JSON.stringify(config.transport)}`);
	if (args.server_name !== void 0) {
		if (typeof args.server_name !== "string" || !MCP_SERVER_NAME.test(args.server_name)) throw new Error(`server_name must match ${MCP_SERVER_NAME}, got ${JSON.stringify(args.server_name)}`);
		config.serverName = args.server_name;
	}
	if (config.serverName === void 0) throw new Error("server_name is required");
	if (config.transport === "stdio") {
		if (args.command !== void 0) {
			if (typeof args.command !== "string" || args.command.trim().length === 0) throw new Error("command must be a non-empty string for stdio transport");
			config.command = args.command;
		}
		if (config.command === void 0) throw new Error("command is required for stdio transport");
		if (args.args !== void 0) {
			if (!Array.isArray(args.args) || !args.args.every((item) => typeof item === "string")) throw new Error("args must be an array of strings");
			if (args.args.length > 0) config.args = args.args;
			else delete config.args;
		}
		if (args.env !== void 0) {
			if (!isStringMap(args.env)) throw new Error("env must be an object mapping strings to strings");
			if (Object.keys(args.env).length > 0) config.env = args.env;
			else delete config.env;
		}
		if (args.cwd !== void 0) {
			if (typeof args.cwd !== "string" || args.cwd.length === 0) throw new Error("cwd must be a non-empty string");
			config.cwd = args.cwd;
		}
		delete config.url;
		delete config.headers;
	} else {
		if (args.url !== void 0) {
			if (typeof args.url !== "string" || args.url.length === 0) throw new Error("url must be a non-empty string");
			config.url = args.url;
		}
		if (config.url === void 0) throw new Error("url is required for streamable-http transport");
		if (args.headers !== void 0) {
			if (!isStringMap(args.headers)) throw new Error("headers must be an object mapping strings to strings");
			if (Object.keys(args.headers).length > 0) config.headers = args.headers;
			else delete config.headers;
		}
		delete config.command;
		delete config.args;
		delete config.env;
		delete config.cwd;
	}
	const numberFields = {
		tool_call_timeout_ms: "toolCallTimeoutMs",
		reconnect_initial_delay_ms: "reconnect.initialDelayMs",
		reconnect_max_delay_ms: "reconnect.maxDelayMs",
		reconnect_max_attempts: "reconnect.maxAttempts"
	};
	for (const [argKey, configKey] of Object.entries(numberFields)) {
		if (args[argKey] === void 0) continue;
		if (!Number.isFinite(args[argKey]) || args[argKey] <= 0) throw new Error(`${argKey} must be a positive number`);
		setNested(config, configKey, args[argKey]);
	}
	if (args.fail_on_startup_error !== void 0) {
		if (typeof args.fail_on_startup_error !== "boolean") throw new Error("fail_on_startup_error must be a boolean");
		config.failOnStartupError = args.fail_on_startup_error;
	}
	if (args.reconnect_enabled !== void 0) {
		if (typeof args.reconnect_enabled !== "boolean") throw new Error("reconnect_enabled must be a boolean");
		config.reconnect = { ...(config.reconnect ?? {}), enabled: args.reconnect_enabled };
	}
	if (args.disabled !== void 0 && typeof args.disabled !== "boolean") throw new Error("disabled must be a boolean");
	return config;
}
/** Set a dotted key like "reconnect.initialDelayMs" on a nested config object. */
function setNested(target, dottedKey, value) {
	const parts = dottedKey.split(".");
	let cursor = target;
	for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
	cursor[parts[parts.length - 1]] = value;
}
/** Whether a value is a plain object mapping string keys to string values. */
function isStringMap(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value).every((item) => typeof item === "string");
}
//#endregion
//#region shared operations
/** Create one skill file and return its summary; shared by the tool and the `/skill-mgr` command. */
async function skillCreate(ctx, config, args, lookup) {
	assertSkillName(args.name);
	if (typeof args.description !== "string" || args.description.trim().length === 0) throw new Error("description must be a non-empty string");
	if (typeof args.content !== "string" || args.content.trim().length === 0) throw new Error("content must be a non-empty string");
	const existing = (await ctx.skills.list(lookup)).find((skill) => skill.name === args.name);
	if (existing) throw new Error(`skill "${args.name}" already exists (source ${existing.source}); use skill_manager_update instead`);
	const { source, path } = await resolveSkillRoot(ctx, lookup.cwd ?? process.cwd(), args.root, config.skillDefaultRoot);
	const data = {
		name: args.name,
		description: args.description.trim(),
		...(typeof args.when_to_use === "string" && args.when_to_use.trim().length > 0 ? { whenToUse: args.when_to_use.trim() } : {}),
		...(args.disable_model_invocation === true ? { "disable-model-invocation": true } : {}),
		...(args.user_invocable === false ? { "user-invocable": false } : {}),
		...(args.metadata === void 0 ? {} : { metadata: args.metadata })
	};
	await writeSkillFile(ctx, join(path, args.name, "SKILL.md"), data, args.content);
	const skill = await ctx.skills.get(args.name, lookup);
	if (!skill) throw new Error(`skill "${args.name}" was written but did not become visible; check the file at ${join(path, args.name, "SKILL.md")}`);
	return skillSummaryValue(skill);
}
/** Update one skill's frontmatter and/or body in place; shared by the tool and the `/skill-mgr` command. */
async function skillUpdate(ctx, _config, args, lookup) {
	assertSkillName(args.name);
	const summary = (await ctx.skills.list(lookup)).find((skill) => skill.name === args.name);
	if (!summary) throw new Error(`skill "${args.name}" is unknown or no longer available`);
	const skill = await ctx.skills.get(args.name, lookup);
	if (!skill || typeof skill.path !== "string") throw new Error(`skill "${args.name}" is not a filesystem skill and cannot be edited`);
	let raw;
	try {
		raw = await readFile(skill.path, "utf8");
	} catch (error) {
		throw new Error(`failed to read ${skill.path}: ${String(error)}`);
	}
	const parsed = parseSkillFileText(raw);
	if (!parsed) throw new Error(`skill file ${skill.path} has no parseable YAML frontmatter`);
	const data = { ...parsed.data };
	if (typeof args.description === "string") data.description = args.description.trim();
	if (data.description === void 0 || data.description.length === 0) throw new Error("description must stay non-empty");
	if (args.when_to_use !== void 0) {
		if (args.when_to_use === null) delete data.whenToUse;
		else data.whenToUse = args.when_to_use;
	}
	if (args.disable_model_invocation !== void 0) {
		if (args.disable_model_invocation === true) data["disable-model-invocation"] = true;
		else delete data["disable-model-invocation"];
	}
	if (args.user_invocable !== void 0) {
		if (args.user_invocable === false) data["user-invocable"] = false;
		else delete data["user-invocable"];
	}
	if (args.metadata !== void 0) {
		if (args.metadata === null) delete data.metadata;
		else data.metadata = args.metadata;
	}
	const body = typeof args.content === "string" ? args.content : parsed.body;
	await writeSkillFile(ctx, skill.path, data, body);
	const updated = await ctx.skills.get(args.name, lookup);
	if (!updated) throw new Error(`skill "${args.name}" became invalid after the update; fix its frontmatter`);
	return skillSummaryValue(updated);
}
/** Delete one skill file or bundle; shared by the tool and the `/skill-mgr` command. */
async function skillDelete(ctx, _config, args, lookup) {
	assertSkillName(args.name);
	if (args.confirm !== true) throw new Error("skill_manager_delete requires confirm: true; ask the user before deleting a skill");
	const summary = (await ctx.skills.list(lookup)).find((skill) => skill.name === args.name);
	if (!summary) throw new Error(`skill "${args.name}" is unknown or no longer available`);
	const skill = await ctx.skills.get(args.name, lookup);
	if (!skill || typeof skill.path !== "string") throw new Error(`skill "${args.name}" is not a filesystem skill and cannot be deleted`);
	if (!skill.path.endsWith(".md")) throw new Error(`refusing to delete non-Markdown path ${skill.path}`);
	await removeSkillPath(ctx, skill.path);
	const remaining = (await ctx.skills.list(lookup)).filter((item) => item.name !== args.name).length;
	return { ok: true, removed: skill.path, remaining };
}
/** Load one skill's full definition; shared by the tool and the `/skill-mgr` command. */
async function skillDetail(ctx, _config, name, lookup) {
	assertSkillName(name);
	const summary = (await ctx.skills.list(lookup)).find((skill) => skill.name === name);
	if (!summary) throw new Error(`skill "${name}" is unknown or no longer available`);
	const skill = await ctx.skills.get(name, lookup);
	if (!skill) throw new Error(`skill "${name}" is unknown or no longer available`);
	return {
		name: skill.name,
		description: skill.description,
		...(skill.whenToUse === void 0 ? {} : { whenToUse: skill.whenToUse }),
		source: skill.source,
		provider: skill.provider,
		modelInvocable: skill.invocation.modelInvocable,
		userInvocable: skill.invocation.userInvocable,
		...(skill.path === void 0 ? {} : { path: skill.path }),
		...(skill.metadata === void 0 ? {} : { metadata: skill.metadata }),
		content: skill.content
	};
}
/** Collect every skill summary plus the root map; the `/skill-mgr snapshot` payload. */
async function skillSnapshot(ctx, _config, lookup) {
	const skills = (await ctx.skills.list(lookup)).map(skillSummaryValue);
	const roots = await describeSkillRoots(ctx, lookup.cwd);
	return { skills, roots };
}
/** Annotate every scanned skill root with whether it currently exists on disk. */
async function describeSkillRoots(ctx, cwd) {
	const roots = await skillRoots(ctx, cwd ?? process.cwd());
	const described = [];
	for (const root of roots) {
		let exists = false;
		try {
			await access(root.path, fsConstants.F_OK);
			exists = true;
		} catch {}
		described.push({
			source: root.source,
			path: root.path,
			exists,
			writable: root.writable
		});
	}
	return described;
}
/** Replace secret-role map values with a redaction marker for wire display. */
function redactConfig(config) {
	const cleaned = cleanConfig(config);
	if (cleaned !== null && typeof cleaned === "object" && !Array.isArray(cleaned)) {
		for (const key of ["env", "headers"]) {
			const map = cleaned[key];
			if (map !== null && typeof map === "object" && !Array.isArray(map)) {
				const redacted = {};
				for (const [name, value] of Object.entries(map)) redacted[name] = value === void 0 ? value : "**redacted**";
				cleaned[key] = redacted;
			}
		}
	}
	return cleaned;
}
//#region mcp patch-layer persistence
/**
* The entry-list YAML dialect the profile loader mounts: plain JSON plus the
* `!!js` expression tag (mirrors `dsh-app-boot`'s internal `entryListSchema`),
* so rewriting a patch file never corrupts `!!js` rows the user already has.
*/
const JsExprType = new yaml.Type("tag:yaml.org,2002:js", {
	kind: "scalar",
	resolve: (data) => typeof data === "string",
	construct: (data) => ({ __jsExpr: data }),
	predicate: (value) => value !== null && typeof value === "object" && "__jsExpr" in value,
	represent: (data) => data.__jsExpr
});
const PATCH_YAML_SCHEMA = yaml.JSON_SCHEMA.extend(JsExprType);
/** Locate the profile patch layer (`cordis.patch.yml`) from the root include entry's config path. */
function profilePatchPath(ctx) {
	for (const entry of ctx.loader.entries()) {
		if (entry.options?.name !== "cordis:include") continue;
		const raw = entry.options?.config?.path;
		if (typeof raw !== "string") return void 0;
		let leaf;
		try {
			leaf = fileURLToPath(raw);
		} catch {
			leaf = raw;
		}
		return join(dirname(leaf), "cordis.patch.yml");
	}
	return void 0;
}
/** Parse the profile patch file into a top-level patch list; `ok` is false when the file cannot be safely rewritten. */
async function readPatchFile(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return { ok: true, list: [] };
	}
	try {
		const data = parseYaml(text, { schema: PATCH_YAML_SCHEMA });
		return { ok: Array.isArray(data), list: Array.isArray(data) ? data : [] };
	} catch {
		return { ok: false, list: [] };
	}
}
/** Find the manager-owned insert patch: the one holding an entry named the MCP plugin. */
function findMcpInsert(patchList, mcpPlugin) {
	for (const patch of patchList) {
		if (patch === null || typeof patch !== "object" || Array.isArray(patch)) continue;
		if (!Array.isArray(patch.insert)) continue;
		if (patch.insert.some((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry.name === mcpPlugin)) return patch;
	}
	return void 0;
}
/**
* Persist the MCP entry list to the profile patch layer, atomically, preserving
* every other patch the user has. Returns false when no safe patch layer exists
* (test mocks, or a file whose dialect cannot be rewritten), so callers fall
* back to live loader ops without durable persistence.
*/
async function persistMcpPatch(ctx, mcpPlugin, mutate) {
	const path = profilePatchPath(ctx);
	if (path === void 0) return false;
	const { ok, list } = await readPatchFile(path);
	if (!ok) return false;
	let insert = findMcpInsert(list, mcpPlugin);
	if (!insert) {
		insert = { insert: [] };
		list.push(insert);
	}
	const next = mutate(insert.insert);
	insert.insert = next;
	if (next.length === 0) {
		const index = list.indexOf(insert);
		if (index >= 0) list.splice(index, 1);
	}
	const text = dumpYaml(list, { schema: PATCH_YAML_SCHEMA, lineWidth: -1 });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, path);
	return true;
}
/** Bounded wait for a loader entry satisfying `predicate` (the patch-layer HMR watcher re-composes the tree asynchronously). */
async function waitForMcpEntry(ctx, mcpPlugin, predicate, timeoutMs = 2500) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const match = mcpEntries(ctx, mcpPlugin).find(predicate);
		if (match !== void 0) return match;
		if (Date.now() >= deadline) return void 0;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
/** Bounded wait for a loader entry to disappear after a patch-layer remove. */
async function waitForMcpGone(ctx, id, timeoutMs = 2500) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (findMcpById(ctx, id) === void 0) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
/** Remove every MCP-plugin entry from the baked leaf (`cordis.yml`) so a later patch re-compose never sees a duplicate id. */
async function cleanLeafOfMcp(ctx, mcpPlugin) {
	const patchPath = profilePatchPath(ctx);
	if (patchPath === void 0) return;
	const leafPath = join(dirname(patchPath), "cordis.yml");
	let text;
	try {
		text = await readFile(leafPath, "utf8");
	} catch {
		return;
	}
	let list;
	try {
		list = parseYaml(text, { schema: PATCH_YAML_SCHEMA });
	} catch {
		return;
	}
	if (!Array.isArray(list)) return;
	const kept = list.filter((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry) || entry.name !== mcpPlugin);
	if (kept.length === list.length) return;
	const tmp = `${leafPath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, dumpYaml(kept, { schema: PATCH_YAML_SCHEMA, lineWidth: -1 }), "utf8");
	await rename(tmp, leafPath);
}
//#endregion
/** Add one MCP server entry; shared by the tool and the `/mcp-mgr` command. */
async function mcpAdd(ctx, config, args, scope) {
	const mcpPlugin = config.mcpPlugin;
	const built = buildMcpConfig(args);
	if (findMcpByServerName(ctx, mcpPlugin, built.serverName)) throw new Error(`an MCP server named "${built.serverName}" already exists; use mcp_manager_update instead`);
	let id = `mcp-${built.serverName}`;
	if (entryIdExists(ctx, `include:${id}`)) id = `${id}-${Math.random().toString(16).slice(2, 8)}`;
	const entry = { id, name: mcpPlugin, config: built, ...(args.disabled === true ? { disabled: true } : {}) };
	if (await persistMcpPatch(ctx, mcpPlugin, (servers) => {
		servers.push(entry);
		return servers;
	})) {
		const mounted = await waitForMcpEntry(ctx, mcpPlugin, (candidate) => candidate.options.config?.serverName === built.serverName);
		if (mounted) return { ...mcpServerValue(ctx, mounted, scope), created: true };
		return { ...mcpServerValue(ctx, { id, options: entry }, scope), created: true, pending: true };
	}
	// Legacy path (no reachable patch layer, e.g. test mocks): hot-create through the loader.
	const created = await ctx.loader.create(entry, "include");
	const visible = findMcpById(ctx, created);
	if (!visible) throw new Error(`MCP server "${built.serverName}" was created but its loader entry is not visible`);
	return { ...mcpServerValue(ctx, visible, scope), created: true };
}
/** Update one MCP server entry; shared by the tool and the `/mcp-mgr` command. */
async function mcpUpdate(ctx, config, args, scope) {
	const mcpPlugin = config.mcpPlugin;
	const entry = findMcpEntry(ctx, mcpPlugin, args.server);
	const current = entry.options.config ?? {};
	const next = buildMcpConfig(args, current);
	if (next.serverName !== current.serverName) {
		const clash = findMcpByServerName(ctx, mcpPlugin, next.serverName);
		if (clash && clash.id !== entry.id) throw new Error(`an MCP server named "${next.serverName}" already exists`);
	}
	const patchOptions = { config: next, ...(args.disabled !== void 0 ? { disabled: args.disabled === true } : {}) };
	if (await persistMcpPatch(ctx, mcpPlugin, (servers) => {
		const existing = servers.find((candidate) => candidate.id === entry.id);
		if (existing) Object.assign(existing, patchOptions);
		else servers.push({ id: entry.id, name: mcpPlugin, ...patchOptions });
		return servers;
	})) {
		const mounted = await waitForMcpEntry(ctx, mcpPlugin, (candidate) => candidate.id === entry.id && candidate !== entry);
		if (mounted) return { ...mcpServerValue(ctx, mounted, scope), config: redactConfig(mounted.options.config ?? {}) };
		return { ...mcpServerValue(ctx, entry, scope), config: redactConfig(next), pending: true };
	}
	await ctx.loader.update(entry.id, patchOptions);
	const updated = findMcpById(ctx, entry.id);
	if (!updated) throw new Error(`MCP server "${args.server}" disappeared after the update`);
	return {
		...mcpServerValue(ctx, updated, scope),
		config: redactConfig(updated.options.config ?? {})
	};
}
/** Remove one MCP server entry; shared by the tool and the `/mcp-mgr` command. */
async function mcpRemove(ctx, config, args) {
	if (args.confirm !== true) throw new Error("mcp_manager_remove requires confirm: true; ask the user before removing an MCP server");
	const entry = findMcpEntry(ctx, config.mcpPlugin, args.server);
	const serverName = entry.options.config?.serverName ?? entry.id;
	if (await persistMcpPatch(ctx, config.mcpPlugin, (servers) => servers.filter((candidate) => candidate.id !== entry.id))) {
		await waitForMcpGone(ctx, entry.id);
		const remaining = mcpEntries(ctx, config.mcpPlugin).length;
		return { ok: true, removed: serverName, remaining };
	}
	await ctx.loader.remove(entry.id);
	const remaining = mcpEntries(ctx, config.mcpPlugin).length;
	return { ok: true, removed: serverName, remaining };
}
/** Force one MCP server to reconnect; shared by the tool and the `/mcp-mgr` command. */
async function mcpReload(ctx, config, server, scope) {
	const entry = findMcpEntry(ctx, config.mcpPlugin, server);
	await ctx.loader.update(entry.id, {});
	// A live loader mutation writes the composed tree back into the leaf; strip
	// MCP entries there so a later patch re-compose never sees a duplicate id.
	await cleanLeafOfMcp(ctx, config.mcpPlugin);
	const updated = findMcpById(ctx, entry.id);
	if (!updated) throw new Error(`MCP server "${server}" disappeared after the reload`);
	return mcpServerValue(ctx, updated, scope);
}
/** Load one MCP server's entry with its redacted config; the `/mcp-mgr get` payload. */
function mcpDetail(ctx, config, server, scope) {
	const entry = findMcpEntry(ctx, config.mcpPlugin, server);
	return {
		...mcpServerValue(ctx, entry, scope),
		config: redactConfig(entry.options.config ?? {})
	};
}
/** Collect every MCP server summary; the `/mcp-mgr snapshot` payload. */
function mcpSnapshot(ctx, config, scope) {
	return { servers: mcpEntries(ctx, config.mcpPlugin).map((entry) => mcpServerValue(ctx, entry, scope)) };
}
//#endregion
//#region skill tools
/** Build the readonly skill lookup for one tool execution. */
function skillLookup(exec) {
	return {
		cwd: exec.agent?.session?.header?.cwd,
		signal: exec.signal,
		scope: exec.agent
	};
}
/** Register the skill-facing tools. */
function registerSkillTools(ctx, config) {
	ctx.tools.register(defineTool({
		name: "skill_manager_list",
		description: "List every skill visible in the current session: name, description, source root, provider, and model/user invocation policy. Use this to discover what skills exist before creating, updating, or deleting one.",
		parameters: {},
		output: jsonOutput(listSchema(SKILL_SUMMARY_SCHEMA)),
		async execute(_args, exec) {
			const skills = await ctx.skills.list(skillLookup(exec));
			return skills.map(skillSummaryValue);
		},
		presentCall: () => present("List skills", "read")
	}));
	ctx.tools.register(defineTool({
		name: "skill_manager_get",
		description: "Get one skill's full definition: body content, absolute file path, source root, invocation policy, and optional metadata. The path is the exact SKILL.md file (or <name>.md) the provider loads.",
		parameters: { name: {
			type: "string",
			required: true,
			description: "Exact skill name from the available skills list."
		} },
		output: jsonOutput({
			type: "object",
			additionalProperties: false,
			properties: {
				name: { type: "string", required: true },
				description: { type: "string", required: true },
				whenToUse: { type: "string" },
				source: { type: "string", required: true },
				provider: { type: "string", required: true },
				modelInvocable: { type: "boolean", required: true },
				userInvocable: { type: "boolean", required: true },
				path: { type: "string" },
				metadata: { type: "object", additionalProperties: true },
				content: { type: "string", required: true }
			}
		}),
		async execute(args, exec) {
			return skillDetail(ctx, config, args.name, skillLookup(exec));
		},
		presentCall: (args) => present("Get skill", "read", args.name)
	}));
	ctx.tools.register(defineTool({
		name: "skill_manager_roots",
		description: "Show every skill root directory the mounted filesystem provider scans for the current workspace, with whether each currently exists and whether the manager may create into it. The roots come from the provider's own configuration, so an overridden dshHome/agentsHome/customSkillDirs is reflected. Use this to decide where a new skill should live.",
		parameters: {},
		output: jsonOutput(listSchema(SKILL_ROOT_SCHEMA)),
		async execute(_args, exec) {
			return describeSkillRoots(ctx, skillLookup(exec).cwd);
		},
		presentCall: () => present("Show skill roots", "read")
	}));
	ctx.tools.register(defineTool({
		name: "skill_manager_create",
		description: "Create a new skill as a <root>/<name>/SKILL.md bundle with validated kebab-case name and YAML frontmatter. The provider picks the new file up within the watcher window, so the skill is available to this session immediately after creation. Fails when a skill with the same name already exists — use skill_manager_update to change an existing skill.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "New kebab-case skill name (lowercase letters, digits, hyphens; e.g. code-review)."
			},
			description: {
				type: "string",
				required: true,
				description: "Short routing description shown in skill catalogs."
			},
			content: {
				type: "string",
				required: true,
				description: "Full Markdown instruction body of the skill."
			},
			when_to_use: {
				type: "string",
				description: "Optional extra routing guidance for when to invoke the skill."
			},
			disable_model_invocation: {
				type: "boolean",
				description: "When true the skill is excluded from model-facing catalogs (default false)."
			},
			user_invocable: {
				type: "boolean",
				description: "When false the skill is excluded from human-facing command catalogs (default true)."
			},
			metadata: {
				type: "object",
				additionalProperties: true,
				description: "Optional structured metadata stored in the frontmatter."
			},
			root: {
				type: "string",
				description: "\"user\" (harness home skills), \"project\" (workspace .dsh/skills), or an absolute custom directory. Defaults to the configured skillDefaultRoot."
			}
		},
		output: jsonOutput(SKILL_SUMMARY_SCHEMA),
		async execute(args, exec) {
			return skillCreate(ctx, config, args, skillLookup(exec));
		},
		presentCall: (args) => present("Create skill", "other", args.name)
	}));
	ctx.tools.register(defineTool({
		name: "skill_manager_update",
		description: "Update an existing skill's frontmatter and/or body in place. Omitting a field keeps its current value; pass null for when_to_use or metadata to remove that field. The provider reloads the body on every load, so edits take effect immediately.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Exact name of the existing skill to update."
			},
			description: {
				type: "string",
				description: "Replacement description; must stay non-empty."
			},
			when_to_use: {
				oneOf: [{ type: "string" }, { type: "null" }],
				description: "Replacement routing guidance, or null to remove it."
			},
			content: {
				type: "string",
				description: "Replacement Markdown body."
			},
			disable_model_invocation: {
				type: "boolean",
				description: "Replacement model-invocation policy."
			},
			user_invocable: {
				type: "boolean",
				description: "Replacement user-invocation policy."
			},
			metadata: {
				oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
				description: "Replacement metadata object, or null to remove it."
			}
		},
		output: jsonOutput(SKILL_SUMMARY_SCHEMA),
		async execute(args, exec) {
			return skillUpdate(ctx, config, args, skillLookup(exec));
		},
		presentCall: (args) => present("Update skill", "other", args.name)
	}));
	ctx.tools.register(defineTool({
		name: "skill_manager_delete",
		description: "Delete an existing skill: removes <root>/<name>/SKILL.md and its bundle directory (or the flat <name>.md file). Destructive — requires confirm: true, which the model should only pass after the user agrees.",
		parameters: {
			name: {
				type: "string",
				required: true,
				description: "Exact name of the skill to delete."
			},
			confirm: {
				type: "boolean",
				required: true,
				description: "Must be true to actually delete; false returns an error."
			}
		},
		output: jsonOutput({
			type: "object",
			additionalProperties: false,
			properties: {
				ok: { type: "boolean", required: true },
				removed: { type: "string", required: true },
				remaining: { type: "integer", required: true }
			}
		}),
		async execute(args, exec) {
			return skillDelete(ctx, config, args, skillLookup(exec));
		},
		presentCall: (args) => present("Delete skill", "other", args.name)
	}));
}
/** Validate a skill name with the same grammar the registry enforces. */
function assertSkillName(value) {
	if (typeof value !== "string" || !isSkillName(value)) throw new Error(`invalid skill name ${JSON.stringify(value)}: must be kebab-case (lowercase letters, digits, hyphens)`);
}
//#endregion
//#region mcp tools
/** Register the MCP-facing tools. */
function registerMcpTools(ctx, config) {
	const mcpPlugin = config.mcpPlugin;
	ctx.tools.register(defineTool({
		name: "mcp_manager_list",
		description: `List every configured MCP server (loader entries named ${mcpPlugin}): entry id, serverName, transport, endpoint, enabled state, live fiber phase, and the tools it currently publishes. Use this before adding, updating, or removing a server.`,
		parameters: {},
		output: jsonOutput(listSchema(MCP_SERVER_SCHEMA)),
		execute(_args, exec) {
			return mcpEntries(ctx, mcpPlugin).map((entry) => mcpServerValue(ctx, entry, exec.agent));
		},
		presentCall: () => present("List MCP servers", "read")
	}));
	ctx.tools.register(defineTool({
		name: "mcp_manager_get",
		description: "Get one MCP server's full loader entry: complete config (env/headers redacted as expression references), live state, and published tool names. Address the server by its serverName or its full loader entry id from mcp_manager_list.",
		parameters: { server: {
			type: "string",
			required: true,
			description: "serverName or full loader entry id of the server to inspect."
		} },
		output: jsonOutput({
			type: "object",
			additionalProperties: false,
			properties: {
				...MCP_SERVER_SCHEMA.properties,
				config: { type: "object", additionalProperties: true, required: true }
			}
		}),
		execute(args, exec) {
			return mcpDetail(ctx, config, args.server, exec.agent);
		},
		presentCall: (args) => present("Get MCP server", "read", args.server)
	}));
	ctx.tools.register(defineTool({
		name: "mcp_manager_add",
		description: `Add a new MCP server by creating an ${mcpPlugin} loader entry: stdio servers spawn a command, streamable-http servers call a URL. The entry persists into the profile's patch layer (cordis.patch.yml) and activates immediately through the patch-layer watcher, so the server survives dsh web restarts. serverName must be unique.`,
		parameters: {
			server_name: {
				type: "string",
				required: true,
				description: "Unique namespace for this server's tools; [A-Za-z0-9_-]{1,32}."
			},
			transport: {
				type: "string",
				required: true,
				enum: ["stdio", "streamable-http"],
				description: "stdio spawns a command; streamable-http calls a URL."
			},
			command: {
				type: "string",
				description: "Executable to spawn (required for stdio)."
			},
			args: {
				type: "array",
				items: { type: "string" },
				description: "Arguments passed to the stdio command."
			},
			env: {
				type: "object",
				additionalProperties: true,
				description: "Extra env vars for the stdio child, merged over scrubbed ambient env."
			},
			cwd: {
				type: "string",
				description: "Working directory for the stdio child process."
			},
			url: {
				type: "string",
				description: "MCP server URL (required for streamable-http)."
			},
			headers: {
				type: "object",
				additionalProperties: true,
				description: "Extra headers such as Authorization for streamable-http."
			},
			tool_call_timeout_ms: {
				type: "number",
				description: "Per-callTool timeout in ms (default 60000)."
			},
			fail_on_startup_error: {
				type: "boolean",
				description: "When true, reject plugin activation if the initial connection or tool sync fails (default false)."
			},
			reconnect_enabled: {
				type: "boolean",
				description: "Reconnect automatically after a lost connection (default true)."
			},
			reconnect_initial_delay_ms: {
				type: "number",
				description: "First reconnect delay in ms (default 500)."
			},
			reconnect_max_delay_ms: {
				type: "number",
				description: "Backoff ceiling in ms (default 30000)."
			},
			reconnect_max_attempts: {
				type: "number",
				description: "Consecutive failed attempts per outage before giving up (default 10)."
			},
			disabled: {
				type: "boolean",
				description: "Create the entry disabled so it is not started (default false)."
			}
		},
		output: jsonOutput({
			type: "object",
			additionalProperties: false,
			properties: {
				...MCP_SERVER_SCHEMA.properties,
				created: { type: "boolean", required: true }
			}
		}),
		async execute(args, exec) {
			return mcpAdd(ctx, config, args, exec.agent);
		},
		presentCall: (args) => present("Add MCP server", "other", args.server_name)
	}));
	ctx.tools.register(defineTool({
		name: "mcp_manager_update",
		description: "Update an existing MCP server's config. Provided fields replace the current values; omitted fields are kept. The loader restarts the entry with the new config (hot swap), so the server reconnects with the new settings. Changing server_name renames the tool namespace and must stay unique.",
		parameters: {
			server: {
				type: "string",
				required: true,
				description: "serverName or full loader entry id of the server to update."
			},
			server_name: {
				type: "string",
				description: "New serverName (unique; renames the tool namespace)."
			},
			transport: {
				type: "string",
				enum: ["stdio", "streamable-http"],
				description: "Switch the transport."
			},
			command: {
				type: "string",
				description: "Replacement stdio command."
			},
			args: {
				type: "array",
				items: { type: "string" },
				description: "Replacement stdio args; pass [] to clear."
			},
			env: {
				type: "object",
				additionalProperties: true,
				description: "Replacement env object; pass {} to clear."
			},
			cwd: {
				type: "string",
				description: "Replacement working directory for the stdio child."
			},
			url: {
				type: "string",
				description: "Replacement streamable-http URL."
			},
			headers: {
				type: "object",
				additionalProperties: true,
				description: "Replacement headers; pass {} to clear."
			},
			tool_call_timeout_ms: {
				type: "number",
				description: "Replacement per-call timeout in ms."
			},
			fail_on_startup_error: {
				type: "boolean",
				description: "Replacement startup-failure policy."
			},
			reconnect_enabled: {
				type: "boolean",
				description: "Replacement reconnect policy."
			},
			reconnect_initial_delay_ms: {
				type: "number",
				description: "Replacement first reconnect delay in ms."
			},
			reconnect_max_delay_ms: {
				type: "number",
				description: "Replacement backoff ceiling in ms."
			},
			reconnect_max_attempts: {
				type: "number",
				description: "Replacement consecutive-failure cap."
			},
			disabled: {
				type: "boolean",
				description: "Enable or disable the entry."
			}
		},
		output: jsonOutput({
			type: "object",
			additionalProperties: false,
			properties: {
				...MCP_SERVER_SCHEMA.properties,
				config: { type: "object", additionalProperties: true, required: true }
			}
		}),
		async execute(args, exec) {
			return mcpUpdate(ctx, config, args, exec.agent);
		},
		presentCall: (args) => present("Update MCP server", "other", args.server)
	}));
	ctx.tools.register(defineTool({
		name: "mcp_manager_remove",
		description: "Remove an MCP server: stops its plugin instance and deletes its entry from the profile's patch layer (cordis.patch.yml). Destructive — requires confirm: true, which the model should only pass after the user agrees.",
		parameters: {
			server: {
				type: "string",
				required: true,
				description: "serverName or full loader entry id of the server to remove."
			},
			confirm: {
				type: "boolean",
				required: true,
				description: "Must be true to actually remove; false returns an error."
			}
		},
		output: jsonOutput({
			type: "object",
			additionalProperties: false,
			properties: {
				ok: { type: "boolean", required: true },
				removed: { type: "string", required: true },
				remaining: { type: "integer", required: true }
			}
		}),
		async execute(args, exec) {
			return mcpRemove(ctx, config, args);
		},
		presentCall: (args) => present("Remove MCP server", "other", args.server)
	}));
	ctx.tools.register(defineTool({
		name: "mcp_manager_reload",
		description: "Force one MCP server to disconnect and reconnect: the loader restarts the entry with its current config, re-running discovery. Use this after an external server came back online or to clear a stuck state.",
		parameters: { server: {
			type: "string",
			required: true,
			description: "serverName or full loader entry id of the server to reload."
		} },
		output: jsonOutput(MCP_SERVER_SCHEMA),
		async execute(args, exec) {
			return mcpReload(ctx, config, args.server, exec.agent);
		},
		presentCall: (args) => present("Reload MCP server", "other", args.server)
	}));
}
/** Resolve an MCP loader entry by serverName or full loader id. */
function findMcpEntry(ctx, mcpPlugin, server) {
	if (typeof server !== "string" || server.trim().length === 0) throw new Error("server is required");
	const byName = findMcpByServerName(ctx, mcpPlugin, server);
	if (byName) return byName;
	const byId = findMcpById(ctx, server);
	if (byId && byId.options.name === mcpPlugin) return byId;
	throw new Error(`no MCP server matches ${JSON.stringify(server)}; run mcp_manager_list to see configured servers`);
}
//#endregion
//#region commands and guidance
/** Render the human-facing skill list for `/skills`. */
async function renderSkillListText(ctx, agent) {
	const skills = await ctx.skills.list({ cwd: agent?.session?.header?.cwd, scope: agent });
	if (skills.length === 0) return "No skills available.";
	const rows = skills.map((skill) => {
		const flags = [skill.invocation.modelInvocable ? "model" : "", skill.invocation.userInvocable ? "user" : ""].filter(Boolean).join("+") || "none";
		return `- ${skill.name} [${skill.source}] [${flags}]: ${skill.description}`;
	});
	return rows.join("\n");
}
/** Render the human-facing MCP list for `/mcp`. */
function renderMcpListText(ctx, mcpPlugin, agent) {
	const entries = mcpEntries(ctx, mcpPlugin);
	if (entries.length === 0) return "No MCP servers configured.";
	return entries.map((entry) => {
		const config = entry.options.config ?? {};
		const endpoint = config.transport === "streamable-http" ? config.url : config.command ?? "?";
		return `- ${config.serverName} [${config.transport}] [${fiberStateLabel(entry) ?? "no fiber"}] [${entry.disabled ? "disabled" : "enabled"}]: ${endpoint}`;
	}).join("\n");
}
/** Register the human-facing `/skills` and `/mcp` commands. */
function registerCommands(ctx, config) {
	ctx.commands.register({
		name: "skills",
		description: "list available DeepSeek Harness skills",
		handler: async (invocation) => ({
			kind: "success",
			text: await renderSkillListText(ctx, invocation.agent)
		})
	});
	ctx.commands.register({
		name: "mcp",
		description: "list configured MCP servers",
		handler: (invocation) => ({
			kind: "success",
			text: renderMcpListText(ctx, config.mcpPlugin, invocation.agent)
		})
	});
}
/** Render the model-facing policy guidance section. */
function guidanceText(mcpPlugin, skillDefaultRoot) {
	return `Manage DeepSeek Harness skills and MCP servers with the skill_manager_* and mcp_manager_* tools. For skills, list then get before creating, updating, or deleting; create writes a kebab-case-named SKILL.md bundle into a provider root (default ${skillDefaultRoot}) and update rewrites frontmatter and body in place. For MCP, list servers before add/update/remove/reload; add and update validate the ${mcpPlugin} config contract, and remove plus skill delete are destructive and require an explicit confirm: true that the model passes only after the user agrees. Changes are durable: skills are files on disk, MCP entries persist in the profile's cordis.patch.yml (the dsh --profile user layer that every boot reads).`;
}
//#endregion
//#region settings RPC channel
/**
 * Authenticated Fetch route the Web Settings page posts to, below Connection's
 * `/api` prefix (the path segment must match `[A-Za-z0-9_$.-]+`).
 *
 * The Settings page deliberately does NOT go through `commands.execute`: every
 * command invocation appends a `command/run` + `command/done` pair to the
 * session log, and the chat renders that pair as a permanent
 * `skill-mgr · {"skills":[…]}` row whose text is the command's whole JSON
 * result. The page lists on mount and refreshes after every mutation, so the
 * command path left several large JSON rows per settings visit. This route
 * writes no session events at all.
 *
 * Two properties of this carrier are load-bearing:
 * - The `/api` prefix route applies Connection's Host/Origin trust fence and
 *   the browser-session check before dispatching here, so an exact Fetch route
 *   never sees an unauthenticated request.
 * - `connection.fetch` is used rather than `connection.rpc.handle` because the
 *   latter registers its own `webServer` prefix route through the Connection
 *   service's owning context, which cannot resolve `webServer` (cordis routes a
 *   service getter's `this.ctx` reads back through the service's own fiber).
 *   The Fetch-route registry writes only into the service's own table and has
 *   no such dependency.
 */
const SETTINGS_PATH = "/api/dsh-skill-mcp-manager";
/** Settings replies are per-session state and must never be cached. */
const NO_STORE_HEADERS = { "cache-control": "no-store" };
/** One successful Connection RPC result. */
function rpcOk(value) {
	return { ok: true, value };
}
/** One failed Connection RPC result (carrier-neutral failure shape). */
function rpcFail(code, message) {
	return {
		ok: false,
		error: {
			code,
			message,
			details: {}
		}
	};
}
/** Narrow an RPC payload to a plain object, tolerating a missing or malformed body. */
function rpcPayload(payload) {
	return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}
/** Read one required non-empty string field out of an RPC payload. */
function requireStringField(payload, field) {
	const value = payload[field];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${field} is required`);
	return value;
}
/**
 * Resolve the skill/MCP lookup context for one RPC payload.
 *
 * The Settings page has no `CommandInvocation`, so it carries the session
 * identity instead: the live Agent (when the host has one mounted) restores the
 * exact cwd and scoped-layer view the command path had, while the session
 * summary's `cwd` keeps project roots working for a session the host is not
 * currently driving. With neither, the read degrades to the global layer and
 * user roots — the same shape a plain `ctx.skills.list()` call has.
 */
function lookupOf(ctx, payload, signal) {
	const sessionId = typeof payload.sessionId === "string" && payload.sessionId.length > 0 ? payload.sessionId : void 0;
	let agent;
	if (sessionId !== void 0) {
		const agents = ctx.get("agents");
		if (agents !== void 0 && typeof agents.get === "function") try {
			agent = agents.get(sessionId);
		} catch {
			agent = void 0;
		}
	}
	const agentCwd = agent?.session?.header?.cwd;
	const cwd = typeof agentCwd === "string" && agentCwd.length > 0 ? agentCwd : typeof payload.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : void 0;
	return {
		cwd,
		signal,
		scope: agent
	};
}
/**
 * Dispatch one Settings endpoint onto the same operations the model-facing
 * tools use. Endpoint names are dotted only for readability; they are opaque
 * strings to this router.
 */
async function dispatchRpc(ctx, config, endpoint, payload, signal) {
	const input = rpcPayload(payload);
	const lookup = lookupOf(ctx, input, signal);
	const mcpPlugin = config.mcpPlugin;
	switch (endpoint) {
		case "skill.snapshot": return skillSnapshot(ctx, config, lookup);
		case "skill.get": return skillDetail(ctx, config, requireStringField(input, "name"), lookup);
		case "skill.create": return skillCreate(ctx, config, input, lookup);
		case "skill.update": return skillUpdate(ctx, config, input, lookup);
		case "skill.delete": return skillDelete(ctx, config, input, lookup);
		case "mcp.snapshot": return mcpSnapshot(ctx, config, lookup.scope);
		case "mcp.get": return mcpDetail(ctx, config, requireStringField(input, "server"), lookup.scope);
		case "mcp.add": return mcpAdd(ctx, config, input, lookup.scope);
		case "mcp.update": return mcpUpdate(ctx, config, input, lookup.scope);
		case "mcp.remove": return mcpRemove(ctx, config, input);
		case "mcp.reload": return mcpReload(ctx, config, requireStringField(input, "server"), lookup.scope);
		default: throw new Error(`unknown endpoint ${JSON.stringify(endpoint)}`);
	}
}
/** Serve the Settings page; failures ride the response envelope's error branch. */
function createSettingsHandler(ctx, config) {
	return async (endpoint, payload, signal) => {
		try {
			return rpcOk(await dispatchRpc(ctx, config, endpoint, payload, signal));
		} catch (error) {
			return rpcFail(`${name}/error`, error instanceof Error ? error.message : String(error));
		}
	};
}
/**
 * Register the Settings route once Connection is live.
 *
 * Nested `ctx.inject` (rather than a fiber dependency) keeps this plugin's own
 * activation independent of the Web profile: a headless or SDK composition
 * simply never installs the route.
 */
function registerSettingsRoute(ctx, config) {
	const handle = createSettingsHandler(ctx, config);
	ctx.inject(["connection"], (connectionCtx) => {
		connectionCtx.connection.fetch.register({
			path: SETTINGS_PATH,
			methods: ["POST"],
			requestBody: "buffered",
			fetch: (request) => serveSettingsRequest(handle, request)
		});
	});
}
/**
 * Answer one Settings request with the JSON envelope the browser half expects.
 *
 * Connection's `/api` prefix route has already applied the Host/Origin trust
 * fence and the browser-session check before dispatching here, and the request
 * body is already bounded by that route's configured cap, so this handler
 * validates only what it owns: the method, the JSON body, and the endpoint.
 */
async function serveSettingsRequest(handle, request) {
	if (request.method !== "POST") return new Response("method not allowed", {
		status: 405,
		headers: NO_STORE_HEADERS
	});
	let body;
	try {
		body = await request.json();
	} catch {
		return new Response("body is not JSON", {
			status: 400,
			headers: NO_STORE_HEADERS
		});
	}
	const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
	const result = await handle(endpoint, body?.payload, request.signal);
	return Response.json(result, { headers: NO_STORE_HEADERS });
}
//#endregion
//#region apply
/** Register every tool, command, guidance section, and the Settings route. */
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	ctx.systemPrompt.section({
		name: GUIDANCE_SECTION,
		order: GUIDANCE_ORDER,
		text: guidanceText(resolved.mcpPlugin, resolved.skillDefaultRoot)
	});
	registerSkillTools(ctx, resolved);
	registerMcpTools(ctx, resolved);
	registerCommands(ctx, resolved);
	registerSettingsRoute(ctx, resolved);
}
//#endregion
export { Config, SETTINGS_PATH, apply, inject, name };
