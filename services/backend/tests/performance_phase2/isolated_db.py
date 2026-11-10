"""Owned TCP-only PostgreSQL fixture. No external database URL is accepted.

Requires the optional embedded-postgres QA package. This module is never part of
the production application or frontend build. All DDL/data are disposable.
"""
from __future__ import annotations
import asyncio
import importlib.util
import os
import re
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[4]
BACKEND = ROOT / 'services/backend'
UID = '11111111-1111-4111-8111-111111111111'
PASSWORD = 'IsolatedPhase2Only123!'


class OwnedDatabase:
    def __init__(self, parent):
        self.root = Path(tempfile.mkdtemp(prefix='phase2-owned-', dir=parent))
        spec = importlib.util.find_spec('embedded_postgres')
        if not spec or not spec.origin:
            raise RuntimeError('Optional QA dependency embedded-postgres is required')
        self.bin = Path(spec.origin).parent / 'pginstall/bin'
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); self.port = s.getsockname()[1]
        self.dsn = f'postgresql://phase2@127.0.0.1:{self.port}/postgres'
        self.process = None
        self.log = None

    async def start(self):
        self.log = (self.root / 'postgres.log').open('w')
        subprocess.run([str(self.bin/'initdb'), '-D', str(self.root/'data'),
                        '-U', 'phase2', '-A', 'trust', '--no-locale', '-E', 'UTF8'],
                       stdout=self.log, stderr=self.log, check=True)
        self.process = subprocess.Popen([str(self.bin/'postgres'), '-D', str(self.root/'data'),
                            '-h', '127.0.0.1', '-p', str(self.port), '-k', ''],
                            stdout=self.log, stderr=self.log)
        import asyncpg
        for _ in range(100):
            try:
                c = await asyncpg.connect(self.dsn); await c.close(); break
            except (OSError, asyncpg.PostgresError):
                if self.process.poll() is not None:
                    raise RuntimeError('Owned PostgreSQL exited; inspect local postgres.log')
                await asyncio.sleep(.1)
        else: raise RuntimeError('Owned PostgreSQL did not start')
        # Clear inherited platform/provider configuration in this test process.
        for key in list(os.environ):
            if key.startswith(('RAILWAY_', 'VERCEL_', 'SUPABASE_', 'R2_', 'S3_', 'OPENAI_', 'MEDIA_', 'AUTH_EVENTS_', 'CLOUDFLARE_')):
                os.environ.pop(key, None)
        os.environ.update(DATABASE_URL=self.dsn, APP_ENV='test',
            AUTH_SECRET='isolated-phase2-signing-key-never-production',
            BACKEND_SERVICE_TOKEN='isolated-phase2-renderer-never-production',
            AI_EXTERNAL_ENABLED='false', STT_PRIMARY_PROVIDER='none',
            STORAGE_PROVIDER='local', STORAGE_LOCAL_DIR=str(self.root/'media'),
            DATABASE_POOL_MAX='5', DATABASE_POOL_ACQUIRE_TIMEOUT='5',
            PUBLIC_BASE_URL='http://localhost:4173')
        sys.path[:0] = [str(BACKEND), str(BACKEND/'tests')]
        from app.db import initialize_connection
        import bcrypt
        from browser_fixtures import seed, id as fid
        c = await asyncpg.connect(self.dsn)
        await initialize_connection(c)
        try:
            for file in sorted((BACKEND/'migrations').glob('*.sql')):
                for index, sql in enumerate(file.read_text().split('--> statement-breakpoint')):
                    if re.sub(r'--[^\n]*|/\*.*?\*/', '', sql, flags=re.S).strip():
                        try: await c.execute(sql)
                        except Exception as exc:
                            raise RuntimeError(f'Disposable migration {file.name} statement {index}: {type(exc).__name__}: {exc}') from exc
            import json
            for path in json.loads((BACKEND/'tests/platform-migrations.json').read_text()):
                source = (ROOT/path).resolve()
                assert source.is_relative_to(ROOT/'supabase/migrations')
                await c.execute(source.read_text())
            digest = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
            await c.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,'Isolated Phase 2 learner','phase2@example.test',$2,'student','active','en')", UID, digest)
            await seed(c, UID, digest)
            await c.execute("UPDATE listening_packages SET payload=jsonb_set(payload,'{audio,durationSec}','3660'::jsonb) WHERE source_id LIKE 'browser:%'")
            # Isolated capacity population. No production/customer text is used.
            await c.execute("""INSERT INTO users(id,name,email,role,account_status,locale)
                SELECT md5('phase2-user-'||n)::uuid,'Synthetic learner '||n,
                'phase2-'||n||'@example.test','student','active','en'
                FROM generate_series(1,150) n""")
            await c.execute("""INSERT INTO writing_submissions(id,user_id,prompt_id,content,word_count)
                SELECT md5('phase2-writing-'||n)::uuid,md5('phase2-user-'||n)::uuid,$1,
                'Synthetic owner '||n||' draft',4 FROM generate_series(1,150) n""", fid('writing-prompt'))
            await c.execute('ANALYZE')
            self.volume = {t: await c.fetchval(f'SELECT count(*) FROM {t}') for t in
                ('users', 'reading_questions', 'listening_questions', 'writing_submissions', 'user_vocabulary', 'dictionary_entries')}
        finally: await c.close()
        return self

    def close(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try: self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill(); self.process.wait(timeout=5)
        if self.log: self.log.close()
