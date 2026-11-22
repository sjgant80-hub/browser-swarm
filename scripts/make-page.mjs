// make-page.mjs — build index.html from page/template.html: every kernel inlined byte for byte in its own scope (its
// import lines rewritten to read the scopes before it, its "export " keywords dropped, its default-export line dropped),
// then the page script. The page decides with the same code the mutation gate proved. test/page.test.mjs checks
// index.html is this build exactly.
//   node scripts/make-page.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// [namespace, file] in dependency order; each module may import only from the ones above it
export const KERNELS = [
  ['SHA', 'src/sha256.mjs'], ['KERNEL', 'vendor/docdec-kernel.mjs'], ['GATE', 'vendor/docdec-gate.mjs'], ['STATS', 'vendor/stats.mjs'],
  ['GUARD', 'vendor/guard.mjs'], ['ROUTE', 'vendor/route.mjs'], ['CHECKS', 'src/checks.mjs'], ['CELLS', 'src/cells.mjs'],
  ['SCORE', 'src/score.mjs'], ['SWARM', 'src/swarm.mjs'], ['ADV', 'src/adversary.mjs'], ['CLAIMS', 'src/claims.mjs'], ['COST', 'src/cost.mjs'],
];
const LF = (s) => s.split('\r\n').join('\n');
const nsOf = (spec, from) => {
  const want = spec.replace(/^\.\.?\//, '').replace(/^(\.\.\/)+/, '');
  const hit = KERNELS.find(([, f]) => f.endsWith(want.split('/').pop()) && (f.startsWith(from.split('/')[0]) ? f.endsWith(want) || f.split('/').pop() === want.split('/').pop() : true));
  if (!hit) throw new Error(`${from}: cannot inline the import of ${spec}`);
  return hit[0];
};
// imports(line, from) → the import line as a read of an earlier scope, or null when the line is not an import
export function rewrite(line, from) {
  let m = line.match(/^import\s+\{([^}]*)\}\s+from\s+'([^']+)';\s*$/);
  if (m) return `const { ${m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^(\w+)\s+as\s+(\w+)$/, '$1: $2')).join(', ')} } = ${nsOf(m[2], from)};`;
  m = line.match(/^import\s+(\w+)\s+from\s+'([^']+)';\s*$/);
  if (m) return `const ${m[1]} = ${nsOf(m[2], from)};`;
  return null;
}
// body(src, file) → the module as page code, and the names it exports
export function body(src, file) {
  const names = [...LF(src).matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map((m) => m[1]);
  const code = LF(src).split('\n').filter((l) => !l.startsWith('export default ')).map((l) => rewrite(l, file) ?? l).join('\n').replace(/^export /gm, '').trim();
  return { code, names };
}
export function build(root = '.') {
  const read = (p) => LF(readFileSync(`${root}/${p}`, 'utf8'));
  const kernels = KERNELS.map(([ns, file]) => {
    const { code, names } = body(read(file), file);
    return `// ${file}, inlined byte for byte (imports read the scopes above; export removed)\nconst ${ns} = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`;
  }).join('\n\n');
  return read('page/template.html').replace('/*KERNELS*/', () => kernels).replace('/*APP*/', () => read('page/app.js').trim());
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync('index.html', build());
  console.log('index.html built');
}
