import { createElement, Fragment, useMemo, useRef } from 'react';
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
 * How long a group keeps its finished mark.
 *
 * The browser's completion mark is unread-until-opened and never ages out, so
 * publishing it unchanged on a folder row would leave a green dot on a workspace
 * whose sessions stopped days ago — a folder row carries no timestamp of its own
 * to contradict it. The mark here is a notice rather than a flag: it rides the
 * session's own `updatedAt`, the field its row's timestamp already reads, and
 * lapses once that timestamp stops reading in minutes.
 */
const FINISHED_WINDOW_MS = 60 * 60 * 1000;

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
  'activity.finished': '{n} 个会话已完成',
  'activity.tooltip': '{summary}：{names}',
  'activity.more': '等 {n} 个',
  'activity.separator': '、',
  'activity.unnamed': '未分组',
};

const en: Messages = {
  'activity.running': '{n} sessions running',
  'activity.finished': '{n} sessions finished',
  'activity.tooltip': '{summary}: {names}',
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
  /** The row's own timestamp, in epoch milliseconds. */
  updatedAt?: number;
  /** `"subagent"` on the child rows the sidebar folds into their parent. */
  origin?: string;
}

/** The subset of the session-status feed this indicator needs. */
interface SessionStatus {
  running?: boolean;
  completionUnread?: boolean;
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

/**
 * Escape a group key for a double-quoted CSS attribute selector.
 *
 * A control character has no literal form inside a CSS string: an unescaped
 * newline ends the string token and the whole rule is dropped as invalid, so the
 * row would lose its mark silently. Each one is written as a hex escape with a
 * trailing space, which is what stops a following hex digit being absorbed.
 *
 * The keys the browser publishes are workspace UUIDs, so none of this is
 * reachable today; it is here so the function is a correct string escaper rather
 * than one that happens to work on UUIDs.
 */
function quote(value: string): string {
  let escaped = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\\' || char === '"') escaped += `\\${char}`;
    else if (code < 0x20 || code === 0x7f) escaped += `\\${code.toString(16)} `;
    else escaped += char;
  }
  return escaped;
}

/** One workspace's session tally, accumulated before the two states are split. */
interface GroupActivity {
  title: string;
  running: number;
  done: number;
}

interface Activity {
  /** Group keys with a running session, sorted. */
  running: readonly string[];
  /** Group keys whose sessions all stopped recently with the completion mark unread, sorted. */
  done: readonly string[];
  runningSessions: number;
  doneSessions: number;
  /** Display title per group key, for every key in either list. */
  titles: ReadonlyMap<string, string>;
}

/**
 * Whether a session's own timestamp is recent enough to still deserve a mark.
 *
 * A missing or zero timestamp cannot be corroborated, so it never earns one.
 * Subagent rows carry a zero timestamp, and they have their parent's row to
 * report through anyway.
 */
function isFresh(updatedAt: number | undefined, now: number): boolean {
  if (updatedAt === undefined || updatedAt <= 0) return false;
  return now - updatedAt <= FINISHED_WINDOW_MS;
}

/**
 * What this mount has watched happen, keyed by session id.
 *
 * `running` holds every session seen running since the mount; `stoppedAt` holds
 * the time a session was watched stop while still carrying the unread mark, and
 * only for sessions that were first seen running. Together they let a mark
 * expire on its own rather than wait for the browser to clear it.
 */
interface Watch {
  running: Set<string>;
  stoppedAt: Map<string, number>;
}

/**
 * Whether a session row is a subagent's.
 *
 * The sidebar folds these into their parent's row and never renders one of its
 * own, so a mark derived from one would have nothing to agree with. It matters
 * more than that here: subagent ids are not part of any workspace's
 * `sessionIds`, so one stopping would otherwise be counted against the ungrouped
 * bucket and light up a row it has nothing to do with.
 */
function isSubagent(row: SessionRow | undefined): boolean {
  return row?.origin === 'subagent';
}

/**
 * Advance the watch to this render, and drop what has aged out.
 *
 * A session seen stopped without ever being seen running is left out of
 * `stoppedAt` on purpose: this mount cannot tell whether it stopped a minute or
 * a week ago, so such a mark is judged by its own timestamp alone.
 */
