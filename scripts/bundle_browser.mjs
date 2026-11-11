/**
 * Build-only Rollup ESM bundling. A feature is downloaded when its route is
 * requested; common dependencies are split into stable shared browser chunks.
 *
 * The raw modules remain in the Python asset manifest as a compatibility
 * fallback for worker URLs and historical dynamic module references.
 * No source module is modified and no JS bundler runs in production.
 */
import {readdirSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import {rollup} from 'rollup';

const project = resolve(process.cwd(), 'frontend/vanilla');
const input = resolve(project, 'js/main.js');
const outDir = resolve(process.cwd(), 'bundle-output');
const groupNames = new Set([
  'listening', 'reading', 'speaking', 'writing', 'grammar', 'vocabulary',
  'staff', 'shell', 'auth', 'dashboard', 'study-plan', 'assignments',
  'mocks', 'progress', 'live-classes', 'video', 'riwi', 'coach',
  'notifications', 'support', 'courses', 'profile'
]);

function featureGroup(id) {
  if (id === input || !id.startsWith(project + sep)) return undefined;
  const rel = relative(project, id).split(sep);
  if (rel[0] === 'modules') {
    let name = rel[1];
    if (name === 'staff-final30') name = 'staff';
    if (name?.endsWith('.js')) name = 'other';
    return groupNames.has(name) ? name : 'other';
  }
  if (rel[0] === 'js') {
    if (rel[1] === 'generated') return 'shared-generated';
    if (rel[1] === 'adapters') return 'shared-adapters';
    if (rel[1] === 'vendor') return 'vendor';
    return 'shared-runtime';
  }
  return undefined;
}

function collectDynamicImports(node, found) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectDynamicImports(child, found);
    return;
  }
  if (node.type === 'ImportExpression' &&
      !(node.source.type === 'Literal' && typeof node.source.value === 'string')) {
    found.push(node);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'source' && node.type === 'ImportExpression') continue;
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    if (value && typeof value === 'object') collectDynamicImports(value, found);
  }
}

/**
 * Resolve bounded relative import(variable) / import(`./${name}.js`) calls.
 * The original import expression is retained for non-local specifiers, so
 * historical URLs and feature flags never become a broken build dependency.
 */
function boundedDynamicImports() {
  return {
    name: 'bounded-local-dynamic-imports',
    transform(source, id) {
      if (!id.startsWith(project + sep) || extname(id) !== '.js') return null;
      const expressions = [];
      collectDynamicImports(this.parse(source), expressions);
      if (!expressions.length) return null;
      const files = readdirSync(dirname(id), {withFileTypes: true})
        .filter(entry => entry.isFile() && /\.m?js$/.test(entry.name))
        .map(entry => entry.name).sort();
      if (!files.length) return null;
      const factory = '__laLocalImports';
      const loader = '__laImportLocal';
      const mappings = files.map(file =>
        `${JSON.stringify('./' + file)}:()=>import(${JSON.stringify('./' + file)})`
      ).join(',');
      let code = source;
      for (const expression of expressions.sort((a, b) => b.start - a.start)) {
        const argument = source.slice(expression.source.start, expression.source.end);
        code = code.slice(0, expression.start) +
          `${loader}(${argument})` + code.slice(expression.end);
      }
      const header = `const ${factory}=Object.freeze({${mappings}});\n` +
        `const ${loader}=specifier=>${factory}[specifier]?.()??import(specifier);\n`;
      return {code: header + code, map: null};
    }
  };
}

const warnings = [];
const bundle = await rollup({
  input,
  plugins: [boundedDynamicImports()],
  preserveEntrySignatures: false,
  treeshake: {moduleSideEffects: true},
  onwarn(warning, defaultHandler) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    if (warning.code === 'UNRESOLVED_IMPORT' ||
        warning.code === 'MISSING_EXPORT' ||
        warning.code === 'INVALID_OPTION') {
      throw new Error(warning.message);
    }
    warnings.push(warning.message);
    defaultHandler(warning);
  },
  external(id) {
    return /^(https?:|data:|blob:)/.test(id);
  }
});

try {
  rmSync(outDir, {recursive: true, force: true});
  mkdirSync(outDir, {recursive: true});
  const result = await bundle.write({
    dir: outDir,
    format: 'es',
    compact: true,
    sourcemap: false,
    entryFileNames: 'js/main.js',
    chunkFileNames: 'js/bundles/[name]-[hash:12].js',
    onlyExplicitManualChunks: true,
    manualChunks: featureGroup
  });
  const chunks = result.output.filter(entry => entry.type === 'chunk');
  const names = chunks.map(chunk => chunk.fileName);
  if (!names.includes('js/main.js') || chunks.length < 2) {
    throw new Error('Feature bundling failed: no lazy chunks generated');
  }
  for (const chunk of chunks) {
    if (!chunk.fileName.startsWith('js/')) {
      throw new Error('Unexpected bundle output: ' + chunk.fileName);
    }
  }
  const summary = {
    version: 1,
    entry: 'js/main.js',
    chunkCount: chunks.length,
    chunks: chunks.map(chunk => ({
      path: chunk.fileName,
      bytes: Buffer.byteLength(chunk.code),
      moduleCount: Object.keys(chunk.modules).length,
      isEntry: chunk.isEntry
    })),
    warnings: warnings.length
  };
  writeFileSync(resolve(outDir, 'bundle-report.json'),
    JSON.stringify(summary, null, 2) + '\n');
  console.log('Browser bundles: ' + JSON.stringify({
    chunks: summary.chunkCount,
    codeBytes: summary.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    features: summary.chunks.filter(chunk => /js\\/bundles\\/(listening|reading|speaking|writing|grammar|vocabulary|staff)-/.test(chunk.path)).map(chunk => chunk.path)
  }));
} finally {
  await bundle.close();
}
