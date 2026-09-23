// Client-bundle smoke test: executes lib/client.js inside a fake browser shell
// (window.__ModuleLoader__), materializes the factory with a react stub, then
// applies the client plugin against a fake ctx and exercises the host route
// through the exposed tab APIs.
//
// The single most important assertion here is negative: the bundle must NOT
// reach the session log. The original transport was `remote.commands.execute`,
// and every invocation of it appends a `command/run` + `command/done` pair that
// the chat renders as a permanent `skill-mgr · {…}` row. This test fails if the
// bundle so much as names that API again.
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
// No session-log-writing transport may survive in EXECUTABLE code. Comments are
// stripped first so the file header may still explain why the command bridge was
// abandoned without tripping this guard.
function stripComments(source) {
	let out = "";
	let quote = null;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (quote !== null) {
			out += char;
			if (char === "\\") {
				out += source[index + 1] ?? "";
				index += 1;
			} else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			continue;
		}
		if (char === "/" && source[index + 1] === "/") {
			while (index < source.length && source[index] !== "\n") index += 1;
			out += "\n";
			continue;
		}
		if (char === "/" && source[index + 1] === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
			index += 1;
			continue;
		}
		out += char;
	}
	return out;
}
const executable = stripComments(code);
for (const forbidden of ["remote.commands", "commands.execute", "/skill-mgr", "/mcp-mgr"]) {
	if (executable.includes(forbidden)) throw new Error(`client bundle must not use the session-logging command bridge (found ${forbidden})`);
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
if (clientExports.inject.includes("remote") || clientExports.inject.includes("remote.commands")) {
	throw new Error("the client plugin must not require the Remote command services");
}
if (!clientExports.inject.includes("connection")) throw new Error("the client plugin must require `connection`");
if (clientExports.SETTINGS_PATH !== "/api/dsh-skill-mcp-manager") throw new Error(`unexpected settings path ${JSON.stringify(clientExports.SETTINGS_PATH)}`);

// ---- fake client ctx ----
const registrations = [];
const slotInjectCalls = [];
const requests = [];
const SETTINGS_PATH = clientExports.SETTINGS_PATH;
/**
 * Since 0.1.7 `ctx.sessions.list` is a pure catalog: the open session is named
 * by the retained main view (`retainedBy.mainView > 0`), not by a `current`
 * field, and `phase` gates the first list pull. The stub models exactly that.
 */
const sessionRow = (id, cwd, retainedBy) => ({ id, cwd, retainedBy, blank: false, running: false, displayTitle: id, updatedAt: 0 });
let listState = {
	phase: "ready",
	ids: ["sess-1"],
	byId: { "sess-1": sessionRow("sess-1", "E:/tmp/workspace", { mainView: 1 }) }
};
const fakeSessions = { list: { getSnapshot: () => listState, subscribe: () => () => {} } };
/** The host route's response stub; reassigned per case below. */
let responder = async () => new Response("not stubbed", { status: 500 });
const okResponse = (value) => new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
// The bundle reaches the host with a plain same-origin fetch; globalThis.fetch is
// the only browser API it uses for transport.
globalThis.fetch = async (url, init) => {
	requests.push({ url, init });
	if (url !== SETTINGS_PATH) throw new Error(`unexpected URL ${url}`);
	if (init?.method !== "POST") throw new Error("the settings route is POST-only");
	if (init.headers?.["content-type"] !== "application/json") throw new Error(`unexpected content-type ${JSON.stringify(init.headers)}`);
	const { endpoint, payload } = JSON.parse(init.body);
	if (typeof endpoint !== "string") throw new Error("every request must name an endpoint");
	if (payload === null || typeof payload !== "object") throw new Error("every request must carry a payload object");
	if (payload.sessionId !== "sess-1") throw new Error(`payload must carry the current session id (got ${JSON.stringify(payload.sessionId)})`);
	if (payload.cwd !== "E:/tmp/workspace") throw new Error(`payload must carry the session cwd (got ${JSON.stringify(payload.cwd)})`);
	return responder(endpoint, payload);
};
responder = async (endpoint) => {
	if (endpoint === "skill.snapshot") return okResponse({ skills: [{ name: "code-review", description: "Review", source: "user-dsh", provider: "filesystem", modelInvocable: true, userInvocable: true }], roots: [{ source: "user-dsh", path: "/tmp/skills", exists: true, writable: true }] });
	if (endpoint === "mcp.snapshot") return okResponse({ servers: [{ serverName: "github", transport: "stdio", command: "npx", enabled: true, state: "active", toolCount: 2, tools: ["mcp__github__x"] }] });
	if (endpoint === "mcp.get") return okResponse({ serverName: "github", transport: "stdio", command: "npx", enabled: true, state: "active", toolCount: 2, tools: [], config: { transport: "stdio", serverName: "github", command: "npx", env: { GITHUB_TOKEN: "**redacted**" } } });
	return okResponse({});
};
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
	sessions: fakeSessions
};