function observeWatch(
  byId: Readonly<Record<string, SessionRow | undefined>> | undefined,
  statuses: StatusFeed | undefined,
  watch: Watch,
  now: number,
): void {
  for (const id of Object.keys(byId ?? {})) {
    const row = byId?.[id];
    if (isSubagent(row)) continue;
    const status = statuses?.get?.(id);
    const running = status?.running ?? row?.running;
    if (running === true) {
      watch.running.add(id);
      watch.stoppedAt.delete(id);
      continue;
    }
    if (status?.completionUnread !== true) {
      watch.running.delete(id);
      watch.stoppedAt.delete(id);
      continue;
    }
    if (watch.running.has(id) && !watch.stoppedAt.has(id)) {
      watch.stoppedAt.set(id, now);
      continue;
    }
    const stoppedAt = watch.stoppedAt.get(id);
    if (stoppedAt !== undefined && now - stoppedAt > FINISHED_WINDOW_MS) {
      watch.running.delete(id);
      watch.stoppedAt.delete(id);
    }
  }
}

/**
 * Whether a finished session still deserves its mark.
 *
 * Two clocks can justify one. The session's own timestamp covers a session that
 * stopped a moment ago, and is what a row's "刚刚" already reports. Watching it
 * stop covers the case that timestamp cannot: it records when the last prompt
 * was, so a session that ran for hours would otherwise never qualify.
 */
function isFinished(id: string, row: SessionRow | undefined, watch: Watch, now: number): boolean {
  if (isFresh(row?.updatedAt, now)) return true;
  const stoppedAt = watch.stoppedAt.get(id);
  return stoppedAt !== undefined && now - stoppedAt <= FINISHED_WINDOW_MS;
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
 * counted while its completion is still recent, which is what keeps a finished
 * workspace visible instead of letting its row fall silent without leaving a
 * mark behind for good. A group that is running reports only that: the spinner
 * already says it is busy.
 */
function workspaceActivity(
  items: readonly WorkspaceRow[] | undefined,
  byId: Readonly<Record<string, SessionRow | undefined>> | undefined,
  statuses: StatusFeed | undefined,
  archived: readonly string[] | undefined,
  now: number,
  watch: Watch,
): Activity {
  const ownerOf = new Map<string, WorkspaceRow>();
  for (const workspace of items ?? []) {
    for (const id of workspace.sessionIds ?? []) ownerOf.set(id, workspace);
  }
  const hidden = new Set(archived ?? []);
  observeWatch(byId, statuses, watch, now);
  const groups = new Map<string, GroupActivity>();
  for (const id of Object.keys(byId ?? {})) {
    if (hidden.has(id)) continue;
    const row = byId?.[id];
    if (isSubagent(row)) continue;
    const status = statuses?.get?.(id);
    const isRunning = status?.running ?? row?.running;
    const isDone =
      isRunning !== true && status?.completionUnread === true && isFinished(id, row, watch, now);
    if (isRunning !== true && !isDone) continue;
    const workspace = ownerOf.get(id);
    const key = workspace?.workspaceId ?? '';
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        title: workspace?.title ?? '',
        running: isRunning === true ? 1 : 0,
        done: isRunning === true ? 0 : 1,
      });
    } else if (isRunning === true) current.running += 1;
    else current.done += 1;
  }

  const running: string[] = [];
  const done: string[] = [];
  const titles = new Map<string, string>();
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
  return { running, done, runningSessions, doneSessions, titles };
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
 * The finished mark: the product's own `done` dot, a 6px core centred in the
 * 10px slot the solid states reserve. It takes the ring's place once the
 * sessions stop, so the row keeps saying something instead of going quiet.
 *
 * The state behind it is the browser's unread completion mark, which it clears
 * when you open the session — so the dot reads as "finished and not looked at
 * yet", the same thing the session row's own green dot means.
 */
const DONE_DOT = [
  'content:"";flex:none;box-sizing:border-box;width:6px;height:6px;margin:0 2px;',
  'border-radius:50%;background:var(--dsw-alias-state-success-primary)',
].join('');

