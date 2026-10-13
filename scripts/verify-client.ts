import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type ComponentType, type ReactElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';

/**
 * Renders the built Client bundle the way the browser module table does: capture
 * the factory off a fake `__ModuleLoader__`, hand it a `require` backed by real
 * React, then drive `apply` and render the registered component with a real
 * renderer so hooks behave as they do in the product. This checks the envelope,
 * the registration, and the CSS the entry publishes — not the running sidebar.
 */

interface Registration {
  id: string;
  factory: (require: (specifier: string) => unknown) => ClientModule;
}

interface ClientModule {
  inject: string[];
  apply: (ctx: unknown) => void;
}

interface WorkspaceItem {
  workspaceId: string;
  title: string;
  sessionIds: string[];
}

interface SessionRow {
  running: boolean;
  updatedAt?: number;
  origin?: string;
}

interface SessionStatus {
  running: boolean;
  completionUnread?: boolean;
}

interface Props {
  now?: number;
  items: WorkspaceItem[];
  byId: Record<string, SessionRow>;
  statuses: Map<string, SessionStatus>;
  archived?: string[];
}

let captured: Registration | undefined;

// The bundle reads the module table off the global scope, which the DOM lib has
// already declared. Assigning the host object through `Object.assign` reaches
// that property without asserting anything about its shape.
Object.assign(globalThis, {
  window: {
    __ModuleLoader__: {
      load(registration: Registration) {
        captured = registration;
      },
    },
  },
});

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
(0, eval)(source);

if (captured?.id !== 'dsh-workspace-activity') {
  throw new Error(`envelope id mismatch: ${captured?.id}`);
}
const registration = captured;

const mod = registration.factory((specifier) => {
  if (specifier === 'react') return require('react');
  throw new Error(`unexpected require: ${specifier}`);
});

if (!Array.isArray(mod.inject) || typeof mod.apply !== 'function') {
  throw new Error('bundle did not export inject/apply');
}

interface RegisteredOptions {
  name: string;
  locale?: string;
}

interface Registered {
  options: RegisteredOptions;
  component: ComponentType<Record<string, unknown>>;
}

let registered: Registered | undefined;
const localeCalls: { ns: string; dicts: unknown }[] = [];
const ctx = {
  get: (name: string): unknown =>
    name === 'locale'
      ? {
          register: (ns: string, dicts: unknown) => {
            localeCalls.push({ ns, dicts });
            return () => {};
          },
        }
      : undefined,
  effect: (callback: () => void): void => {
    callback();
  },
  slots: {
    inject: (key: string, callback: () => void): void => {
      if (key !== 'sidebar.footer.action') throw new Error(`injected ${key}`);
      callback();
    },
    register: (options: RegisteredOptions, component: ComponentType<Record<string, unknown>>) => {
      registered = { options, component };
    },
  },
};

mod.apply(ctx);

if (registered === undefined) throw new Error('the entry registered nothing');
const entry = registered;
if (entry.options.name !== 'sidebar.footer.action') {
  throw new Error('entry did not register against the footer slot');
}
if (localeCalls.length !== 1) throw new Error('locale was not registered once');
if (entry.options.locale !== 'workspace-activity') {
  throw new Error('entry did not declare its locale namespace');
}

/** The English dictionary, so assertions can read the strings a user would see. */
const DICT: Record<string, string> = {
  'activity.running': '{n} sessions running',
  'activity.finished': '{n} sessions finished',
  'activity.tooltip': '{summary}: {names}',
  'activity.more': 'and {n} more',
  'activity.separator': ', ',
  'activity.unnamed': 'Ungrouped',
};

/** Interpolate one dictionary entry the way the locale service does. */
const t = (key: string, params?: Record<string, unknown>): string => {
  const template = DICT[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value: unknown = params?.[name];
    if (value === undefined || value === null) return `{${name}}`;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    throw new Error(`t(${key}): {${name}} is not a string or number`);
  });
};

// The entry reads its own clock, so the test owns the clock. Nothing else in the
// bundle calls Date, so overriding it here is the whole of the time control.
const T = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
let clock = T;
Date.now = () => clock;

