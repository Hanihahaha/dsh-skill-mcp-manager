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
const ctx = new Context();
ctx.provide("systemPrompt", { section: (section) => { guidanceSections.push(section); return () => {}; } });
ctx.provide("tools", { register: (tool) => { registeredTools.push(tool); return () => {}; }, schemas: () => [] });
ctx.provide("commands", { register: (def) => { registeredCommands.push(def); return () => {}; } });
ctx.provide("loader", fakeLoader);
ctx.provide("skills", {
	async list() { return discoverSkills(); },
	async get(name) { return (await discoverSkills()).find((s) => s.name === name); }
});

const exec = { agent: { session: { header: { cwd: tmpRoot } } }, signal: new AbortController().signal };

try {
	mod.apply(ctx, {});
	console.log("guidance sections:", guidanceSections.length, "->", guidanceSections[0]?.name);
	console.log("tools registered:", registeredTools.map((t) => t.name).sort().join(", "));
	console.log("commands registered:", registeredCommands.map((c) => c.name).sort().join(", "));
	if (registeredTools.length !== 12) throw new Error(`expected 12 tools, got ${registeredTools.length}`);
	if (registeredCommands.length !== 4) throw new Error(`expected 4 commands, got ${registeredCommands.length}`);
	if (guidanceSections.length !== 1) throw new Error(`expected 1 guidance section, got ${guidanceSections.length}`);

	const tools = Object.fromEntries(registeredTools.map((t) => [t.name, t]));
	const commands = Object.fromEntries(registeredCommands.map((c) => [c.name, c]));
	const runCommand = async (name, line) => {
		const result = await commands[name].handler({ agent: exec.agent, rawInput: line, signal: new AbortController().signal, commandId: "test" });
		return result;
	};

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
	console.log("roots:", JSON.stringify(roots.map((r) => [r.source, r.exists])));
	if (!roots.some((r) => r.source === "user-dsh" && r.path === skillsRoot)) throw new Error("missing user-dsh root");

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
	console.log("mcp list:", JSON.stringify(list.map((s) => [s.serverName, s.transport, s.enabled])));
	if (list.length !== 2) throw new Error(`expected 2 servers, got ${list.length}`);

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

	// ---- /skill-mgr JSON protocol ----
	let snap = await runCommand("skill-mgr", " snapshot");
	console.log("skill-mgr snapshot:", snap.text.slice(0, 160));
	if (snap.kind !== "success") throw new Error("snapshot should succeed");
	const snapData = JSON.parse(snap.text);
	if (!Array.isArray(snapData.skills) || !Array.isArray(snapData.roots)) throw new Error("snapshot payload shape wrong");

	const createdViaCmd = await runCommand("skill-mgr", " create " + JSON.stringify({ name: "cmd-skill", description: "From command", content: "Body text", when_to_use: "Testing" }));
	console.log("skill-mgr create:", createdViaCmd.text);
	if (createdViaCmd.kind !== "success" || JSON.parse(createdViaCmd.text).name !== "cmd-skill") throw new Error("create via command failed");

	const gotViaCmd = await runCommand("skill-mgr", " get " + JSON.stringify("cmd-skill"));
	const gotData = JSON.parse(gotViaCmd.text);
	if (gotData.content !== "Body text" || !gotData.path) throw new Error("get via command failed");

	let unknownVerb = await runCommand("skill-mgr", " nope");
	if (unknownVerb.kind !== "error") throw new Error("unknown verb should error");

	let deleteNoConfirm = await runCommand("skill-mgr", " delete " + JSON.stringify({ name: "cmd-skill" }));
	if (deleteNoConfirm.kind !== "error") throw new Error("delete without confirm should error");
	const deletedViaCmd = await runCommand("skill-mgr", " delete " + JSON.stringify({ name: "cmd-skill", confirm: true }));
	console.log("skill-mgr delete:", deletedViaCmd.text);
	if (deletedViaCmd.kind !== "success") throw new Error("delete via command failed");

	// ---- /mcp-mgr JSON protocol ----
	const mcpSnap = await runCommand("mcp-mgr", " snapshot");
	console.log("mcp-mgr snapshot:", mcpSnap.text.slice(0, 160));
	if (mcpSnap.kind !== "success") throw new Error("mcp snapshot should succeed");
	const mcpSnapData = JSON.parse(mcpSnap.text);
	if (!Array.isArray(mcpSnapData.servers) || mcpSnapData.servers.length !== 1) throw new Error("mcp snapshot payload wrong");

	const addViaCmd = await runCommand("mcp-mgr", " add " + JSON.stringify({ server_name: "cmd-server", transport: "streamable-http", url: "http://cmd/mcp" }));
	console.log("mcp-mgr add:", addViaCmd.text);
	if (addViaCmd.kind !== "success") throw new Error("add via command failed");

	// secrets must be redacted in get
	const getViaCmd = await runCommand("mcp-mgr", " get " + JSON.stringify("cmd-server"));
	const getData = JSON.parse(getViaCmd.text);
	console.log("mcp-mgr get config:", JSON.stringify(getData.config));
	if (getData.config.url !== "http://cmd/mcp") throw new Error("get via command failed");

	const updViaCmd = await runCommand("mcp-mgr", " update " + JSON.stringify({ server: "cmd-server", tool_call_timeout_ms: 30000 }));
	console.log("mcp-mgr update:", updViaCmd.text);
	if (updViaCmd.kind !== "success" || JSON.parse(updViaCmd.text).config.toolCallTimeoutMs !== 30000) throw new Error("update via command failed");

	const reloadViaCmd = await runCommand("mcp-mgr", " reload " + JSON.stringify("cmd-server"));
	if (reloadViaCmd.kind !== "success") throw new Error("reload via command failed");

	const remViaCmd = await runCommand("mcp-mgr", " remove " + JSON.stringify({ server: "cmd-server", confirm: true }));
	console.log("mcp-mgr remove:", remViaCmd.text);
	if (remViaCmd.kind !== "success") throw new Error("remove via command failed");

	console.log("\nALL SMOKE CHECKS PASSED");
} finally {
	await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}
