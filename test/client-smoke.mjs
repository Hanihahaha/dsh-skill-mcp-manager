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
const fakeSessions = { list: { getSnapshot: () => ({ current: "sess-1", byId: { "sess-1": { id: "sess-1", cwd: "E:/tmp/workspace" } } }) } };
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
fakeSessions.list.getSnapshot = () => ({ current: void 0, byId: {} });
const noSession = await skillsInjected.skillsApi.snapshot();
if (noSession.ok !== false || noSession.error !== "no active session") throw new Error("missing session should short-circuit");
globalThis.fetch = realFetch;

console.log("\nCLIENT BUNDLE SMOKE CHECKS PASSED");
