window.__ModuleLoader__.load({
  id: "dsh-workspace-activity",
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    (function (require, module, exports) {
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
//#region src/client.ts
/**
* Client half of the workspace-activity bundle.
*
* A workspace row declares no slot, so the running indicator is published as a
* stylesheet rule aimed at the row the workspace browser already renders, rather
* than as markup this package appends. Nothing is written to the document and
* nothing is observed: React keeps owning the row, and the browser's own
* incremental rendering drives the indicator.
*
* The rules are emitted from the component, so unmounting the slot entry takes
* the stylesheet with it.
*/
const PKG = "dsh-workspace-activity";
const NS = "workspace-activity";
const SLOT = "sidebar.footer.action";
const ENTRY_ID = "workspace-activity";
const STYLE_ID = `${PKG}/activity.css`;
/** How many group names the hidden description lists before it summarizes the rest. */
const MAX_NAMES = 4;
/**
* The hidden description's own rule. The visible indicator carries no markup of
* its own — it is drawn by the generated row rules below — so this sheet only
* has to keep the description out of the layout.
*/
const BASE_CSS = [".dswa-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;", "clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}"].join("");
const zh = {
	"activity.running": "{n} 个会话正在运行",
	"activity.finished": "{n} 个会话已完成",
	"activity.tooltip": "{summary}：{names}",
	"activity.more": "等 {n} 个",
	"activity.separator": "、",
	"activity.unnamed": "未分组"
};
const en = {
	"activity.running": "{n} sessions running",
	"activity.finished": "{n} sessions finished",
	"activity.tooltip": "{summary}: {names}",
	"activity.more": "and {n} more",
	"activity.separator": ", ",
	"activity.unnamed": "Ungrouped"
};
/** Escape a group key for a double-quoted CSS attribute selector. */
function quote(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
/**
* Which workspace groups own a running or a just-finished session.
*
* The status feed is authoritative where it names a session; the session list is
* the fallback, matching the workspace browser's own precedence so this
* indicator can never disagree with a session row's spinner. Archived sessions
* are skipped: the browser hides them and publishes the set as an array of ids.
*
* A session that stopped without the browser clearing its unread mark stays
* counted, which is what keeps a finished workspace visible instead of letting
* its row fall silent. A group that is running reports only that: the spinner
* already says it is busy.
*/
function workspaceActivity(items, byId, statuses, archived) {
	const ownerOf = /* @__PURE__ */ new Map();
	for (const workspace of items ?? []) for (const id of workspace.sessionIds ?? []) ownerOf.set(id, workspace);
	const hidden = new Set(archived ?? []);
	const groups = /* @__PURE__ */ new Map();
	for (const id of Object.keys(byId ?? {})) {
		if (hidden.has(id)) continue;
		const status = statuses?.get?.(id);
		const isRunning = status?.running ?? byId?.[id]?.running;
		const isDone = isRunning !== true && status?.completionUnread === true;
		if (isRunning !== true && !isDone) continue;
		const workspace = ownerOf.get(id);
		const key = workspace?.workspaceId ?? "";
		const current = groups.get(key);
		if (current === void 0) groups.set(key, {
			title: workspace?.title ?? "",
			running: isRunning === true ? 1 : 0,
			done: isRunning === true ? 0 : 1
		});
		else if (isRunning === true) current.running += 1;
		else current.done += 1;
	}
	const running = [];
	const done = [];
	const titles = /* @__PURE__ */ new Map();
	let runningSessions = 0;
	let doneSessions = 0;
	for (const [key, group] of groups) {
		titles.set(key, group.title);
		if (group.running > 0) {
			running.push(key);
			runningSessions += group.running;
			continue;
		}
		if (group.done > 0) {
			done.push(key);
			doneSessions += group.done;
		}
	}
	running.sort();
	done.sort();
	return {
		running,
		done,
		runningSessions,
		doneSessions,
		titles
	};
}
/**
* The running-session ring, carried as an alpha mask rather than a border.
*
* A CSS border ring cannot read as a circle at this size: its corners are
* mitred, so the gap between the two ends looks like a clipped square. The mask
* keeps the product's own geometry — r 9.5, 2px stroke, round caps, 12/150 dash
* — matching the status dot the session rows already draw, and the faint track
* carries its own opacity inside the artwork.
*/
const RING = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-opacity='.25'/%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-dasharray='12,150'/%3E%3C/svg%3E\")";
/**
* The finished mark: the product's own `done` dot, a 6px core centred in the
* 10px slot the solid states reserve. It takes the ring's place once the
* sessions stop, so the row keeps saying something instead of going quiet.
*
* The state behind it is the browser's unread completion mark, which it clears
* when you open the session — so the dot reads as "finished and not looked at
* yet", the same thing the session row's own green dot means.
*/
const DONE_DOT = ["content:\"\";flex:none;box-sizing:border-box;width:6px;height:6px;margin:0 2px;", "border-radius:50%;background:var(--dsw-alias-state-success-primary)"].join("");
/**
* The group rows that own a running or just-finished session, decorated in place.
*
* The mark is the row's trailing pseudo element, so it lands at the empty
* right-hand end — the same place a session row puts its timestamp — while the
* growing title column keeps it pinned there. Nothing is hidden or displaced.
*/
function rowCss(activity) {
	const rows = (keys, suffix) => keys.map((key) => `[data-row-key="workspace:${quote(key)}"]${suffix}`).join(",");
	const parts = [];
	if (activity.running.length > 0) {
		const ring = rows(activity.running, "::after");
		const folded = rows(activity.running, "[aria-expanded=\"false\"]>span:first-child");
		parts.push("@keyframes dswa-spin{to{transform:rotate(360deg)}}", `${folded}{color:var(--dsw-alias-state-business-primary)}`, `${ring}{content:"";flex:none;box-sizing:border-box;width:14px;height:14px;`, "background-color:var(--dsw-alias-label-tertiary);", `-webkit-mask-image:${RING};mask-image:${RING};`, "-webkit-mask-size:100% 100%;mask-size:100% 100%;", "-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;", "animation:dswa-spin 1.5s linear infinite}", `@media (prefers-reduced-motion:reduce){${ring}{animation:none;opacity:.45}}`);
	}
	if (activity.done.length > 0) parts.push(`${rows(activity.done, "::after")}{${DONE_DOT}}`);
	return parts.join("");
}
/**
* The slot entry. It shows no control of its own: it publishes the row rules,
* plus a description of the same state for readers who cannot see the mark.
*/
function WorkspaceActivity({ useWorkspaces, useSessions, useSessionStatus, t }) {
	const items = useWorkspaces((state) => state.items);
	const byId = useSessions((state) => state.byId);
	const statuses = useSessionStatus((state) => state);
	const archived = useWorkspaces((state) => state.archivedSessionIds);
	const activity = (0, react.useMemo)(() => workspaceActivity(items, byId, statuses, archived), [
		items,
		byId,
		statuses,
		archived
	]);
	if (activity.running.length === 0 && activity.done.length === 0) return null;
	const tr = (key, params) => {
		if (typeof t !== "function") return key;
		const text = t(key, params);
		return text === void 0 ? key : text;
	};
	const unnamed = tr("activity.unnamed");
	const separator = tr("activity.separator");
	const named = [...activity.running, ...activity.done].map((key) => {
		const title = activity.titles.get(key) ?? "";
		return title === "" ? unnamed : title;
	});
	const listed = named.slice(0, MAX_NAMES);
	const rest = named.length - listed.length;
	const parts = listed.slice();
	if (rest > 0) parts.push(tr("activity.more", { n: rest }));
	const clauses = [];
	if (activity.runningSessions > 0) clauses.push(tr("activity.running", { n: activity.runningSessions }));
	if (activity.doneSessions > 0) clauses.push(tr("activity.finished", { n: activity.doneSessions }));
	const summary = clauses.join(separator);
	const description = tr("activity.tooltip", {
		summary,
		names: parts.join(separator)
	});
	return (0, react.createElement)(react.Fragment, null, (0, react.createElement)("style", { "data-plugin-css": STYLE_ID }, BASE_CSS + rowCss(activity)), (0, react.createElement)("span", { className: "dswa-sr" }, description), (0, react.createElement)("span", { className: "dswa-sr" }, summary));
}
const inject = ["slots"];
function apply(ctx) {
	const locale = ctx.get("locale");
	const hasLocale = locale !== void 0;
	if (locale !== void 0) ctx.effect(() => locale.register(NS, {
		zh,
		en
	}), `${PKG}: dictionaries`);
	ctx.slots.inject(SLOT, () => ctx.slots.register({
		name: SLOT,
		id: ENTRY_ID,
		order: 100,
		...hasLocale ? { locale: NS } : {}
	}, WorkspaceActivity));
}
//#endregion
exports.apply = apply;
exports.inject = inject;
    })(require, module, exports);
    return module.exports;
  },
});
