// Client-bundle smoke test: executes lib/client.js inside a fake browser shell
// (window.__ModuleLoader__), materializes the factory with a react stub, then
// applies the client plugin against a fake ctx and exercises the command
// bridge (remote.commands.execute) through the exposed tab APIs.
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const topLevelSkillEditor = 'editing === "new" ? h(SkillForm';
const inlineSkillEditor = "editing === skill.name ? h(SkillForm";
const topLevelMcpEditor = 'editing === "new" ? h(McpForm';
const inlineMcpEditor = "editing === server.serverName ? h(McpForm";
for (const editor of [topLevelSkillEditor, inlineSkillEditor, topLevelMcpEditor, inlineMcpEditor]) {
	if (!code.includes(editor)) throw new Error(`missing expected editor placement: ${editor}`);
}
if (code.includes('editing !== null ? h(SkillForm') || code.includes('editing !== null ? h(McpForm')) {
	throw new Error("existing item editors must render inside their corresponding cards");
}
let loaded = null;
const windowShim = { __ModuleLoader__: { load: (record) => { loaded = record; } } };
const reactStub = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	Fragment: Symbol("fragment"),
	useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useRef: () => ({}),
	useId: () => "sm-id"
};
const requireShim = (spec) => {
	if (spec === "react") return reactStub;
	throw new Error(`unexpected require(${spec})`);
};
new Function("window", "require", code)(windowShim, requireShim);
if (!loaded) throw new Error("bundle did not register with __ModuleLoader__");
if (loaded.id !== "dsh-skill-mcp-manager") throw new Error(`unexpected bundle id ${loaded.id}`);

const clientExports = loaded.factory(requireShim);
console.log("client exports:", Object.keys(clientExports).sort().join(", "));
if (typeof clientExports.apply !== "function" || !Array.isArray(clientExports.inject)) throw new Error("client plugin contract missing");

// ---- fake client ctx ----
const registrations = [];
const slotInjectCalls = [];
const executedLines = [];
const fakeSessions = { list: { getSnapshot: () => ({ current: "sess-1" }) } };
const fakeCtx = {
	effect: () => () => {},
	get: (name) => (name === "sessions" ? fakeSessions : void 0),
	locale: {
		register: () => {},
		bind: () => (key) => key,
		getSnapshot: () => ({ revision: 0 }),
		subscribe: () => () => {}
	},
	slots: {
		inject: (name, fn) => { slotInjectCalls.push([name, fn]); },
		register: (options, component) => { registrations.push({ options, component }); return () => {}; },
		entries: () => [],
		getVersion: () => 0,
		subscribe: () => () => {}
	},
	remote: {
		commands: {
			execute: async (sessionId, line) => {
				executedLines.push([sessionId, line]);
				let payload;
				if (line === "/skill-mgr snapshot") payload = { skills: [{ name: "code-review", description: "Review", source: "user-dsh", provider: "filesystem", modelInvocable: true, userInvocable: true }], roots: [{ source: "user-dsh", path: "/tmp/skills", exists: true }] };
				else if (line === "/mcp-mgr snapshot") payload = { servers: [{ serverName: "github", transport: "stdio", command: "npx", enabled: true, state: "active", toolCount: 2, tools: ["mcp__github__x"] }] };
				else if (line.startsWith("/mcp-mgr get ")) payload = { serverName: "github", transport: "stdio", command: "npx", enabled: true, state: "active", toolCount: 2, tools: [], config: { transport: "stdio", serverName: "github", command: "npx", env: { GITHUB_TOKEN: "**redacted**" } } };
				else throw new Error(`unexpected command line ${line}`);
				return { ok: true, value: { commandId: "c1", result: { kind: "success", text: JSON.stringify(payload) } } };
			}
		}
	},
	sessions: fakeSessions
};

clientExports.apply(fakeCtx);
for (const [, fn] of slotInjectCalls) fn();
console.log("registrations:", registrations.map((r) => `${r.options.name}/${r.options.id}@${r.options.order}`).join(", "));

const section = registrations.find((r) => r.options.name === "settings.section" && r.options.id === "skill-mcp");
if (!section) throw new Error("settings.section skill-mcp not registered");
if (!section.options.children?.["settings.skillmcp.tab"]) throw new Error("section must declare the settings.skillmcp.tab child slot");
const skillsTab = registrations.find((r) => r.options.id === "skills");
const mcpTab = registrations.find((r) => r.options.id === "mcp");
if (!skillsTab || !mcpTab) throw new Error("skills/mcp tabs not registered");
if (skillsTab.options.order >= mcpTab.options.order) throw new Error("tab order wrong");

// exercise the injected tab APIs
const skillsInjected = skillsTab.options.inject();
const skillsSnapshot = await skillsInjected.skillsApi.snapshot();
console.log("skillsApi.snapshot:", JSON.stringify(skillsSnapshot));
if (!skillsSnapshot.ok || skillsSnapshot.data.skills[0].name !== "code-review") throw new Error("skillsApi.snapshot failed");

const mcpInjected = mcpTab.options.inject();
const mcpSnapshot = await mcpInjected.mcpApi.snapshot();
if (!mcpSnapshot.ok || mcpSnapshot.data.servers[0].serverName !== "github") throw new Error("mcpApi.snapshot failed");
const mcpDetail = await mcpInjected.mcpApi.get("github");
if (mcpDetail.data.config.env.GITHUB_TOKEN !== "**redacted**") throw new Error("secrets must be redacted on the wire");

if (!executedLines.some(([, line]) => line === "/skill-mgr snapshot")) throw new Error("command bridge not used for skills");
console.log("executed command lines:", executedLines.map(([, line]) => line).join(" | "));

// error path: remote returns error result
fakeCtx.remote.commands.execute = async () => ({ ok: true, value: { commandId: "c2", result: { kind: "error", text: "boom" } } });
const failed = await skillsInjected.skillsApi.snapshot();
if (failed.ok !== false || failed.error !== "boom") throw new Error("error result should surface");

console.log("\nCLIENT BUNDLE SMOKE CHECKS PASSED");
