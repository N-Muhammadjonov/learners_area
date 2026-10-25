/** Test-only runner: main remains an independent, checksum-pinned checkout. */
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.MAIN_REFERENCE_ROOT)throw Error('Set MAIN_REFERENCE_ROOT to the pinned main checkout; see services/backend/README.md.');
const reference=resolve(process.env.MAIN_REFERENCE_ROOT);
for(const scope of ['all','workflows']){
 const result=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','scripts/verify-main-http-parity.mjs'],{
  cwd:root,stdio:'inherit',env:{...process.env,MAIN_REFERENCE_ROOT:reference,TSX_TSCONFIG_PATH:reference+'/tsconfig.json',PARITY_SCOPE:scope,
   PARITY_REPORT:resolve(process.env.PARITY_OUTPUT_DIR||'/tmp','learners-main-'+scope+'.json')}});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
