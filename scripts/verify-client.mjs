import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import TestRenderer from 'react-test-renderer';

/**
 * Renders the built Client bundle the way the browser module table does: capture
 * the factory off a fake `__ModuleLoader__`, hand it a `require` backed by real
 * React, then drive `apply` and render the registered component with a real
 * renderer so hooks behave as they do in the product. This checks the envelope,
 * the registration, and the CSS the entry publishes — not the running sidebar.
 */

let captured;
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      captured = registration;
    },
  },
};

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
(0, eval)(source);

if (captured?.id !== 'dsh-workspace-activity') {
  throw new Error(`envelope id mismatch: ${captured?.id}`);
}

const mod = captured.factory((specifier) => {
  if (specifier === 'react') return require('react');
  throw new Error(`unexpected require: ${specifier}`);
});

if (!Array.isArray(mod.inject) || typeof mod.apply !== 'function') {
  throw new Error('bundle did not export inject/apply');
}

let registered;
const localeCalls = [];
const ctx = {
  get: (name) =>
    name === 'locale'
      ? {
          register: (ns, dicts) => {
            localeCalls.push({ ns, dicts });
            return () => {};
          },
        }
      : undefined,
  effect: (callback) => {
    callback();
  },
  slots: {
    inject: (key, callback) => {
      if (key !== 'sidebar.footer.action') throw new Error(`injected ${key}`);
      callback();
    },
    register: (options, component) => {
      registered = { options, component };
    },
  },
};

mod.apply(ctx);

if (registered?.options?.name !== 'sidebar.footer.action') {
  throw new Error('entry did not register against the footer slot');
}
if (localeCalls.length !== 1) throw new Error('locale was not registered once');
if (registered.options.locale !== 'workspace-activity') {
  throw new Error('entry did not declare its locale namespace');
}

/** The English dictionary, so assertions can read the strings a user would see. */
const DICT = {
  'activity.running': '{n} sessions running',
  'activity.finished': '{n} sessions finished',
  'activity.tooltip': '{summary}: {names}',
  'activity.more': 'and {n} more',
  'activity.separator': ', ',
  'activity.unnamed': 'Ungrouped',
};

const t = (key, params) => {
  const template = DICT[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
};

/** Render the entry against one fixed snapshot of the three feeds. */
function render({ items, byId, statuses, archived = [] }) {
  let tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      createElement(registered.component, {
        useWorkspaces: (selector) => selector({ items, archivedSessionIds: archived }),
        useSessions: (selector) => selector({ byId }),
        useSessionStatus: (selector) => selector(statuses),
        t,
      }),
    );
  });
  return tree;
}

const live = render({
  items: [
    { workspaceId: 'C:\\a', title: 'alpha', sessionIds: ['s1'] },
    { workspaceId: 'C:\\b', title: 'beta', sessionIds: ['s2'] },
    { workspaceId: 'C:\\c', title: 'gamma', sessionIds: ['s3'] },
    { workspaceId: 'C:\\d', title: 'delta', sessionIds: ['s4'] },
  ],
  byId: {
    s1: { running: true },
    s2: { running: false },
    s3: { running: false },
    s4: { running: false },
  },
  // The status feed wins where it names a session: beta runs even though the
  // session list says otherwise, gamma has finished unread, and delta is idle.
  statuses: new Map([
    ['s1', { running: true }],
    ['s2', { running: true }],
    ['s3', { running: false, completionUnread: true }],
    ['s4', { running: false, completionUnread: false }],
  ]),
});

const style = live.root.findByType('style');
const css = style.props.children;
console.log('--- CSS ---');
console.log(css);
console.log('--- checks ---');

// Running workspaces keep the spinning ring, and both of them carry every rule.
for (const key of ['C:\\\\a', 'C:\\\\b']) {
  const selector = `[data-row-key="workspace:${key}"]::after`;
  if (!css.includes(selector)) throw new Error(`missing ring rule for ${selector}`);
}
const foldedCount = (css.match(/aria-expanded="false"\]>span:first-child\{/g) ?? []).length;
if (foldedCount !== 1) throw new Error(`expected 1 folded rule, got ${foldedCount}`);
for (const rule of css.split(/(?<=})/)) {
  if (!rule.includes('workspace:C:\\\\a')) continue;
  if (!rule.includes('workspace:C:\\\\b')) throw new Error(`rule lost a selector: ${rule}`);
}

// A finished workspace keeps a static success dot instead of going quiet.
const doneSelector = '[data-row-key="workspace:C:\\\\c"]::after';
if (!css.includes(doneSelector)) throw new Error(`missing finished rule for ${doneSelector}`);
if (!css.includes('--dsw-alias-state-success-primary'))
  throw new Error('finished mark lost its colour');
const doneRule = css.split(/(?<=})/).find((rule) => rule.startsWith(doneSelector));
if (doneRule === undefined) throw new Error('finished rule is not the first selector in its rule');
if (doneRule.includes('animation')) throw new Error('finished mark must not animate');

// An idle workspace is left alone entirely.
if (css.includes('workspace:C:\\\\d')) throw new Error('an idle workspace was decorated');

const text = live.root.findAllByType('span').map((node) => node.props.children);
const label = text.find(
  (value) => typeof value === 'string' && value.includes('sessions finished'),
);
if (label === undefined) throw new Error('the description did not mention the finished sessions');

const idle = render({ items: [], byId: {}, statuses: new Map() });
if (idle.toJSON() !== null)
  throw new Error('the entry rendered while nothing was running or finished');

// Archived sessions are the browser's to hide, so they never reach the rules.
const archived = render({
  items: [{ workspaceId: 'C:\\a', title: 'alpha', sessionIds: ['s1'] }],
  byId: { s1: { running: true } },
  statuses: new Map([['s1', { running: true }]]),
  archived: ['s1'],
});
if (archived.toJSON() !== null) throw new Error('an archived session was still counted');

console.log('folded rules:', foldedCount);
console.log('description:', label);
console.log('PASS');
