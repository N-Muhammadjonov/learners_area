/** Use the lockfile-pinned root Tailwind at build time; no Node server is emitted. */
import {existsSync,symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const modules=resolve(root,'frontend/vanilla/node_modules');
if(!existsSync(modules))symlinkSync(resolve(root,'node_modules'),modules,'dir');
const result=spawnSync(process.execPath,[resolve(root,'frontend/vanilla/scripts/build.mjs')],{cwd:root,stdio:'inherit'});
process.exit(result.status??1);