/**
 * The group rows that own a running or just-finished session, decorated in place.
 *
 * The mark is the row's trailing pseudo element, so it lands at the empty
 * right-hand end — the same place a session row puts its timestamp — while the
 * growing title column keeps it pinned there. Nothing is hidden or displaced.
 */
function rowCss(activity: Activity): string {
  // Every rule repeats the whole selector list. A comma-joined list applies the
  // trailing combinator to its last member only, so sharing one prefix would
  // leave every group but one undecorated once two workspaces run at once.
  const rows = (keys: readonly string[], suffix: string): string =>
    keys.map((key) => `[data-row-key="workspace:${quote(key)}"]${suffix}`).join(',');
  const parts: string[] = [];

  if (activity.running.length > 0) {
    const ring = rows(activity.running, '::after');
    // A collapsed row hides its sessions, so the folder glyph has to carry the
    // state alone. It takes the same blue the browser paints on the folder of the
    // group you are inside. An expanded row already shows its sessions, so it
    // keeps the browser's own colouring rather than a second meaning for the same
    // colour.
    const folded = rows(activity.running, '[aria-expanded="false"]>span:first-child');
    parts.push(
      '@keyframes dswa-spin{to{transform:rotate(360deg)}}',
      `${folded}{color:var(--dsw-alias-state-business-primary)}`,
      `${ring}{content:"";flex:none;box-sizing:border-box;width:14px;height:14px;`,
      'background-color:var(--dsw-alias-label-tertiary);',
      `-webkit-mask-image:${RING};mask-image:${RING};`,
      '-webkit-mask-size:100% 100%;mask-size:100% 100%;',
      '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;',
      'animation:dswa-spin 1.5s linear infinite}',
      `@media (prefers-reduced-motion:reduce){${ring}{animation:none;opacity:.45}}`,
    );
  }

  if (activity.done.length > 0) {
    parts.push(`${rows(activity.done, '::after')}{${DONE_DOT}}`);
  }

  return parts.join('');
}

/**
 * The slot entry. It shows no control of its own: it publishes the row rules,
 * plus a description of the same state for readers who cannot see the mark.
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
  const watchRef = useRef<Watch | undefined>(undefined);
  watchRef.current ??= { running: new Set<string>(), stoppedAt: new Map<string, number>() };
  const watch = watchRef.current;
  const activity = useMemo(
    // The window is measured at render time, the same way the workspace browser
    // reads its own clock: no timer, because any feed change re-renders anyway.
    // Advancing the watch is idempotent, so a repeated render costs nothing.
    () => workspaceActivity(items, byId, statuses, archived, Date.now(), watch),
    [items, byId, statuses, archived, watch],
  );
  if (activity.running.length === 0 && activity.done.length === 0) return null;

  const tr = (key: string, params?: Record<string, unknown>): string => {
    if (typeof t !== 'function') return key;
    const text = t(key, params);
    return text === undefined ? key : text;
  };
  const unnamed = tr('activity.unnamed');
  const separator = tr('activity.separator');
  const named = [...activity.running, ...activity.done].map((key) => {
    const title = activity.titles.get(key) ?? '';
    return title === '' ? unnamed : title;
  });
  const listed = named.slice(0, MAX_NAMES);
  const rest = named.length - listed.length;
  const parts = listed.slice();
  if (rest > 0) parts.push(tr('activity.more', { n: rest }));

  const clauses: string[] = [];
  if (activity.runningSessions > 0) {
    clauses.push(tr('activity.running', { n: activity.runningSessions }));
  }
  if (activity.doneSessions > 0) {
    clauses.push(tr('activity.finished', { n: activity.doneSessions }));
  }
  const summary = clauses.join(separator);
  const description = tr('activity.tooltip', { summary, names: parts.join(separator) });

  return createElement(
    Fragment,
    null,
    createElement('style', { 'data-plugin-css': STYLE_ID }, BASE_CSS + rowCss(activity)),
    createElement('span', { className: 'dswa-sr' }, description),
    createElement('span', { className: 'dswa-sr' }, summary),
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