// The checks below read the published selectors back instead of rebuilding them.
// An expectation built by copying the encoder shares its blind spot: delete the
// escaping and the assertion deletes it too. Decoding is the other direction, so
// a wrong escape surfaces as a key that no longer matches the workspace it names.

/** Undo CSS string escapes, the way a parser does when it reads the attribute value. */
function unescapeCss(value: string): string {
  return value.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([\s\S]))/g,
    (_, hex: string | undefined, char: string | undefined) =>
      hex === undefined ? String(char) : String.fromCodePoint(Number.parseInt(hex, 16)),
  );
}

const ROW_ATTR = /\[data-row-key="((?:[^"\\]|\\.)*)"\]/g;

/** Every workspace key the given stylesheet text targets. */
function markedKeys(css: string): Set<string> {
  const keys = new Set<string>();
  for (const match of css.matchAll(ROW_ATTR)) {
    const value = unescapeCss(match[1] ?? '');
    if (value.startsWith('workspace:')) keys.add(value.slice('workspace:'.length));
  }
  return keys;
}

/** The still-escaped attribute values, so a raw control character can be spotted. */
function rawKeys(css: string): string[] {
  return [...css.matchAll(ROW_ATTR)].map((match) => match[1] ?? '');
}

function element({ items, byId, statuses, archived = [] }: Props): ReactElement {
  return createElement(entry.component, {
    useWorkspaces: (selector: (state: unknown) => unknown) =>
      selector({ items, archivedSessionIds: archived }),
    useSessions: (selector: (state: unknown) => unknown) => selector({ byId }),
    useSessionStatus: (selector: (state: unknown) => unknown) => selector(statuses),
    t,
  });
}

/** Render the entry against one snapshot of the three feeds, at the given time. */
function render(props: Props): ReactTestRenderer {
  if (props.now !== undefined) clock = props.now;
  let tree: ReactTestRenderer | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element(props));
  });
  if (tree === undefined) throw new Error('the renderer produced no tree');
  return tree;
}

/** Re-render the same mounted entry, so its remembered state survives. */
function update(tree: ReactTestRenderer, props: Props): void {
  if (props.now !== undefined) clock = props.now;
  TestRenderer.act(() => {
    tree.update(element(props));
  });
}

/** The published CSS, or an empty string when the entry rendered nothing at all. */
const cssOf = (tree: ReactTestRenderer): string => {
  if (tree.toJSON() === null) return '';
  const style = tree.root.findByType('style');
  const children: unknown = style.props.children;
  if (typeof children !== 'string') throw new Error('the published stylesheet is not a string');
  return children;
};

const live = render({
  now: T,
  items: [
    { workspaceId: 'C:\\a', title: 'alpha', sessionIds: ['s1'] },
    { workspaceId: 'C:\\b', title: 'beta', sessionIds: ['s2'] },
    { workspaceId: 'C:\\c', title: 'gamma', sessionIds: ['s3'] },
    { workspaceId: 'C:\\d', title: 'delta', sessionIds: ['s4'] },
  ],
  byId: {
    s1: { running: true },
    s2: { running: false },
    s3: { running: false, updatedAt: T },
    s4: { running: false, updatedAt: T },
  },
  // The status feed wins where it names a session: beta runs even though the
  // session list says otherwise, gamma has finished unread, and delta is idle.
  statuses: new Map<string, SessionStatus>([
    ['s1', { running: true }],
    ['s2', { running: true }],
    ['s3', { running: false, completionUnread: true }],
    ['s4', { running: false, completionUnread: false }],
  ]),
});

const css = cssOf(live);
console.log('--- CSS ---');
console.log(css);
console.log('--- checks ---');

