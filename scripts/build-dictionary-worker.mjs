import {build} from 'esbuild';
// Self-contained private Node worker: no TS runtime dependency in production.
await build({entryPoints:['scripts/dictionary/index-worker.ts'],outfile:'build/dictionary-index-worker.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',conditions:['react-server'],logLevel:'warning'});
