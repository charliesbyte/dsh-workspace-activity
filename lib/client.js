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
	"activity.tooltip": "{n} 个会话正在运行：{names}",
	"activity.more": "等 {n} 个",
	"activity.separator": "、",
	"activity.unnamed": "未分组"
};
const en = {
	"activity.running": "{n} sessions running",
	"activity.tooltip": "{n} sessions running: {names}",
	"activity.more": "and {n} more",
	"activity.separator": ", ",
	"activity.unnamed": "Ungrouped"
};
/** Escape a group key for a double-quoted CSS attribute selector. */
function quote(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
/**
* Which workspace groups own a running session, and how many sessions run.
*
* The status feed is authoritative where it names a session; the session list is
* the fallback, matching the workspace browser's own precedence so this
* indicator can never disagree with a session row's spinner. Archived sessions
* are skipped: the browser hides them and publishes the set as an array of ids.
*/
function runningGroups(items, byId, statuses, archived) {
	const ownerOf = /* @__PURE__ */ new Map();
	for (const workspace of items ?? []) for (const id of workspace.sessionIds ?? []) ownerOf.set(id, workspace);
	const hidden = new Set(archived ?? []);
	const groups = /* @__PURE__ */ new Map();
	let sessions = 0;
	for (const id of Object.keys(byId ?? {})) {
		if (hidden.has(id)) continue;
		if ((statuses?.get?.(id)?.running ?? byId?.[id]?.running) !== true) continue;
		sessions += 1;
		const workspace = ownerOf.get(id);
		const key = workspace?.workspaceId ?? "";
		if (groups.has(key)) continue;
		groups.set(key, workspace?.title ?? "");
	}
	return {
		sessions,
		groups
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
* The group rows that own a running session, decorated in place.
*
* The ring is the row's trailing pseudo element, so it lands at the empty
* right-hand end — the same place a session row puts its timestamp — while the
* growing title column keeps it pinned there. Nothing is hidden or displaced.
*/
function rowCss(groups) {
	if (groups.size === 0) return "";
	const rows = [...groups.keys()].sort().map((key) => `[data-row-key="workspace:${quote(key)}"]`);
	const each = (suffix) => rows.map((row) => row + suffix).join(",");
	const ring = each("::after");
	return [
		"@keyframes dswa-spin{to{transform:rotate(360deg)}}",
		`${each("[aria-expanded=\"false\"]>span:first-child")}{color:var(--dsw-alias-state-business-primary)}`,
		`${ring}{content:"";flex:none;box-sizing:border-box;width:14px;height:14px;`,
		"background-color:var(--dsw-alias-label-tertiary);",
		`-webkit-mask-image:${RING};mask-image:${RING};`,
		"-webkit-mask-size:100% 100%;mask-size:100% 100%;",
		"-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;",
		"animation:dswa-spin 1.5s linear infinite}",
		"@media (prefers-reduced-motion:reduce){",
		`${ring}{animation:none;opacity:.45}}`
	].join("");
}
/**
* The slot entry. It shows no control of its own: it publishes the row rules,
* plus a description of the same state for readers who cannot see the ring.
*/
function WorkspaceActivity({ useWorkspaces, useSessions, useSessionStatus, t }) {
	const items = useWorkspaces((state) => state.items);
	const byId = useSessions((state) => state.byId);
	const statuses = useSessionStatus((state) => state);
	const archived = useWorkspaces((state) => state.archivedSessionIds);
	const activity = (0, react.useMemo)(() => runningGroups(items, byId, statuses, archived), [
		items,
		byId,
		statuses,
		archived
	]);
	if (activity.sessions === 0) return null;
	const tr = (key, params) => {
		if (typeof t !== "function") return key;
		const text = t(key, params);
		return text === void 0 ? key : text;
	};
	const unnamed = tr("activity.unnamed");
	const separator = tr("activity.separator");
	const named = [...activity.groups.values()].map((title) => title === "" ? unnamed : title);
	const listed = named.slice(0, MAX_NAMES);
	const rest = named.length - listed.length;
	const parts = listed.slice();
	if (rest > 0) parts.push(tr("activity.more", { n: rest }));
	const label = tr("activity.running", { n: activity.sessions });
	const description = tr("activity.tooltip", {
		n: activity.sessions,
		names: parts.join(separator)
	});
	return (0, react.createElement)(react.Fragment, null, (0, react.createElement)("style", { "data-plugin-css": STYLE_ID }, BASE_CSS + rowCss(activity.groups)), (0, react.createElement)("span", { className: "dswa-sr" }, description), (0, react.createElement)("span", { className: "dswa-sr" }, label));
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