clientExports.apply(fakeCtx);
for (const [, fn] of slotInjectCalls) fn();
console.log("registrations:", registrations.map((r) => `${r.options.name}/${r.options.id}@${r.options.order}`).join(", "));

const section = registrations.find((r) => r.options.name === "settings.section" && r.options.id === "skill-mcp");
if (!section) throw new Error("settings.section skill-mcp not registered");
if (!section.options.children?.["settings.skillmcp.tab"]) throw new Error("section must declare the settings.skillmcp.tab child slot");
// Shipped sections occupy -10..20 (account, general, models, plugins,
// agent-presets); this one must sit after all of them rather than tie.
if (!(section.options.order > 20)) throw new Error(`the section must sort after every shipped section, got order ${section.options.order}`);
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

const endpoints = () => requests.map((request) => JSON.parse(request.init.body).endpoint);
if (!endpoints().includes("skill.snapshot")) throw new Error("skill snapshot must use the settings route");
console.log("settings endpoints:", endpoints().join(" | "));

// every exposed API must map onto a real endpoint
for (const [endpoint, invoke] of [
	["skill.get", () => skillsInjected.skillsApi.get("code-review")],
	["mcp.remove", () => mcpInjected.mcpApi.remove({ server: "github", confirm: true })],
	["mcp.reload", () => mcpInjected.mcpApi.reload("github")]
]) {
	requests.length = 0;
	await invoke();
	if (endpoints()[0] !== endpoint) throw new Error(`expected endpoint ${endpoint}, got ${JSON.stringify(endpoints()[0])}`);
}

// error path: the route returns the envelope's failure branch
responder = async () => new Response(JSON.stringify({ ok: false, error: { code: "skill-mcp-manager/error", message: "boom" } }), { status: 200, headers: { "content-type": "application/json" } });
const failed = await skillsInjected.skillsApi.snapshot();
if (failed.ok !== false || failed.error !== "boom") throw new Error("route failure should surface its message");

// transport failure: a non-2xx response must not be parsed as a result
responder = async () => new Response("nope", { status: 500 });
const broken = await skillsInjected.skillsApi.snapshot();
if (broken.ok !== false || broken.error !== "HTTP 500") throw new Error("HTTP failure should surface its status");

// no session: the page must degrade to its no-session state without calling the host
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("must not call the host without a session"); };
const noSessionCases = [
	["catalog not yet pulled", { phase: "pending", ids: [], byId: {} }],
	["catalog empty", { phase: "ready", ids: [], byId: {} }],
	["no main view retained", { phase: "ready", ids: ["sess-1"], byId: { "sess-1": sessionRow("sess-1", "E:/tmp/workspace", {}) } }],
	["row carries no retainedBy at all", { phase: "ready", ids: ["sess-1"], byId: { "sess-1": { id: "sess-1", cwd: "E:/tmp/workspace" } } }]
];
for (const [label, state] of noSessionCases) {
	listState = state;
	const result = await skillsInjected.skillsApi.snapshot();
	if (result.ok !== false || result.error !== "no active session") {
		throw new Error(`${label} must short-circuit as "no active session", got ${JSON.stringify(result)}`);
	}
}
// and the selection read follows the retained main view, not catalog order
listState = {
	phase: "ready",
	ids: ["sess-other", "sess-1"],
	byId: {
		"sess-other": sessionRow("sess-other", "E:/tmp/other", {}),
		"sess-1": sessionRow("sess-1", "E:/tmp/workspace", { mainView: 1 })
	}
};
globalThis.fetch = async (url, init) => {
	const { payload } = JSON.parse(init.body);
	if (payload.sessionId !== "sess-1") throw new Error(`must address the retained main view, got ${payload.sessionId}`);
	if (payload.cwd !== "E:/tmp/workspace") throw new Error(`must carry the main view cwd, got ${payload.cwd}`);
	return okResponse({});
};
const selected = await skillsInjected.skillsApi.snapshot();
if (selected.ok !== true) throw new Error("a retained main view must be addressable");
globalThis.fetch = realFetch;

console.log("\nCLIENT BUNDLE SMOKE CHECKS PASSED");
