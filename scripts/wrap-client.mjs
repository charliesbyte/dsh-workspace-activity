import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Wraps the compiled Client half in the browser module table's envelope.
 *
 * The module table does not import a bundle: it reads a lazy factory registered
 * through `window.__ModuleLoader__.load`, and hands that factory a `require`
 * backed by the table. `tsdown` emits the body as CommonJS so the platform
 * packages stay `require` calls instead of being inlined, and this script adds
 * the registration around it. React and the `@deepseek-ai/*` packages therefore
 * resolve from the table at materialization time, never from a copy in this
 * package.
 *
 * Everything — including the stylesheet — stays inside the factory closure, so
 * the bundle script itself only registers; nothing runs until the table
 * materializes the module.
 */

const packageName = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
).name;

const lib = fileURLToPath(new URL('../lib', import.meta.url));
const source = ['client.cjs', 'client.js']
  .map((name) => `${lib}/${name}`)
  .find((path) => existsSync(path));

if (source === undefined) {
  throw new Error('wrap-client: lib/client.cjs was not emitted — run tsdown first');
}

const body = readFileSync(source, 'utf8').trimEnd();

if (body.includes('__ModuleLoader__')) {
  throw new Error('wrap-client: lib/client.cjs already carries the envelope');
}

const envelope = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageName)},
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    (function (require, module, exports) {
${body}
    })(require, module, exports);
    return module.exports;
  },
});
`;

writeFileSync(`${lib}/client.js`, envelope);
if (source.endsWith('.cjs')) rmSync(source);

console.log(`wrap-client: wrote lib/client.js (${envelope.length} bytes) from ${source}`);
