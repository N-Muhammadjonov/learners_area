import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'dev';
if (!['dev', 'start', 'check'].includes(mode)) throw new Error('Use dev, start or check');
nextEnv.loadEnvConfig(root, mode !== 'start');
const external = process.env.BACKEND_MANAGED === 'external';
const backend = new URL(process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8000');
if (!['http:', 'https:'].includes(backend.protocol) || backend.pathname !== '/' || backend.search || backend.hash || backend.username || backend.password) throw new Error('BACKEND_INTERNAL_URL must be an HTTP origin');
if (!external && !['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname)) throw new Error('Remote backends require BACKEND_MANAGED=external');
if (!external && backend.protocol !== 'http:') throw new Error('The managed local backend uses HTTP on loopback');
if (!external && !backend.port) throw new Error('The managed local backend requires an explicit BACKEND_INTERNAL_URL port');
if (external && (!process.env.BACKEND_SERVICE_TOKEN || process.env.BACKEND_SERVICE_TOKEN.length < 32)) throw new Error('The external backend requires BACKEND_SERVICE_TOKEN');
const env = {
  ...process.env,
  BACKEND_INTERNAL_URL: backend.origin,
  BACKEND_SERVICE_TOKEN: process.env.BACKEND_SERVICE_TOKEN || randomBytes(32).toString('hex'),
  STORAGE_LOCAL_DIR: resolve(root, process.env.STORAGE_LOCAL_DIR || '.data/uploads'),
};
const python = resolve(root, process.env.BACKEND_PYTHON || 'services/backend/.venv/bin/python');
if (!external && !existsSync(python)) throw new Error('Python environment missing. Run npm run backend:setup first, or set BACKEND_PYTHON.');
if (mode === 'check') {
  if (!external) {
    const result = spawnSync(python, ['-c', 'import app.asgi,asyncpg,bcrypt,reportlab,docx,jwt; from app.dictionary_collation import en_locale_compare; assert en_locale_compare("a","A") < 0; print("FastAPI runtime ready")'], { cwd: join(root, 'services/backend'), env, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
  console.log('External backend configuration ready');
  process.exit(0);
}
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}
function start(command, args, cwd, childEnv) {
  const child = spawn(command, args, { cwd, env: childEnv, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => { console.error('Could not start an application service'); stop(1); });
  child.on('exit', code => stop(code ?? 1));
  return child;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
if (!external) start(python, ['-m', 'uvicorn', 'app.asgi:application', '--host', backend.hostname === '[::1]' ? '::1' : backend.hostname, '--port', backend.port || '8000', '--no-access-log', '--no-proxy-headers'], join(root, 'services/backend'), env);
let ready = false;
for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
  try {
    const response = await fetch(new URL('/_frontend/session', backend), { headers: { 'x-backend-service-token': env.BACKEND_SERVICE_TOKEN }, signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* startup poll only; application calls never retry failed writes */ }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!ready) { console.error('FastAPI did not become ready'); stop(1); }
else if (!stopping) {
  const frontendEnv = { ...env };
  delete frontendEnv.DATABASE_URL;
  start(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), mode], root, frontendEnv);
}
