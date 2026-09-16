// Smoke test for dsh-skill-mcp-manager: mounts the plugin in a Cordis context
// with fake services, then exercises every tool's schema compilation, apply
// wiring, and core logic. Skills are backed by real files under a temp
// DSH_HOME so discovery mirrors the filesystem provider; MCP uses a fake
// loader store.
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { dump as dumpYaml, load as parseYaml } from "js-yaml";

const tmpRoot = await mkdtemp(join(tmpdir(), "skill-mgr-"));
process.env.DSH_HOME = tmpRoot; // must be set before any skillRoots() call

const pluginUrl = new URL("../lib/index.js", import.meta.url).href;
const mod = await import(pluginUrl);
console.log("module exports:", Object.keys(mod).sort().join(", "));

// ---- filesystem-backed skill discovery (mirrors the provider's one-level scan) ----
const SKILL_SCAN_ROOTS = [
	{ root: join(tmpRoot, "skills"), source: "user-dsh" },
	{ root: join(tmpRoot, ".dsh", "skills"), source: "project-dsh" },
	{ root: join(tmpRoot, ".agents", "skills"), source: "project-agents" }
];
async function discoverSkills() {
	const result = [];
	for (const { root, source } of SKILL_SCAN_ROOTS) {
		let entries;
		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name === ".system") continue;
			let file;
			if (entry.isDirectory()) file = join(root, entry.name, "SKILL.md");
			else if (entry.isFile() && entry.name.endsWith(".md")) file = join(root, entry.name);
			else continue;
			let raw;
			try {
				raw = await readFile(file, "utf8");
			} catch {
				continue;
			}
			const firstEnd = raw.indexOf("\n");
			if (firstEnd < 0 || raw.slice(0, firstEnd).trim() !== "---") continue;
			const close = raw.indexOf("\n---", firstEnd + 1);
			if (close < 0) continue;
			let data;
			try {
				data = parseYaml(raw.slice(firstEnd + 1, close));
			} catch {
				continue;
			}
			if (!data || typeof data.name !== "string") continue;
			result.push({
				name: data.name,
				description: data.description ?? "",
				whenToUse: typeof data.whenToUse === "string" ? data.whenToUse : void 0,
				source,
				provider: "filesystem",
				invocation: {
					modelInvocable: data["disable-model-invocation"] !== true,
					userInvocable: data["user-invocable"] !== false
				},
				path: file,
				content: raw.slice(close + 4).trim(),
				metadata: data.metadata
			});
		}
	}
	return result;
}

// ---- fake services ----
const registeredTools = [];
const registeredCommands = [];
const guidanceSections = [];
const loaderStore = new Map(); // id -> Entry-shaped record
let nextId = 0;
const makeEntry = (options) => ({
	id: options.id,
	options,
	disabled: options.disabled === true,
	fiber: void 0
});
const fakeLoader = {
	entries() {
		return [...loaderStore.values()];
	},
	resolve(id) {
		if (!loaderStore.has(id)) throw new Error(`cannot resolve entry ${id}`);
		return loaderStore.get(id);
	},
	async create(options) {
		const id = options.id ?? `auto-${nextId++}`;
		loaderStore.set(id, makeEntry({ ...options, id }));
		return id;
	},
	async update(id, options) {
		const entry = loaderStore.get(id);
		if (!entry) throw new Error(`cannot update entry ${id}`);
		if (options.config !== void 0) entry.options = { ...entry.options, config: options.config };
		if (options.disabled !== void 0) entry.options = { ...entry.options, disabled: options.disabled };
		entry.disabled = entry.options.disabled === true;
	},
	async remove(id) {
		loaderStore.delete(id);
	}
};
const skillsRoot = join(tmpRoot, "skills");
let registeredRoute;
const ctx = new Context();
ctx.provide("systemPrompt", { section: (section) => { guidanceSections.push(section); return () => {}; } });
ctx.provide("tools", { register: (tool) => { registeredTools.push(tool); return () => {}; }, schemas: () => [] });
ctx.provide("commands", { register: (def) => { registeredCommands.push(def); return () => {}; } });
ctx.provide("loader", fakeLoader);
ctx.provide("skills", {
	async list() { return discoverSkills(); },
	async get(name) { return (await discoverSkills()).find((s) => s.name === name); }
});
ctx.provide("connection", { fetch: { register: (route) => { registeredRoute = route; return () => {}; } } });

const exec = { agent: { session: { header: { cwd: tmpRoot } } }, signal: new AbortController().signal };

