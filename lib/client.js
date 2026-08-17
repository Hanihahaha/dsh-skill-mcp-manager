// dsh-skill-mcp-manager browser bundle (hand-built lazy-CJS plugin).
// The web shell's ClientModuleLoader executes this file as a classic script:
// window.__ModuleLoader__.load({ id, factory }) only REGISTERS the factory;
// materialization runs factory(require) and memoizes the exports. The module
// table resolves bare specifiers (react, @deepseek-ai/*) to other registered
// client bundles or the shell's static registry.
//
// The client half contributes a "Skill & MCP" section to Web Settings with a
// Skills tab and an MCP tab. All data crosses the host through the fixed wire
// contract: ctx.remote.commands.execute(sessionId, "/skill-mgr ...") and
// "/mcp-mgr ..." run the host plugin's JSON-protocol commands; the command
// lifecycle records each mutation in the session log as an audit node.
window.__ModuleLoader__.load({
	id: "dsh-skill-mcp-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region styles
		const css = [
			".sm-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}",
			".sm-section h2{margin:0;font-size:18px;line-height:26px;font-weight:600}",
			".sm-intro{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}",
			".sm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 2px}",
			".sm-tab{font:inherit;color:var(--dsw-alias-label-secondary);background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;cursor:pointer;font-size:13px;line-height:18px;margin-bottom:-1px}",
			".sm-tab:hover{color:var(--dsw-alias-label-primary)}",
			".sm-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}",
			".sm-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px;border-radius:4px}",
			".sm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px}",
			".sm-list{display:flex;flex-direction:column;gap:10px}",
			".sm-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;overflow:hidden}",
			".sm-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px}",
			".sm-cardTitle{font-size:14px;font-weight:600;line-height:20px;min-width:0;overflow-wrap:anywhere}",
			".sm-cardMeta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}",
			".sm-badge{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:5px;padding:1px 7px;font-size:11px;line-height:16px;white-space:nowrap}",
			".sm-badge[data-tone=success]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);color:var(--dsw-alias-state-success-primary)}",
			".sm-badge[data-tone=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent);color:var(--dsw-alias-state-warning-primary)}",
			".sm-badge[data-tone=error]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);color:var(--dsw-alias-state-error-primary)}",
			".sm-badge[data-tone=muted]{color:var(--dsw-alias-label-tertiary)}",
			".sm-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:0;padding:0 14px 10px}",
			".sm-desc code{font-family:var(--ds-font-family-code);font-size:11px;background:var(--dsw-alias-bg-layer-1);border-radius:4px;padding:0 4px}",
			".sm-actions{display:flex;align-items:center;gap:6px;flex:none}",
			".sm-btn{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 10px;font-size:12px;line-height:18px;cursor:pointer}",
			".sm-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".sm-btn:disabled{opacity:.5;cursor:default}",
			".sm-btn[data-kind=primary]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-inverse-label-primary,#fff)}",
			".sm-btn[data-kind=danger]{color:var(--dsw-alias-state-error-primary)}",
			".sm-btn[data-kind=ghost]{background:none;border-color:transparent}",
			".sm-form{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);padding:12px 14px}",
			".sm-field{display:flex;flex-direction:column;gap:4px}",
			".sm-field label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}",
			".sm-field .sm-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0}",
			".sm-input,.sm-textarea,.sm-select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:13px;line-height:18px;width:100%;box-sizing:border-box}",
			".sm-textarea{min-height:110px;resize:vertical;font-family:var(--ds-font-family-code)}",
			".sm-input:focus-visible,.sm-textarea:focus-visible,.sm-select:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);outline:none}",
			".sm-row{display:flex;gap:10px;align-items:flex-start}",
			".sm-row>.sm-field{flex:1;min-width:0}",
			".sm-check{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".sm-check input{accent-color:var(--dsw-alias-state-business-primary)}",
			".sm-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0}",
			".sm-notice{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0}",
			".sm-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}",
			".sm-status{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".sm-dot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-label-tertiary);flex:none;display:inline-block}",
			".sm-dot[data-phase=active]{background:var(--dsw-alias-state-success-primary)}",
			".sm-dot[data-phase=failed]{background:var(--dsw-alias-state-error-primary)}",
			".sm-dot[data-phase=loading]{background:var(--dsw-alias-state-business-primary)}",
			".sm-spin{width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;display:inline-block;animation:sm-spin .8s linear infinite}",
			"@keyframes sm-spin{to{transform:rotate(360deg)}}"
		].join("");
		const tagId = "dsh-skill-mcp-manager/settings.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-mcp-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region locale
		const NS = "settings.skillMcp";
		const zh = {
			nav: "技能与 MCP",
			title: "Skill 与 MCP 管理",
			intro: "管理 DeepSeek Harness 的技能文件与 MCP 服务器。所有变更即时生效并持久化;破坏性操作需要确认。",
			tabs: "标签页",
			skillsTab: "技能",
			mcpTab: "MCP",
			empty: "暂无内容。",
			loading: "正在读取…",
			error: "读取失败",
			retry: "重试",
			noSession: "需要先打开或新建一个会话,设置页才能读写 Harness。",
			refresh: "刷新",
			newSkill: "新建技能",
			skillName: "名称 (kebab-case)",
			skillNameHint: "小写字母、数字与连字符,例如 code-review。创建后不可改名。",
			skillDescription: "描述",
			skillWhenToUse: "使用场景 (可选)",
			skillContent: "正文 (Markdown)",
			skillRoot: "存放位置",
			rootUser: "用户级 (~/.dsh/skills)",
			rootProject: "项目级 (.dsh/skills)",
			rootCustom: "自定义目录 (绝对路径)",
			disableModelInvocation: "仅限用户调用(对模型隐藏)",
			userInvocable: "允许用户调用",
			save: "保存",
			cancel: "取消",
			edit: "编辑",
			remove: "删除",
			reload: "重载",
			confirmDeleteSkill: "确认删除技能",
			confirmDeleteSkillBody: "删除 {name} 会移除整个技能目录,且无法撤销。",
			confirmDeleteMcp: "确认移除服务器",
			confirmDeleteMcpBody: "移除 {name} 会停止其实例并删除持久化配置。",
			confirm: "确认删除",
			modelOnly: "模型",
			userOnly: "用户",
			sourceUser: "用户级",
			sourceProject: "项目级",
			sourceOther: "其他",
			invocationNone: "未启用",
			created: "已创建 {name}",
			updated: "已更新 {name}",
			deleted: "已删除 {name}",
			addMcp: "添加服务器",
			mcpServerName: "服务器名称 (serverName)",
			mcpServerNameHint: "字母、数字、下划线、连字符,最长 32 位;作为工具命名空间。",
			mcpTransport: "传输方式",
			mcpCommand: "命令 (command)",
			mcpArgs: "参数 (args, 空格分隔)",
			mcpEnv: "环境变量 (每行 KEY=VALUE)",
			mcpEnvHint: "已配置的值不会回显;留空保持现有配置。",
			mcpCwd: "工作目录 (cwd)",
			mcpUrl: "URL",
			mcpHeaders: "请求头 (每行 Key: Value)",
			mcpHeadersHint: "已配置的值不会回显;留空保持现有配置。",
			mcpTimeout: "单次调用超时 (ms)",
			mcpReconnect: "断线自动重连",
			mcpDisabled: "暂不启用(创建后不启动)",
			stdio: "stdio (本地进程)",
			streamableHttp: "streamable-http (HTTP 服务)",
			transportStdio: "stdio",
			transportHttp: "streamable-http",
			stateActive: "运行中",
			stateLoading: "加载中",
			stateFailed: "失败",
			statePending: "等待中",
			stateUnloading: "卸载中",
			stateNone: "未挂载",
			enabled: "已启用",
			disabled: "已停用",
			reloaded: "已重载 {name}",
			removed: "已移除 {name}",
			toolCount: "{count} 个工具",
			noTools: "暂无工具",
			writeError: "操作失败: {message}"
		};
		const en = {
			nav: "Skill & MCP",
			title: "Skill & MCP management",
			intro: "Manage DeepSeek Harness skill files and MCP servers. Changes take effect immediately and persist; destructive operations require confirmation.",
			tabs: "Tabs",
			skillsTab: "Skills",
			mcpTab: "MCP",
			empty: "Nothing here yet.",
			loading: "Loading…",
			error: "Failed to load",
			retry: "Retry",
			noSession: "Open or create a session first; this settings page needs an active session to read and write the harness.",
			refresh: "Refresh",
			newSkill: "New skill",
			skillName: "Name (kebab-case)",
			skillNameHint: "Lowercase letters, digits and hyphens, e.g. code-review. Cannot be renamed after creation.",
			skillDescription: "Description",
			skillWhenToUse: "When to use (optional)",
			skillContent: "Body (Markdown)",
			skillRoot: "Root",
			rootUser: "User (~/.dsh/skills)",
			rootProject: "Project (.dsh/skills)",
			rootCustom: "Custom directory (absolute path)",
			disableModelInvocation: "User-only (hidden from the model)",
			userInvocable: "Allow user invocation",
			save: "Save",
			cancel: "Cancel",
			edit: "Edit",
			remove: "Remove",
			reload: "Reload",
			confirmDeleteSkill: "Delete skill?",
			confirmDeleteSkillBody: "Deleting {name} removes its whole directory and cannot be undone.",
			confirmDeleteMcp: "Remove server?",
			confirmDeleteMcpBody: "Removing {name} stops its instance and deletes the persisted config.",
			confirm: "Delete",
			modelOnly: "Model",
			userOnly: "User",
			sourceUser: "User",
			sourceProject: "Project",
			sourceOther: "Other",
			invocationNone: "Disabled",
			created: "Created {name}",
			updated: "Updated {name}",
			deleted: "Deleted {name}",
			addMcp: "Add server",
			mcpServerName: "Server name (serverName)",
			mcpServerNameHint: "Letters, digits, underscores, hyphens; max 32 chars; the tool namespace.",
			mcpTransport: "Transport",
			mcpCommand: "Command",
			mcpArgs: "Args (space separated)",
			mcpEnv: "Environment (one KEY=VALUE per line)",
			mcpEnvHint: "Existing values are not echoed; leave empty to keep them.",
			mcpCwd: "Working directory",
			mcpUrl: "URL",
			mcpHeaders: "Headers (one Key: Value per line)",
			mcpHeadersHint: "Existing values are not echoed; leave empty to keep them.",
			mcpTimeout: "Per-call timeout (ms)",
			mcpReconnect: "Auto reconnect",
			mcpDisabled: "Do not start yet (create disabled)",
			stdio: "stdio (local process)",
			streamableHttp: "streamable-http (HTTP service)",
			transportStdio: "stdio",
			transportHttp: "streamable-http",
			stateActive: "Active",
			stateLoading: "Loading",
			stateFailed: "Failed",
			statePending: "Pending",
			stateUnloading: "Unloading",
			stateNone: "Not mounted",
			enabled: "Enabled",
			disabled: "Disabled",
			reloaded: "Reloaded {name}",
			removed: "Removed {name}",
			toolCount: "{count} tools",
			noTools: "No tools",
			writeError: "Operation failed: {message}"
		};
		//#endregion
		//#region helpers
		const h = react.createElement;
		const useState = react.useState;
		const useEffect = react.useEffect;
		const useMemo = react.useMemo;
		const useId = react.useId;
		/** Resolve a slot label that may be a function, string, or absent. */
		function resolveLabel(label) {
			if (typeof label === "function") return label() ?? "";
			return typeof label === "string" ? label : "";
		}
		/** Human phase label for a server state. */
		function stateLabel(state, t) {
			switch (state) {
				case "active": return t("stateActive");
				case "loading": return t("stateLoading");
				case "failed": return t("stateFailed");
				case "pending": return t("statePending");
				case "unloading": return t("stateUnloading");
				default: return t("stateNone");
			}
		}
		/** Skill source label. */
		function sourceLabel(source, t) {
			if (source === "user-dsh" || source === "user-agents") return t("sourceUser");
			if (source === "project-dsh" || source === "project-agents") return t("sourceProject");
			return t("sourceOther");
		}
		/** Invocation badge text. */
		function invocationLabel(skill, t) {
			if (skill.modelInvocable && skill.userInvocable) return "model+user";
			if (skill.modelInvocable) return t("modelOnly");
			if (skill.userInvocable) return t("userOnly");
			return t("invocationNone");
		}
		/** Parse "K=V" lines into a plain object; returns undefined on invalid input. */
		function parseKeyValueLines(text, linePattern) {
			const trimmed = (text ?? "").trim();
			if (trimmed.length === 0) return {};
			const out = {};
			for (const line of trimmed.split(/\r?\n/)) {
				const entry = line.trim();
				if (entry.length === 0) continue;
				const match = linePattern.exec(entry);
				if (!match) return void 0;
				out[match[1].trim()] = match[2].trim();
			}
			return out;
		}
		//#endregion
		//#region section
		/** Settings section shell: localized tabs around the Skills and MCP pages. */
		function SkillMcpSection({ t, renderSlot, useTabs }) {
			const tabsId = useId();
			const tabRefs = react.useRef([]);
			const rows = useTabs((value) => value);
			const [activeId, setActiveId] = useState();
			const [visitedIds, setVisitedIds] = useState(() => new Set());
			const active = rows.find((row) => row.id === activeId)?.id ?? rows[0]?.id;
			useEffect(() => {
				if (active === void 0) return;
				setVisitedIds((previous) => {
					if (previous.has(active)) return previous;
					return new Set([...previous, active]);
				});
			}, [active]);
			return h("div", { className: "sm-section" },
				h("h2", null, t("title")),
				h("p", { className: "sm-intro" }, t("intro")),
				rows.length === 0 ? h("p", { className: "sm-empty" }, t("empty")) :
				h(react.Fragment, null,
					h("div", { className: "sm-tabs", role: "tablist", "aria-label": t("tabs") },
						rows.map((row, index) => {
							const selected = row.id === active;
							return h("button", {
								key: row.id,
								ref: (element) => { tabRefs.current[index] = element; },
								id: `${tabsId}-tab-${row.id}`,
								type: "button",
								role: "tab",
								className: "sm-tab",
								"aria-selected": selected,
								"aria-controls": `${tabsId}-panel-${row.id}`,
								"data-active": selected ? "true" : void 0,
								tabIndex: selected ? 0 : -1,
								onClick: () => setActiveId(row.id),
								onKeyDown: (event) => {
									let nextIndex;
									switch (event.key) {
										case "ArrowRight": nextIndex = (index + 1) % rows.length; break;
										case "ArrowLeft": nextIndex = (index - 1 + rows.length) % rows.length; break;
										case "Home": nextIndex = 0; break;
										case "End": nextIndex = rows.length - 1; break;
										default: return;
									}
									event.preventDefault();
									setActiveId(rows[nextIndex].id);
									tabRefs.current[nextIndex]?.focus();
								}
							}, row.label);
						})
					),
					rows.filter((row) => row.id === active || visitedIds.has(row.id)).map((row) => {
						const selected = row.id === active;
						return h("div", {
							key: row.id,
							id: `${tabsId}-panel-${row.id}`,
							className: "sm-panel",
							role: "tabpanel",
							"aria-labelledby": `${tabsId}-tab-${row.id}`,
							hidden: !selected
						}, renderSlot("settings.skillmcp.tab", {}, { only: row.id }));
					})
				)
			);
		}
		//#endregion
		//#region skills tab
		/** Skills management page: snapshot list plus a create/edit form. */
		function SkillsTab({ t, skillsApi }) {
			const [state, setState] = useState({ status: "loading" });
			const [editing, setEditing] = useState(null); // null | "new" | skill name
			const [notice, setNotice] = useState(null);
			const [error, setError] = useState(null);
			const refresh = () => {
				setState({ status: "loading" });
				Promise.resolve().then(() => skillsApi.snapshot()).then((result) => {
					if (!result.ok) {
						if (result.error === "no active session") setState({ status: "no-session" });
						else setState({ status: "error" });
						return;
					}
					setState({ status: "ready", snapshot: result.data });
				}, () => setState({ status: "error" }));
			};
			useEffect(refresh, []);
			useEffect(() => {
				if (notice === null) return;
				const timer = setTimeout(() => setNotice(null), 4000);
				return () => clearTimeout(timer);
			}, [notice]);
			const onDone = (message) => {
				setEditing(null);
				setError(null);
				setNotice(message);
				refresh();
			};
			if (state.status === "no-session") return h("p", { className: "sm-empty" }, t("noSession"));
			if (state.status === "error") return h("div", { className: "sm-toolbar" },
				h("p", { className: "sm-error", role: "alert" }, t("error")),
				h("button", { type: "button", className: "sm-btn", onClick: refresh }, t("retry"))
			);
			const snapshot = state.snapshot ?? { skills: [], roots: [] };
			return h("div", { className: "sm-section" },
				h("div", { className: "sm-toolbar" },
					state.status === "loading" ? h("span", { className: "sm-status" }, h("span", { className: "sm-spin" }), t("loading")) :
					h("span", { className: "sm-notice" }, `${snapshot.skills.length} skills`),
					h("div", { className: "sm-actions" },
						h("button", { type: "button", className: "sm-btn", onClick: refresh, disabled: state.status === "loading" }, t("refresh")),
						editing === null ? h("button", { type: "button", className: "sm-btn", "data-kind": "primary", onClick: () => { setEditing("new"); setError(null); } }, t("newSkill")) : null
					)
				),
				notice !== null ? h("p", { className: "sm-notice" }, notice) : null,
				error !== null ? h("p", { className: "sm-error", role: "alert" }, error) : null,
				editing === "new" ? h(SkillForm, { key: "new", t, skillsApi, name: null, snapshot, onSave: onDone, onCancel: () => { setEditing(null); setError(null); } }) : null,
				snapshot.skills.length === 0 ? h("p", { className: "sm-empty" }, t("empty")) :
				h("div", { className: "sm-list" }, snapshot.skills.map((skill) =>
					h("div", { key: skill.name, className: "sm-card" },
						h("div", { className: "sm-cardHead" },
							h("span", { className: "sm-cardTitle" }, skill.name),
							h("div", { className: "sm-cardMeta" },
								h("span", { className: "sm-badge" }, sourceLabel(skill.source, t)),
								h("span", { className: "sm-badge", "data-tone": skill.modelInvocable ? "success" : "muted" }, invocationLabel(skill, t)),
								h("div", { className: "sm-actions" },
									h("button", { type: "button", className: "sm-btn", onClick: () => { setEditing(skill.name); setError(null); } }, t("edit")),
									h("button", { type: "button", className: "sm-btn", "data-kind": "danger", onClick: () => confirmRemove(t, t("confirmDeleteSkill"), t("confirmDeleteSkillBody").replace("{name}", skill.name), () => {
										skillsApi.remove({ name: skill.name, confirm: true }).then((result) => {
											if (!result.ok) setError(t("writeError").replace("{message}", result.error));
											else onDone(t("deleted").replace("{name}", skill.name));
										});
									}) }, t("remove"))
								)
							)
						),
						h("p", { className: "sm-desc" }, skill.description),
						editing === skill.name ? h(SkillForm, { key: skill.name, embedded: true, t, skillsApi, name: skill.name, snapshot, onSave: onDone, onCancel: () => { setEditing(null); setError(null); } }) : null
					)
				))
			);
		}
		/** Native confirmation dialog for destructive actions. */
		function confirmRemove(t, title, body, onConfirm) {
			if (typeof window === "undefined") return;
			if (window.confirm(`${title}\n\n${body}`)) onConfirm();
		}
		/** Skill create/edit form. */
		function SkillForm({ t, skillsApi, name, snapshot, onSave, onCancel, embedded = false }) {
			const isNew = name === null;
			const [draft, setDraft] = useState(() => ({
				name: name ?? "",
				description: "",
				whenToUse: "",
				content: "",
				disableModelInvocation: false,
				userInvocable: true,
				root: "user"
			}));
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);
			const set = (field) => (event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }));
			useEffect(() => {
				if (isNew) return;
				let current = true;
				skillsApi.get(name).then((result) => {
					if (!current || !result.ok) return;
					setDraft({
						name: result.data.name,
						description: result.data.description ?? "",
						whenToUse: result.data.whenToUse ?? "",
						content: result.data.content ?? "",
						disableModelInvocation: !result.data.modelInvocable,
						userInvocable: result.data.userInvocable,
						root: "user"
					});
				});
				return () => { current = false; };
			}, [name]);
			const submit = () => {
				const payload = {
					name: draft.name.trim(),
					description: draft.description.trim(),
					content: draft.content,
					...(draft.whenToUse.trim().length > 0 ? { when_to_use: draft.whenToUse.trim() } : {}),
					disable_model_invocation: draft.disableModelInvocation,
					user_invocable: draft.userInvocable,
					...(isNew ? { root: draft.root } : {})
				};
				setBusy(true);
				setError(null);
				const call = isNew ? skillsApi.create(payload) : skillsApi.update(payload);
				call.then((result) => {
					setBusy(false);
					if (!result.ok) setError(t("writeError").replace("{message}", result.error));
					else onSave(t(isNew ? "created" : "updated").replace("{name}", payload.name));
				}, () => setBusy(false));
			};
			return h("div", { className: embedded ? "sm-inlineForm" : "sm-card" },
				h("div", { className: "sm-cardHead" },
					h("span", { className: "sm-cardTitle" }, isNew ? t("newSkill") : t("edit")),
					h("div", { className: "sm-actions" },
						h("button", { type: "button", className: "sm-btn", "data-kind": "ghost", onClick: onCancel, disabled: busy }, t("cancel")),
						h("button", { type: "button", className: "sm-btn", "data-kind": "primary", onClick: submit, disabled: busy }, t("save"))
					)
				),
				h("div", { className: "sm-form" },
					h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-skill-name" }, t("skillName")),
						h("input", { id: "sm-skill-name", className: "sm-input", value: draft.name, onChange: set("name"), disabled: !isNew || busy, spellCheck: false }),
						h("p", { className: "sm-hint" }, t("skillNameHint"))
					),
					h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-skill-desc" }, t("skillDescription")),
						h("input", { id: "sm-skill-desc", className: "sm-input", value: draft.description, onChange: set("description"), disabled: busy })
					),
					h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-skill-when" }, t("skillWhenToUse")),
						h("input", { id: "sm-skill-when", className: "sm-input", value: draft.whenToUse, onChange: set("whenToUse"), disabled: busy })
					),
					h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-skill-content" }, t("skillContent")),
						h("textarea", { id: "sm-skill-content", className: "sm-textarea", value: draft.content, onChange: set("content"), disabled: busy })
					),
					isNew ? h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-skill-root" }, t("skillRoot")),
						h("select", { id: "sm-skill-root", className: "sm-select", value: draft.root, onChange: set("root"), disabled: busy },
							h("option", { value: "user" }, t("rootUser")),
							h("option", { value: "project" }, t("rootProject"))
						)
					) : null,
					h("div", { className: "sm-row" },
						h("label", { className: "sm-check" },
							h("input", { type: "checkbox", checked: draft.disableModelInvocation, onChange: (e) => setDraft((p) => ({ ...p, disableModelInvocation: e.target.checked })), disabled: busy }),
							t("disableModelInvocation")
						),
						h("label", { className: "sm-check" },
							h("input", { type: "checkbox", checked: draft.userInvocable, onChange: (e) => setDraft((p) => ({ ...p, userInvocable: e.target.checked })), disabled: busy }),
							t("userInvocable")
						)
					),
					error !== null ? h("p", { className: "sm-error", role: "alert" }, error) : null
				)
			);
		}
		//#endregion
		//#region mcp tab
		/** MCP servers page: snapshot list plus a create/edit form. */
		function McpTab({ t, mcpApi }) {
			const [state, setState] = useState({ status: "loading" });
			const [editing, setEditing] = useState(null); // null | "new" | serverName
			const [notice, setNotice] = useState(null);
			const [error, setError] = useState(null);
			const refresh = () => {
				setState({ status: "loading" });
				Promise.resolve().then(() => mcpApi.snapshot()).then((result) => {
					if (!result.ok) {
						if (result.error === "no active session") setState({ status: "no-session" });
						else setState({ status: "error" });
						return;
					}
					setState({ status: "ready", snapshot: result.data });
				}, () => setState({ status: "error" }));
			};
			useEffect(refresh, []);
			useEffect(() => {
				if (notice === null) return;
				const timer = setTimeout(() => setNotice(null), 4000);
				return () => clearTimeout(timer);
			}, [notice]);
			const onDone = (message) => {
				setEditing(null);
				setError(null);
				setNotice(message);
				refresh();
			};
			if (state.status === "no-session") return h("p", { className: "sm-empty" }, t("noSession"));
			if (state.status === "error") return h("div", { className: "sm-toolbar" },
				h("p", { className: "sm-error", role: "alert" }, t("error")),
				h("button", { type: "button", className: "sm-btn", onClick: refresh }, t("retry"))
			);
			const servers = state.snapshot?.servers ?? [];
			return h("div", { className: "sm-section" },
				h("div", { className: "sm-toolbar" },
					state.status === "loading" ? h("span", { className: "sm-status" }, h("span", { className: "sm-spin" }), t("loading")) :
					h("span", { className: "sm-notice" }, `${servers.length} servers`),
					h("div", { className: "sm-actions" },
						h("button", { type: "button", className: "sm-btn", onClick: refresh, disabled: state.status === "loading" }, t("refresh")),
						editing === null ? h("button", { type: "button", className: "sm-btn", "data-kind": "primary", onClick: () => { setEditing("new"); setError(null); } }, t("addMcp")) : null
					)
				),
				notice !== null ? h("p", { className: "sm-notice" }, notice) : null,
				error !== null ? h("p", { className: "sm-error", role: "alert" }, error) : null,
				editing === "new" ? h(McpForm, { key: "new", t, mcpApi, serverName: null, onSave: onDone, onCancel: () => { setEditing(null); setError(null); } }) : null,
				servers.length === 0 ? h("p", { className: "sm-empty" }, t("empty")) :
				h("div", { className: "sm-list" }, servers.map((server) =>
					h("div", { key: server.serverName, className: "sm-card" },
						h("div", { className: "sm-cardHead" },
							h("span", { className: "sm-cardTitle" }, server.serverName),
							h("div", { className: "sm-cardMeta" },
								h("span", { className: "sm-badge" }, server.transport === "streamable-http" ? t("transportHttp") : t("transportStdio")),
								h("span", { className: "sm-badge", "data-tone": server.enabled ? "success" : "muted" }, server.enabled ? t("enabled") : t("disabled")),
								h("span", { className: "sm-status" },
									h("span", { className: "sm-dot", "data-phase": server.state ?? "none" }),
									stateLabel(server.state, t)
								),
								h("div", { className: "sm-actions" },
									h("button", { type: "button", className: "sm-btn", onClick: () => { setEditing(server.serverName); setError(null); } }, t("edit")),
									h("button", { type: "button", className: "sm-btn", onClick: () => {
										mcpApi.reload(server.serverName).then((result) => {
											if (!result.ok) setError(t("writeError").replace("{message}", result.error));
											else { setNotice(t("reloaded").replace("{name}", server.serverName)); refresh(); }
										});
									} }, t("reload")),
									h("button", { type: "button", className: "sm-btn", "data-kind": "danger", onClick: () => confirmRemove(t, t("confirmDeleteMcp"), t("confirmDeleteMcpBody").replace("{name}", server.serverName), () => {
										mcpApi.remove({ server: server.serverName, confirm: true }).then((result) => {
											if (!result.ok) setError(t("writeError").replace("{message}", result.error));
											else onDone(t("removed").replace("{name}", server.serverName));
										});
									}) }, t("remove"))
								)
							)
						),
						h("p", { className: "sm-desc" },
							server.transport === "streamable-http" ? h("code", null, server.url ?? "") : h("code", null, server.command ?? ""),
							server.toolCount > 0 ? ` · ${t("toolCount").replace("{count}", String(server.toolCount))}` : ` · ${t("noTools")}`
						),
						editing === server.serverName ? h(McpForm, { key: server.serverName, embedded: true, t, mcpApi, serverName: server.serverName, onSave: onDone, onCancel: () => { setEditing(null); setError(null); } }) : null
					)
				))
			);
		}
		/** MCP server create/edit form (patch semantics: omitted fields are kept). */
		function McpForm({ t, mcpApi, serverName, onSave, onCancel, embedded = false }) {
			const isNew = serverName === null;
			const [draft, setDraft] = useState(() => ({
				serverName: serverName ?? "",
				transport: "stdio",
				command: "",
				args: "",
				env: "",
				cwd: "",
				url: "",
				headers: "",
				timeout: "",
				reconnect: true,
				disabled: false
			}));
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);
			const set = (field) => (event) => setDraft((previous) => ({ ...previous, [field]: event.target.value }));
			useEffect(() => {
				if (isNew) return;
				let current = true;
				mcpApi.get(serverName).then((result) => {
					if (!current || !result.ok) return;
					const config = result.data.config ?? {};
					setDraft({
						serverName: result.data.serverName ?? "",
						transport: config.transport === "streamable-http" ? "streamable-http" : "stdio",
						command: typeof config.command === "string" ? config.command : "",
						args: Array.isArray(config.args) ? config.args.join(" ") : "",
						env: "",
						cwd: typeof config.cwd === "string" ? config.cwd : "",
						url: typeof config.url === "string" ? config.url : "",
						headers: "",
						timeout: typeof config.toolCallTimeoutMs === "number" ? String(config.toolCallTimeoutMs) : "",
						reconnect: config.reconnect?.enabled !== false,
						disabled: result.data.enabled === false
					});
				});
				return () => { current = false; };
			}, [serverName]);
			const submit = () => {
				const payload = { server_name: draft.serverName.trim() };
				payload.transport = draft.transport;
				if (draft.transport === "stdio") {
					payload.command = draft.command.trim();
					const args = draft.args.trim().split(/\s+/).filter(Boolean);
					if (args.length > 0) payload.args = args;
					if (draft.cwd.trim().length > 0) payload.cwd = draft.cwd.trim();
					if (draft.env.trim().length > 0) {
						const env = parseKeyValueLines(draft.env, /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
						if (env === void 0) { setError(t("writeError").replace("{message}", "env: expected KEY=VALUE per line")); return; }
						payload.env = env;
					}
				} else {
					payload.url = draft.url.trim();
					if (draft.headers.trim().length > 0) {
						const headers = parseKeyValueLines(draft.headers, /^([^:]+)\s*:\s*(.*)$/);
						if (headers === void 0) { setError(t("writeError").replace("{message}", "headers: expected Key: Value per line")); return; }
						payload.headers = headers;
					}
				}
				if (draft.timeout.trim().length > 0) {
					const timeout = Number(draft.timeout.trim());
					if (!Number.isFinite(timeout) || timeout <= 0) { setError(t("writeError").replace("{message}", "timeout must be a positive number")); return; }
					payload.tool_call_timeout_ms = timeout;
				}
				payload.reconnect_enabled = draft.reconnect;
				if (!isNew) payload.server = serverName;
				setBusy(true);
				setError(null);
				const call = isNew ? mcpApi.add(payload) : mcpApi.update(payload);
				call.then((result) => {
					setBusy(false);
					if (!result.ok) setError(t("writeError").replace("{message}", result.error));
					else onSave(t(isNew ? "created" : "updated").replace("{name}", payload.server_name));
				}, () => setBusy(false));
			};
			const stdio = draft.transport === "stdio";
			return h("div", { className: embedded ? "sm-inlineForm" : "sm-card" },
				h("div", { className: "sm-cardHead" },
					h("span", { className: "sm-cardTitle" }, isNew ? t("addMcp") : t("edit")),
					h("div", { className: "sm-actions" },
						h("button", { type: "button", className: "sm-btn", "data-kind": "ghost", onClick: onCancel, disabled: busy }, t("cancel")),
						h("button", { type: "button", className: "sm-btn", "data-kind": "primary", onClick: submit, disabled: busy }, t("save"))
					)
				),
				h("div", { className: "sm-form" },
					h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-mcp-name" }, t("mcpServerName")),
						h("input", { id: "sm-mcp-name", className: "sm-input", value: draft.serverName, onChange: set("serverName"), disabled: busy, spellCheck: false }),
						h("p", { className: "sm-hint" }, t("mcpServerNameHint"))
					),
					h("div", { className: "sm-field" },
						h("label", { htmlFor: "sm-mcp-transport" }, t("mcpTransport")),
						h("select", { id: "sm-mcp-transport", className: "sm-select", value: draft.transport, onChange: set("transport"), disabled: busy },
							h("option", { value: "stdio" }, t("stdio")),
							h("option", { value: "streamable-http" }, t("streamableHttp"))
						)
					),
					stdio ? h(react.Fragment, null,
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-command" }, t("mcpCommand")),
							h("input", { id: "sm-mcp-command", className: "sm-input", value: draft.command, onChange: set("command"), disabled: busy, spellCheck: false })
						),
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-args" }, t("mcpArgs")),
							h("input", { id: "sm-mcp-args", className: "sm-input", value: draft.args, onChange: set("args"), disabled: busy, spellCheck: false })
						),
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-cwd" }, t("mcpCwd")),
							h("input", { id: "sm-mcp-cwd", className: "sm-input", value: draft.cwd, onChange: set("cwd"), disabled: busy, spellCheck: false })
						),
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-env" }, t("mcpEnv")),
							h("textarea", { id: "sm-mcp-env", className: "sm-textarea", style: { minHeight: "70px" }, value: draft.env, onChange: set("env"), disabled: busy, placeholder: "KEY=VALUE", spellCheck: false }),
							h("p", { className: "sm-hint" }, t("mcpEnvHint"))
						)
					) : h(react.Fragment, null,
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-url" }, t("mcpUrl")),
							h("input", { id: "sm-mcp-url", className: "sm-input", value: draft.url, onChange: set("url"), disabled: busy, spellCheck: false })
						),
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-headers" }, t("mcpHeaders")),
							h("textarea", { id: "sm-mcp-headers", className: "sm-textarea", style: { minHeight: "70px" }, value: draft.headers, onChange: set("headers"), disabled: busy, placeholder: "Authorization: Bearer ...", spellCheck: false }),
							h("p", { className: "sm-hint" }, t("mcpHeadersHint"))
						)
					),
					h("div", { className: "sm-row" },
						h("div", { className: "sm-field" },
							h("label", { htmlFor: "sm-mcp-timeout" }, t("mcpTimeout")),
							h("input", { id: "sm-mcp-timeout", className: "sm-input", value: draft.timeout, onChange: set("timeout"), disabled: busy, inputMode: "numeric" })
						),
						h("label", { className: "sm-check", style: { marginTop: "22px" } },
							h("input", { type: "checkbox", checked: draft.reconnect, onChange: (e) => setDraft((p) => ({ ...p, reconnect: e.target.checked })), disabled: busy }),
							t("mcpReconnect")
						)
					),
					isNew ? h("label", { className: "sm-check" },
						h("input", { type: "checkbox", checked: draft.disabled, onChange: (e) => setDraft((p) => ({ ...p, disabled: e.target.checked })), disabled: busy }),
						t("mcpDisabled")
					) : null,
					error !== null ? h("p", { className: "sm-error", role: "alert" }, error) : null
				)
			);
		}
		//#endregion
		//#region index
		/** Services required by the Settings registration and the command bridge. */
		const inject = ["slots", "locale", "remote", "remote.commands", "sessions"];
		/** Register the Skill & MCP settings section and its two tabs. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "skill-mcp-manager: dictionaries");
			const t = ctx.locale.bind(NS);
			const sessions = ctx.get("sessions");
			/** Run one machine command against the current session; returns parsed data. */
			const run = async (line) => {
				const sessionId = sessions.list.getSnapshot().current;
				if (sessionId === void 0) return { ok: false, error: "no active session" };
				let result;
				try {
					result = await ctx.remote.commands.execute(sessionId, line);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				if (!result.ok) return { ok: false, error: `${result.error.code}: ${result.error.message}` };
				const value = result.value;
				if (value === void 0) return { ok: false, error: `unknown command: ${line}` };
				if (value.result.kind === "error") return { ok: false, error: value.result.text ?? "command failed" };
				try {
					return { ok: true, data: JSON.parse(value.result.text) };
				} catch {
					return { ok: false, error: value.result.text ?? "unparsable response" };
				}
			};
			const skillsApi = {
				snapshot: () => run("/skill-mgr snapshot"),
				get: (name) => run(`/skill-mgr get ${JSON.stringify(name)}`),
				create: (payload) => run(`/skill-mgr create ${JSON.stringify(payload)}`),
				update: (payload) => run(`/skill-mgr update ${JSON.stringify(payload)}`),
				remove: (payload) => run(`/skill-mgr delete ${JSON.stringify(payload)}`)
			};
			const mcpApi = {
				snapshot: () => run("/mcp-mgr snapshot"),
				get: (server) => run(`/mcp-mgr get ${JSON.stringify(server)}`),
				add: (payload) => run(`/mcp-mgr add ${JSON.stringify(payload)}`),
				update: (payload) => run(`/mcp-mgr update ${JSON.stringify(payload)}`),
				remove: (payload) => run(`/mcp-mgr remove ${JSON.stringify(payload)}`),
				reload: (server) => run(`/mcp-mgr reload ${JSON.stringify(server)}`)
			};
			let tabsVersion = -1;
			let tabsRevision = -1;
			let tabs = [];
			const sectionInjected = () => ({ hooks: { tabs: {
				getSnapshot: () => {
					const version = ctx.slots.getVersion("settings.skillmcp.tab");
					const revision = ctx.locale.getSnapshot().revision;
					if (version !== tabsVersion || revision !== tabsRevision) {
						tabsVersion = version;
						tabsRevision = revision;
						tabs = ctx.slots.entries("settings.skillmcp.tab").map((entry) => ({
							id: entry.options.id ?? "",
							order: entry.options.order ?? 0,
							label: resolveLabel(entry.options.label)
						})).sort((a, b) => a.order - b.order);
					}
					return tabs;
				},
				subscribe: (listener) => {
					const offLedger = ctx.slots.subscribe("settings.skillmcp.tab", listener);
					const offLocale = ctx.locale.subscribe(listener);
					return () => {
						offLedger();
						offLocale();
					};
				}
			} } });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skill-mcp",
				order: 20,
				label: () => t("nav"),
				locale: NS,
				inject: sectionInjected,
				children: { "settings.skillmcp.tab": { kind: "list", scope: "root" } }
			}, SkillMcpSection));
			ctx.slots.inject("settings.skillmcp.tab", () => ctx.slots.register({
				name: "settings.skillmcp.tab",
				id: "skills",
				order: 0,
				label: () => t("skillsTab"),
				locale: NS,
				inject: () => ({ skillsApi })
			}, SkillsTab));
			ctx.slots.inject("settings.skillmcp.tab", () => ctx.slots.register({
				name: "settings.skillmcp.tab",
				id: "mcp",
				order: 10,
				label: () => t("mcpTab"),
				locale: NS,
				inject: () => ({ mcpApi })
			}, McpTab));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