// Running workspaces keep the spinning ring, and both of them carry every rule.
for (const key of ['C:\\a', 'C:\\b']) {
  if (!markedKeys(css).has(key)) throw new Error(`missing ring rule for ${key}`);
}
const foldedCount = (css.match(/aria-expanded="false"\]>span:first-child\{/g) ?? []).length;
if (foldedCount !== 1) throw new Error(`expected 1 folded rule, got ${foldedCount}`);
for (const rule of css.split(/(?<=})/)) {
  if (!markedKeys(rule).has('C:\\a')) continue;
  if (!markedKeys(rule).has('C:\\b')) throw new Error(`rule lost a selector: ${rule}`);
}

// A finished workspace keeps a static success dot instead of going quiet.
if (!markedKeys(css).has('C:\\c')) throw new Error('missing the finished rule for C:\\c');
if (!css.includes('--dsw-alias-state-success-primary'))
  throw new Error('finished mark lost its colour');
const doneRule = css.split(/(?<=})/).find((rule) => markedKeys(rule).has('C:\\c'));
if (doneRule === undefined) throw new Error('the finished mark is in no rule of its own');
if (markedKeys(doneRule).size !== 1)
  throw new Error('the finished mark shared a rule with another row');
if (doneRule.includes('animation')) throw new Error('finished mark must not animate');

// An idle workspace is left alone entirely.
if (markedKeys(css).has('C:\\d')) throw new Error('an idle workspace was decorated');

const text: unknown[] = live.root.findAllByType('span').map((node): unknown => node.props.children);
const label = text.find(
  (value): value is string => typeof value === 'string' && value.includes('sessions finished'),
);
if (label === undefined) throw new Error('the description did not mention the finished sessions');

const idle = render({ now: T, items: [], byId: {}, statuses: new Map() });
if (idle.toJSON() !== null)
  throw new Error('the entry rendered while nothing was running or finished');

// Archived sessions are the browser's to hide, so they never reach the rules.
const archived = render({
  now: T,
  items: [{ workspaceId: 'C:\\a', title: 'alpha', sessionIds: ['s1'] }],
  byId: { s1: { running: true } },
  statuses: new Map([['s1', { running: true }]]),
  archived: ['s1'],
});
if (archived.toJSON() !== null) throw new Error('an archived session was still counted');

// A session that stopped long ago keeps the browser's unread mark forever, so a
// stale timestamp must not earn a mark of its own — this was the reported bug.
const stale = render({
  now: T,
  items: [{ workspaceId: 'C:\\e', title: 'epsilon', sessionIds: ['s5'] }],
  byId: { s5: { running: false, updatedAt: T - 26 * HOUR } },
  statuses: new Map([['s5', { running: false, completionUnread: true }]]),
});
if (markedKeys(cssOf(stale)).has('C:\\e'))
  throw new Error('a stale finished session still decorated its workspace');
if (stale.toJSON() !== null) throw new Error('a stale finished session still rendered the entry');

// The session's timestamp records the last prompt, so a session that ran for
// hours carries a stale one the moment it stops. Watching it stop covers that.
const longRun = render({
  now: T,
  items: [{ workspaceId: 'C:\\f', title: 'zeta', sessionIds: ['s6'] }],
  byId: { s6: { running: true, updatedAt: T - 3 * HOUR } },
  statuses: new Map([['s6', { running: true }]]),
});
if (!markedKeys(cssOf(longRun)).has('C:\\f'))
  throw new Error('a long-running session lost its ring');
update(longRun, {
  now: T + 1000,
  items: [{ workspaceId: 'C:\\f', title: 'zeta', sessionIds: ['s6'] }],
  byId: { s6: { running: false, updatedAt: T - 3 * HOUR } },
  statuses: new Map([['s6', { running: false, completionUnread: true }]]),
});
if (!markedKeys(cssOf(longRun)).has('C:\\f'))
  throw new Error('a session watched stopping was not marked finished');

// ...and that watched mark lapses on its own once the window passes, which is
// the part the browser never does.
update(longRun, {
  now: T + 1000 + HOUR + 1,
  items: [{ workspaceId: 'C:\\f', title: 'zeta', sessionIds: ['s6'] }],
  byId: { s6: { running: false, updatedAt: T - 3 * HOUR } },
  statuses: new Map([['s6', { running: false, completionUnread: true }]]),
});
if (markedKeys(cssOf(longRun)).has('C:\\f'))
  throw new Error('a watched finished mark never lapsed');
