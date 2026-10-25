// Optional developer compatibility command; the build itself is Python only.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result=spawnSync(process.env.PYTHON||'python3',[fileURLToPath(new URL('../../../scripts/build_native_assets.py',import.meta.url))],{stdio:'inherit'});
process.exit(result.status??1);
