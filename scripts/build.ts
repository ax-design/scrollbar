// Release build. Needs the dist/ output of @ax-design/shape, typed-om and surface.
//   es/            ES2017 modules and declarations (tsc), dependencies imported, marked as ESM
//   build/index.mjs one self-contained ES module (demos, CDN)
//   build/main.js   the same as UMD: require() or the AxScrollbar global
// The bundles take the ES2017 output of tsc as input and are minified without syntax rewrites,
// so they stay within the browsers this package supports.
import { $ } from 'bun';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
await $`rm -rf ${join(root, 'es')} ${join(root, 'build')}`;
await $`bunx tsc -p ${join(root, "tsconfig.build.json")}`;
// es/ holds ES modules while the package stays CommonJS for build/main.js; Node reads this.
await Bun.write(join(root, 'es/package.json'), JSON.stringify({ type: 'module' }) + '\n');

const minify = { whitespace: true, identifiers: true, syntax: false };
const bundle = async (format: 'esm') => {
    const result = await Bun.build({ entrypoints: [join(root, 'es/index.js')], format, target: 'browser', minify });
    if (!result.success) throw new Error(result.logs.join('\n'));
    return result.outputs[0].text();
};

const esm = await bundle('esm');
await Bun.write(join(root, 'build/index.mjs'), esm);

// UMD from the ES module: its final `export { a as b, ... }` becomes the returned object. A
// CommonJS bundle would pull in Bun's interop helpers, which use ES2021 syntax.
const tail = /export\s*\{([^}]*)\};?\s*$/.exec(esm);
if (!tail) throw new Error('unexpected bundle format: no trailing export clause');
const fields = tail[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
        const [local, exported] = part.split(/\s+as\s+/);
        return `${exported || local}: ${local}`;
    });
await Bun.write(
    join(root, 'build/main.js'),
    `(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AxScrollbar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
${esm.slice(0, tail.index)}
return { ${fields.join(', ')} };
});
`
);

// The Luna kit (subpath @ax-design/scrollbar/kits/luna) as UMD for require(). It imports the package
// by name instead of bundling it: the kit has to extend the classes of the instance the page uses.
const kit = await Bun.build({
    entrypoints: [join(root, 'es/kits/luna/index.js')],
    format: 'esm',
    target: 'browser',
    external: ['@ax-design/scrollbar'],
    minify,
});
if (!kit.success) throw new Error(kit.logs.join('\n'));
const kitEsm = await kit.outputs[0].text();
const head = /^\s*import\s*\{([^}]*)\}\s*from\s*["']@ax-design\/scrollbar["'];?/.exec(kitEsm);
const kitTail = /export\s*\{([^}]*)\};?\s*$/.exec(kitEsm);
if (!head || !kitTail) throw new Error('unexpected kit bundle format: no leading import or trailing export clause');
// `a as b, c` of an import or export clause as [a, b] pairs (b = a when there is no `as`).
const clause = (list: string): [string, string][] =>
    list
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const [from, to] = part.split(/\s+as\s+/);
            return [from, to || from];
        });
await Bun.write(
    join(root, 'build/kits/luna.js'),
    `(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('@ax-design/scrollbar'));
  else root.AxScrollbarLuna = factory(root.AxScrollbar);
})(typeof self !== 'undefined' ? self : this, function (scrollbar) {
var { ${clause(head[1]).map(([name, local]) => `${name}: ${local}`).join(', ')} } = scrollbar;
${kitEsm.slice(head[0].length, kitTail.index)}
return { ${clause(kitTail[1]).map(([local, exported]) => `${exported}: ${local}`).join(', ')} };
});
`
);
console.log('built es/, build/index.mjs, build/main.js, build/kits/luna.js');