if (longRun.toJSON() !== null) throw new Error('the entry stayed after every mark lapsed');

// A subagent's row is folded into its parent's and never gets one of its own, and
// its id is in no workspace's `sessionIds`, so it must not mark anything at all —
// otherwise it lands in the ungrouped bucket and lights up a row it has nothing to
// do with.
const subagent = render({
  now: T,
  items: [{ workspaceId: 'C:\\g', title: 'eta', sessionIds: ['p1'] }],
  byId: { p1: { running: false }, c1: { running: true, origin: 'subagent' } },
  statuses: new Map<string, SessionStatus>([['c1', { running: true }]]),
});
if (markedKeys(cssOf(subagent)).has(''))
  throw new Error('a running subagent marked the ungrouped bucket');
update(subagent, {
  now: T + 1000,
  items: [{ workspaceId: 'C:\\g', title: 'eta', sessionIds: ['p1'] }],
  byId: { p1: { running: false }, c1: { running: false, updatedAt: 0, origin: 'subagent' } },
  statuses: new Map<string, SessionStatus>([
    ['p1', { running: false, completionUnread: false }],
    ['c1', { running: false, completionUnread: true }],
  ]),
});
if (subagent.toJSON() !== null)
  throw new Error('a stopped subagent marked the ungrouped bucket finished');

// Nothing caps how many workspaces can be marked. The accessible description
// names only the first few and folds the rest, which is what made a reader think
// the limit was four; the rules themselves must still cover every row.
const many = Array.from({ length: 7 }, (_, index) => ({
  workspaceId: `w${index}`,
  title: `w${index}`,
  sessionIds: [`m${index}`],
}));
const manyRun = render({
  now: T,
  items: many,
  byId: Object.fromEntries(many.map((_, index) => [`m${index}`, { running: true }])),
  statuses: new Map<string, SessionStatus>(),
});
const manyKeys = markedKeys(cssOf(manyRun));
for (const item of many) {
  if (!manyKeys.has(item.workspaceId))
    throw new Error(`workspace ${item.workspaceId} was dropped from the rules`);
}
if (manyKeys.size !== many.length)
  throw new Error(`expected ${many.length} marked workspaces, got ${manyKeys.size}`);
const folded = manyRun.root
  .findAllByType('span')
  .map((node): unknown => node.props.children)
  .find((value): value is string => typeof value === 'string' && value.includes('and 3 more'));
if (folded === undefined) throw new Error('the description did not fold the extra names');

// Workspace keys are UUIDs, so the escaping is exercised with the shapes that
// would break it: a quote, a backslash, a newline, a POSIX path, and the empty
// key the ungrouped bucket uses.
const odd: WorkspaceItem[] = [
  { workspaceId: 'a"b', title: 'quote', sessionIds: ['q1'] },
  { workspaceId: 'a\\b', title: 'backslash', sessionIds: ['q2'] },
  { workspaceId: 'a\nb', title: 'newline', sessionIds: ['q3'] },
  { workspaceId: '/home/me/proj', title: 'posix', sessionIds: ['q4'] },
];
const oddRun = render({
  now: T,
  items: odd,
  byId: {
    q1: { running: true },
    q2: { running: true },
    q3: { running: true },
    q4: { running: true },
  },
  statuses: new Map<string, SessionStatus>(),
});
const oddCss = cssOf(oddRun);
for (const item of odd) {
  if (!markedKeys(oddCss).has(item.workspaceId))
    throw new Error(`the key ${JSON.stringify(item.workspaceId)} did not survive escaping`);
}
// A CSS string cannot hold a raw control character: the token ends there and the
// whole rule is dropped as invalid, so the mark would disappear without a trace.
const hasControl = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};
for (const raw of rawKeys(oddCss)) {
  if (hasControl(raw))
    throw new Error(`an unescaped control character reached a selector: ${JSON.stringify(raw)}`);
}

console.log('folded rules:', foldedCount);
console.log('description:', label);
console.log('PASS');