try {
	mod.apply(ctx, {});
	console.log("guidance sections:", guidanceSections.length, "->", guidanceSections[0]?.name);
	console.log("tools registered:", registeredTools.map((t) => t.name).sort().join(", "));
	console.log("commands registered:", registeredCommands.map((c) => c.name).sort().join(", "));
	if (registeredTools.length !== 12) throw new Error(`expected 12 tools, got ${registeredTools.length}`);
	// Only the human-facing pair remains: the Settings page uses the host route,
	// and the old /skill-mgr + /mcp-mgr machine commands are gone with it.
	if (registeredCommands.length !== 2) throw new Error(`expected 2 commands, got ${registeredCommands.length}`);
	if (guidanceSections.length !== 1) throw new Error(`expected 1 guidance section, got ${guidanceSections.length}`);

	// `ctx.inject` starts a child fiber, so the route registers one tick after
	// apply() rather than inside it — apply() must not block activation on the
	// Web transport.
	for (let attempt = 0; attempt < 100 && registeredRoute === void 0; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	if (registeredRoute === void 0) throw new Error("the Settings route was not registered");

	const tools = Object.fromEntries(registeredTools.map((t) => [t.name, t]));
	const commands = Object.fromEntries(registeredCommands.map((c) => [c.name, c]));

	// ---- human commands still work ----
	const skillsList = await commands.skills.handler({ agent: exec.agent, rawInput: "", signal: new AbortController().signal, commandId: "test" });
	if (skillsList.kind !== "success") throw new Error("/skills should succeed");
	const mcpList = commands.mcp.handler({ agent: exec.agent, rawInput: "", signal: new AbortController().signal, commandId: "test" });
	if (mcpList.kind !== "success") throw new Error("/mcp should succeed");

	// ---- skills ----
	const create = await tools.skill_manager_create.execute({ name: "code-review", description: "Review code for bugs", content: "Check edge cases.\n", when_to_use: "After writing code" }, exec);
	console.log("create result:", JSON.stringify(create));
	if (create.source !== "user-dsh") throw new Error(`expected user-dsh source, got ${create.source}`);
	const reviewPath = join(tmpRoot, "skills", "code-review", "SKILL.md");
	const raw = await readFile(reviewPath, "utf8");
	console.log("--- written SKILL.md ---\n" + raw + "---");
	if (!raw.startsWith("---\nname: code-review")) throw new Error("frontmatter missing name");

	let duplicateRejected = false;
	try {
		await tools.skill_manager_create.execute({ name: "code-review", description: "x", content: "y" }, exec);
	} catch { duplicateRejected = true; }
	if (!duplicateRejected) throw new Error("duplicate create should have failed");

	let invalidRejected = false;
	try {
		await tools.skill_manager_create.execute({ name: "Bad Name", description: "x", content: "y" }, exec);
	} catch { invalidRejected = true; }
	if (!invalidRejected) throw new Error("invalid name should have failed");

	const updated = await tools.skill_manager_update.execute({ name: "code-review", description: "Review code thoroughly", disable_model_invocation: true }, exec);
	console.log("update result:", JSON.stringify(updated));
	if (updated.description !== "Review code thoroughly") throw new Error("description not updated");
	if (updated.modelInvocable !== false) throw new Error("modelInvocable should be false");
	if (updated.userInvocable !== true) throw new Error("userInvocable should stay true");

	// update removing whenToUse via null
	const cleared = await tools.skill_manager_update.execute({ name: "code-review", when_to_use: null }, exec);
	if (cleared.whenToUse !== void 0) throw new Error("whenToUse should be removed");

	const got = await tools.skill_manager_get.execute({ name: "code-review" }, exec);
	console.log("get path:", got.path, "| content:", JSON.stringify(got.content));
	if (!got.path.replaceAll("\\", "/").endsWith("code-review/SKILL.md")) throw new Error("unexpected path");

	const roots = await tools.skill_manager_roots.execute({}, exec);
	console.log("roots:", JSON.stringify(roots.map((r) => [r.source, r.exists, r.writable])));
	if (!roots.some((r) => r.source === "user-dsh" && r.path === skillsRoot)) throw new Error("missing user-dsh root");
	if (!roots.every((r) => typeof r.writable === "boolean")) throw new Error("every root must report writability");
	if (roots.find((r) => r.source === "user-dsh")?.writable !== true) throw new Error("the user root must be writable");

	// The roots must come from the mounted provider's own config, not a hardcoded
	// list: a profile that overrides agentsHome/customSkillDirs/bundledSkillDir
	// would otherwise be described wrongly (and created into the wrong place).
	const altAgentsHome = join(tmpRoot, "alt-agents");
	const customRoot = join(tmpRoot, "custom-skills");
	const bundledRoot = join(tmpRoot, "bundled-skills");
	loaderStore.set("skill-fs", makeEntry({
		id: "skill-fs",
		name: "@deepseek-ai/dsh-skill-filesystem",
		config: {
			dshHome: tmpRoot,
			agentsHome: altAgentsHome,
			customSkillDirs: [customRoot],
			bundledSkillDir: bundledRoot
		}
	}));
	const configuredRoots = await tools.skill_manager_roots.execute({}, exec);
	console.log("configured roots:", JSON.stringify(configuredRoots.map((r) => [r.source, r.path])));
	const bySource = Object.fromEntries(configuredRoots.map((r) => [r.source, r]));
	if (bySource["user-agents"]?.path !== join(altAgentsHome, "skills")) throw new Error("agentsHome override not honored");
	if (bySource["custom"]?.path !== customRoot) throw new Error("customSkillDirs not surfaced");
	if (bySource["bundled"]?.path !== bundledRoot) throw new Error("bundledSkillDir not surfaced");
	if (bySource["bundled"]?.writable !== false) throw new Error("the bundled root must be report-only");
	if (bySource["user-dsh"]?.path !== skillsRoot) throw new Error("dshHome override not honored");
	loaderStore.delete("skill-fs");

	// create into project root
	const projectCreate = await tools.skill_manager_create.execute({ name: "proj-skill", description: "Project skill", content: "Body", root: "project" }, exec);
	console.log("project create:", JSON.stringify(projectCreate));
	if (projectCreate.source !== "project-dsh") throw new Error("expected project-dsh source");

	let noConfirmRejected = false;
	try {
		await tools.skill_manager_delete.execute({ name: "code-review", confirm: false }, exec);
	} catch { noConfirmRejected = true; }
	if (!noConfirmRejected) throw new Error("delete without confirm should fail");

	const del = await tools.skill_manager_delete.execute({ name: "code-review", confirm: true }, exec);
	console.log("delete:", JSON.stringify(del));
	if (!del.ok) throw new Error("delete failed");

	// ---- MCP ----
	const added = await tools.mcp_manager_add.execute({
		server_name: "github",
		transport: "stdio",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-github"],
		env: { GITHUB_TOKEN: "tok" }
	}, exec);
	console.log("mcp add:", JSON.stringify(added));
	if (added.serverName !== "github" || added.transport !== "stdio") throw new Error("bad add result");

	let dupServerRejected = false;
	try {
		await tools.mcp_manager_add.execute({ server_name: "github", transport: "stdio", command: "npx" }, exec);
	} catch { dupServerRejected = true; }
	if (!dupServerRejected) throw new Error("duplicate serverName should fail");

	let badServerRejected = false;
	try {
		await tools.mcp_manager_add.execute({ server_name: "bad name!", transport: "stdio", command: "npx" }, exec);
	} catch { badServerRejected = true; }
	if (!badServerRejected) throw new Error("invalid serverName should fail");

	let httpNoUrlRejected = false;
	try {
		await tools.mcp_manager_add.execute({ server_name: "web", transport: "streamable-http" }, exec);
	} catch { httpNoUrlRejected = true; }
	if (!httpNoUrlRejected) throw new Error("http without url should fail");

	const addedHttp = await tools.mcp_manager_add.execute({
		server_name: "web",
		transport: "streamable-http",
		url: "http://localhost:3000/mcp",
		headers: { Authorization: "Bearer x" }
	}, exec);
	console.log("mcp add http:", JSON.stringify(addedHttp));

	const list = await tools.mcp_manager_list.execute({}, exec);
	console.log("mcp list:", JSON.stringify(list.map((s) => [s.serverName, s.transport, s.enabled, s.state])));
	if (list.length !== 2) throw new Error(`expected 2 servers, got ${list.length}`);

	// Fiber state labels must follow cordis 4.0.2's Fiber.State numbering, where
	// DISPOSED is 4 and UNLOADING is 5 — a positional table mislabels both.
	const github = [...loaderStore.values()].find((candidate) => candidate.options.config?.serverName === "github");
	for (const [state, expected] of [[0, "pending"], [1, "loading"], [2, "active"], [3, "failed"], [4, null], [5, "unloading"], [9, "state:9"]]) {
		github.fiber = { state };
		const row = (await tools.mcp_manager_list.execute({}, exec)).find((s) => s.serverName === "github");
		if (row.state !== expected) throw new Error(`fiber state ${state} must label as ${JSON.stringify(expected)}, got ${JSON.stringify(row.state)}`);
	}
	github.fiber = void 0;

	const updatedMcp = await tools.mcp_manager_update.execute({ server: "github", tool_call_timeout_ms: 120000, reconnect_enabled: false }, exec);
	console.log("mcp update config:", JSON.stringify(updatedMcp.config));
	if (updatedMcp.config.toolCallTimeoutMs !== 120000) throw new Error("timeout not updated");
	if (updatedMcp.config.reconnect?.enabled !== false) throw new Error("reconnect not updated");

	const switched = await tools.mcp_manager_update.execute({ server: "github", transport: "streamable-http", url: "http://x/mcp" }, exec);
	console.log("mcp transport switch config:", JSON.stringify(switched.config));
	if (switched.config.command !== void 0 || switched.config.args !== void 0 || switched.config.url !== "http://x/mcp") throw new Error("transport switch failed");

	const byId = await tools.mcp_manager_get.execute({ server: added.id }, exec);
	console.log("get by id:", byId.serverName, "| config keys:", Object.keys(byId.config).join(","));

	const reloaded = await tools.mcp_manager_reload.execute({ server: "web" }, exec);
	console.log("reload:", reloaded.serverName, reloaded.state);

	let noConfirmMcp = false;
	try {
		await tools.mcp_manager_remove.execute({ server: "github", confirm: false }, exec);
	} catch { noConfirmMcp = true; }
	if (!noConfirmMcp) throw new Error("remove without confirm should fail");

	const removed = await tools.mcp_manager_remove.execute({ server: "github", confirm: true }, exec);
	console.log("mcp remove:", JSON.stringify(removed));
	if (removed.remaining !== 1) throw new Error(`expected 1 remaining, got ${removed.remaining}`);

	// update unknown server fails
	let unknownServer = false;
	try {
		await tools.mcp_manager_update.execute({ server: "nope" }, exec);
	} catch { unknownServer = true; }
	if (!unknownServer) throw new Error("update of unknown server should fail");

	// ---- Settings route ----
	// The Web Settings page posts here, NOT to commands: a command invocation
	// would append `command/run` + `command/done` rows to the session log
	// (rendered by the chat as a permanent `skill-mgr · {…}` row), which is
	// exactly what this route avoids.
	if (registeredRoute.path !== mod.SETTINGS_PATH) throw new Error(`unexpected route path ${registeredRoute.path}`);
	if (!registeredRoute.path.startsWith("/api/")) throw new Error("the route must live below Connection's /api prefix");
	if (registeredRoute.requestBody !== "buffered") throw new Error("the route must declare a buffered request body");
	if (registeredRoute.methods.join(",") !== "POST") throw new Error(`unexpected methods ${registeredRoute.methods.join(",")}`);
	const call = async (endpoint, payload) => {
		const response = await registeredRoute.fetch(new Request(`http://dsh.internal${registeredRoute.path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ endpoint, payload })
		}));
		return { status: response.status, body: await response.json() };
	};

	let snap = await call("skill.snapshot", { sessionId: "sess-1", cwd: tmpRoot });
	console.log("skill.snapshot:", JSON.stringify(snap.body.value).slice(0, 160));
	if (snap.status !== 200 || !snap.body.ok) throw new Error(`skill.snapshot failed: ${snap.body.error?.message}`);
	if (!Array.isArray(snap.body.value.skills) || !Array.isArray(snap.body.value.roots)) throw new Error("snapshot payload shape wrong");
	if (!snap.body.value.roots.every((root) => typeof root.writable === "boolean")) throw new Error("roots must report writability");

	const createdViaRoute = await call("skill.create", { sessionId: "sess-1", cwd: tmpRoot, name: "rpc-skill", description: "From the settings page", content: "Body text", when_to_use: "Testing" });
	console.log("skill.create:", JSON.stringify(createdViaRoute.body.value));
	if (!createdViaRoute.body.ok || createdViaRoute.body.value.name !== "rpc-skill") throw new Error("skill.create failed");

	const gotViaRoute = await call("skill.get", { sessionId: "sess-1", cwd: tmpRoot, name: "rpc-skill" });
	if (!gotViaRoute.body.ok || gotViaRoute.body.value.content !== "Body text" || !gotViaRoute.body.value.path) throw new Error("skill.get failed");

	const deleteNoConfirm = await call("skill.delete", { sessionId: "sess-1", cwd: tmpRoot, name: "rpc-skill" });
	if (deleteNoConfirm.body.ok) throw new Error("delete without confirm must fail");
	if (!deleteNoConfirm.body.error.message.includes("confirm")) throw new Error("delete failure must name the missing confirmation");

	const deletedViaRoute = await call("skill.delete", { sessionId: "sess-1", cwd: tmpRoot, name: "rpc-skill", confirm: true });
	console.log("skill.delete:", JSON.stringify(deletedViaRoute.body.value));
	if (!deletedViaRoute.body.ok || deletedViaRoute.body.value.ok !== true) throw new Error("skill.delete failed");

	const unknownEndpoint = await call("skill.nope", {});
	if (unknownEndpoint.body.ok || !unknownEndpoint.body.error.message.includes("unknown endpoint")) throw new Error("unknown endpoint must fail loudly");
	if (unknownEndpoint.body.error.code !== "skill-mcp-manager/error") throw new Error(`unexpected error code ${unknownEndpoint.body.error.code}`);

	const missingField = await call("skill.get", {});
	if (missingField.body.ok || !missingField.body.error.message.includes("name is required")) throw new Error("missing required field must fail");

	const mcpSnap = await call("mcp.snapshot", { sessionId: "sess-1", cwd: tmpRoot });
	console.log("mcp.snapshot:", JSON.stringify(mcpSnap.body.value).slice(0, 160));
	if (!mcpSnap.body.ok || !Array.isArray(mcpSnap.body.value.servers) || mcpSnap.body.value.servers.length !== 1) throw new Error("mcp snapshot payload wrong");

	const addViaRoute = await call("mcp.add", { sessionId: "sess-1", cwd: tmpRoot, server_name: "cmd-server", transport: "streamable-http", url: "http://cmd/mcp" });
	console.log("mcp.add:", JSON.stringify(addViaRoute.body.value));
	if (!addViaRoute.body.ok) throw new Error("mcp.add failed");

	// secrets must be redacted in get
	const getViaRoute = await call("mcp.get", { sessionId: "sess-1", cwd: tmpRoot, server: "cmd-server" });
	console.log("mcp.get config:", JSON.stringify(getViaRoute.body.value.config));
	if (!getViaRoute.body.ok || getViaRoute.body.value.config.url !== "http://cmd/mcp") throw new Error("mcp.get failed");

	const updViaRoute = await call("mcp.update", { sessionId: "sess-1", cwd: tmpRoot, server: "cmd-server", tool_call_timeout_ms: 30000 });
	console.log("mcp.update:", JSON.stringify(updViaRoute.body.value.config));
	if (!updViaRoute.body.ok || updViaRoute.body.value.config.toolCallTimeoutMs !== 30000) throw new Error("mcp.update failed");

	const reloadViaRoute = await call("mcp.reload", { sessionId: "sess-1", cwd: tmpRoot, server: "cmd-server" });
	if (!reloadViaRoute.body.ok) throw new Error("mcp.reload failed");

	const remViaRoute = await call("mcp.remove", { sessionId: "sess-1", cwd: tmpRoot, server: "cmd-server", confirm: true });
	console.log("mcp.remove:", JSON.stringify(remViaRoute.body.value));
	if (!remViaRoute.body.ok || remViaRoute.body.value.ok !== true) throw new Error("mcp.remove failed");

	const removeNoConfirm = await call("mcp.remove", { sessionId: "sess-1", cwd: tmpRoot, server: "cmd-server" });
	if (removeNoConfirm.body.ok) throw new Error("mcp remove without confirm must fail");

	// The payload may omit the session entirely: the read still works against the
	// global skill layer, and a malformed payload must not crash the route.
	const noSession = await call("skill.snapshot", {});
	if (!noSession.body.ok) throw new Error(`session-less snapshot failed: ${noSession.body.error?.message}`);
	const malformed = await call("skill.snapshot", null);
	if (!malformed.body.ok) throw new Error(`null payload snapshot failed: ${malformed.body.error?.message}`);

	// Only POST is served, and a non-JSON body is rejected rather than thrown.
	const wrongMethod = await registeredRoute.fetch(new Request(`http://dsh.internal${registeredRoute.path}`, { method: "GET" }));
	if (wrongMethod.status !== 405) throw new Error(`GET must be rejected with 405, got ${wrongMethod.status}`);
	const badBody = await registeredRoute.fetch(new Request(`http://dsh.internal${registeredRoute.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
	if (badBody.status !== 400) throw new Error(`a torn body must be rejected with 400, got ${badBody.status}`);

	console.log("\nALL SMOKE CHECKS PASSED");
} finally {
	await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}
