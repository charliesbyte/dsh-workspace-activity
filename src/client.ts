import { createElement, Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';

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

const PKG = 'dsh-workspace-activity';
const NS = 'workspace-activity';
const SLOT = 'sidebar.footer.action';
const ENTRY_ID = 'workspace-activity';
const STYLE_ID = `${PKG}/activity.css`;
/** How many group names the hidden description lists before it summarizes the rest. */
const MAX_NAMES = 4;

/**
 * The hidden description's own rule. The visible indicator carries no markup of
 * its own — it is drawn by the generated row rules below — so this sheet only
 * has to keep the description out of the layout.
 */
const BASE_CSS = [
  '.dswa-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;',
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
].join('');

type Messages = Record<string, string>;

const zh: Messages = {
  'activity.running': '{n} 个会话正在运行',
  'activity.tooltip': '{n} 个会话正在运行：{names}',
  'activity.more': '等 {n} 个',
  'activity.separator': '、',
  'activity.unnamed': '未分组',
};

const en: Messages = {
  'activity.running': '{n} sessions running',
  'activity.tooltip': '{n} sessions running: {names}',
  'activity.more': 'and {n} more',
  'activity.separator': ', ',
  'activity.unnamed': 'Ungrouped',
};

/** A workspace row as the sidebar feed publishes it. */
interface WorkspaceRow {
  workspaceId?: string;
  title?: string;
  sessionIds?: readonly string[];
}

/** The subset of a session row this indicator needs. */
interface SessionRow {
  running?: boolean;
}

/** The subset of the session-status feed this indicator needs. */
interface SessionStatus {
  running?: boolean;
}

interface StatusFeed {
  get?: (id: string) => SessionStatus | undefined;
}

interface WorkspaceListState {
  items?: readonly WorkspaceRow[];
  archivedSessionIds?: readonly string[];
}

interface SessionListState {
  byId?: Readonly<Record<string, SessionRow | undefined>>;
}

type Selector<T> = (state: never) => T;

interface WorkspaceActivityProps {
  useWorkspaces: <T>(selector: Selector<T>) => T;
  useSessions: <T>(selector: Selector<T>) => T;
  useSessionStatus: <T>(selector: Selector<T>) => T;
  t?: (key: string, params?: Record<string, unknown>) => string | undefined;
}

/** Escape a group key for a double-quoted CSS attribute selector. */
function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface Activity {
  sessions: number;
  groups: Map<string, string>;
}

/**
 * Which workspace groups own a running session, and how many sessions run.
 *
 * The status feed is authoritative where it names a session; the session list is
 * the fallback, matching the workspace browser's own precedence so this
 * indicator can never disagree with a session row's spinner. Archived sessions
 * are skipped: the browser hides them and publishes the set as an array of ids.
 */
function runningGroups(
  items: readonly WorkspaceRow[] | undefined,
  byId: Readonly<Record<string, SessionRow | undefined>> | undefined,
  statuses: StatusFeed | undefined,
  archived: readonly string[] | undefined,
): Activity {
  const ownerOf = new Map<string, WorkspaceRow>();
  for (const workspace of items ?? []) {
    for (const id of workspace.sessionIds ?? []) ownerOf.set(id, workspace);
  }
  const hidden = new Set(archived ?? []);
  const groups = new Map<string, string>();
  let sessions = 0;
  for (const id of Object.keys(byId ?? {})) {
    if (hidden.has(id)) continue;
    const running = statuses?.get?.(id)?.running ?? byId?.[id]?.running;
    if (running !== true) continue;
    sessions += 1;
    const workspace = ownerOf.get(id);
    const key = workspace?.workspaceId ?? '';
    if (groups.has(key)) continue;
    groups.set(key, workspace?.title ?? '');
  }
  return { sessions, groups };
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
const RING =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-opacity='.25'/%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-dasharray='12,150'/%3E%3C/svg%3E\")";

/**
 * The group rows that own a running session, decorated in place.
 *
 * The ring is the row's trailing pseudo element, so it lands at the empty
 * right-hand end — the same place a session row puts its timestamp — while the
 * growing title column keeps it pinned there. Nothing is hidden or displaced.
 */
function rowCss(groups: Map<string, string>): string {
  if (groups.size === 0) return '';
  const rows = [...groups.keys()].sort().map((key) => `[data-row-key="workspace:${quote(key)}"]`);
  // Every rule repeats the whole selector list. A comma-joined list applies the
  // trailing combinator to its last member only, so sharing one prefix would
  // leave every group but one undecorated once two workspaces run at once.
  const each = (suffix: string): string => rows.map((row) => row + suffix).join(',');
  const ring = each('::after');
  // A collapsed row hides its sessions, so the folder glyph has to carry the
  // state alone. It takes the same blue the browser paints on the folder of the
  // group you are inside. An expanded row already shows its sessions, so it
  // keeps the browser's own colouring rather than a second meaning for the same
  // colour.
  const folded = each('[aria-expanded="false"]>span:first-child');
  return [
    '@keyframes dswa-spin{to{transform:rotate(360deg)}}',
    `${folded}{color:var(--dsw-alias-state-business-primary)}`,
    `${ring}{content:"";flex:none;box-sizing:border-box;width:14px;height:14px;`,
    'background-color:var(--dsw-alias-label-tertiary);',
    `-webkit-mask-image:${RING};mask-image:${RING};`,
    '-webkit-mask-size:100% 100%;mask-size:100% 100%;',
    '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;',
    'animation:dswa-spin 1.5s linear infinite}',
    '@media (prefers-reduced-motion:reduce){',
    `${ring}{animation:none;opacity:.45}}`,
  ].join('');
}

/**
 * The slot entry. It shows no control of its own: it publishes the row rules,
 * plus a description of the same state for readers who cannot see the ring.
 */
function WorkspaceActivity({
  useWorkspaces,
  useSessions,
  useSessionStatus,
  t,
}: WorkspaceActivityProps): ReactNode {
  const items = useWorkspaces((state: WorkspaceListState) => state.items);
  const byId = useSessions((state: SessionListState) => state.byId);
  const statuses = useSessionStatus((state: StatusFeed) => state);
  const archived = useWorkspaces((state: WorkspaceListState) => state.archivedSessionIds);
  const activity = useMemo(
    () => runningGroups(items, byId, statuses, archived),
    [items, byId, statuses, archived],
  );
  if (activity.sessions === 0) return null;

  const tr = (key: string, params?: Record<string, unknown>): string => {
    if (typeof t !== 'function') return key;
    const text = t(key, params);
    return text === undefined ? key : text;
  };
  const unnamed = tr('activity.unnamed');
  const separator = tr('activity.separator');
  const named = [...activity.groups.values()].map((title) => (title === '' ? unnamed : title));
  const listed = named.slice(0, MAX_NAMES);
  const rest = named.length - listed.length;
  const parts = listed.slice();
  if (rest > 0) parts.push(tr('activity.more', { n: rest }));
  const label = tr('activity.running', { n: activity.sessions });
  const description = tr('activity.tooltip', {
    n: activity.sessions,
    names: parts.join(separator),
  });

  return createElement(
    Fragment,
    null,
    createElement('style', { 'data-plugin-css': STYLE_ID }, BASE_CSS + rowCss(activity.groups)),
    createElement('span', { className: 'dswa-sr' }, description),
    createElement('span', { className: 'dswa-sr' }, label),
  );
}

/** The locale face, as the client locale service accepts it. */
interface LocaleService {
  register: (ns: string, dicts: Record<string, Messages>) => () => void;
  bind?: (ns: string) => (key: string, params?: Record<string, unknown>) => string;
}

/** The slot face this entry registers against. */
interface SlotsService {
  inject: (key: string, callback: () => void) => void;
  register: (options: Record<string, unknown>, component: unknown) => void;
}

/** The services this entry reads by name. Absent ones are simply undefined. */
interface Services {
  locale: LocaleService;
}

interface ClientContext {
  get: <K extends keyof Services>(name: K) => Services[K] | undefined;
  effect: (callback: () => unknown, label?: string) => void;
  slots: SlotsService;
}

export const inject = ['slots'];

export function apply(ctx: ClientContext): void {
  // The locale face is optional at registration: without it the entry still
  // renders, falling back to the message keys.
  const locale = ctx.get('locale');
  const hasLocale = locale !== undefined;
  if (locale !== undefined) {
    ctx.effect(() => locale.register(NS, { zh, en }), `${PKG}: dictionaries`);
  }

  ctx.slots.inject(SLOT, () =>
    ctx.slots.register(
      {
        name: SLOT,
        id: ENTRY_ID,
        order: 100,
        ...(hasLocale ? { locale: NS } : {}),
      },
      WorkspaceActivity,
    ),
  );
}
