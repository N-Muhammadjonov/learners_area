"""Real launcher/TCP/SIGTERM acceptance with synthetic work and no database."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parents[3]


def child():
    from app import main as core
    from fastapi import Request
    receipt=Path(os.environ['LA_PROBE_RECEIPT'])
    @core.app.post('/api/task6-probe/commit')
    async def commit(req:Request):
        identifier=(await req.json())['id']
        with (receipt/'entered').open('a') as file:file.write(str(identifier)+'\n')
        await asyncio.sleep(2)
        with (receipt/'completed').open('a') as file:file.write(str(identifier)+'\n')
        return core.j({'ok':True})
    spec=importlib.util.spec_from_file_location('isolated_launcher',ROOT/'scripts/serve.py')
    launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(launcher)
    launcher.load_environment=lambda:None  # Never load project credentials for this probe.
    import uvicorn
    original=uvicorn.run
    def observed(*args,**kwargs):
        expected={'workers':1,'backlog':128,'timeout_keep_alive':5,
                  'timeout_graceful_shutdown':30,'proxy_headers':False}
        assert {k:kwargs[k] for k in expected}==expected
        (receipt/'launcher.json').write_text(json.dumps(expected))
        return original(*args,**kwargs)
    uvicorn.run=observed;sys.argv=[sys.argv[0]];launcher.main()


async def probe():
    import httpx
    with tempfile.TemporaryDirectory(prefix='la-task6-') as temp:
        receipt=Path(temp)
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        env={'PATH':os.environ['PATH'],'PYTHONPATH':str(ROOT/'services/backend'),
             'BACKEND_PYTHON':sys.executable,'HOST':'127.0.0.1','PORT':str(port),
             'APP_ENV':'development','RATE_LIMIT_BACKEND':'memory',
             'AUTH_SECRET':'isolated-lifecycle-probe-secret','WEB_CONCURRENCY':'99',
             'LA_PROBE_RECEIPT':temp}
        process=subprocess.Popen([sys.executable,__file__,'child'],cwd=ROOT,env=env,
                                 stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        try:
            async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}',
                    timeout=10,limits=httpx.Limits(max_connections=100)) as client:
                until=time.monotonic()+10
                while True:
                    try:
                        if (await client.get('/healthz')).status_code==200:break
                    except httpx.TransportError:pass
                    assert time.monotonic()<until,'isolated launcher did not start'
                    await asyncio.sleep(.05)
                requests=[asyncio.create_task(client.post('/api/task6-probe/commit',json={'id':n})) for n in range(64)]
                until=time.monotonic()+1.5
                while not (receipt/'entered').exists() or len((receipt/'entered').read_text().splitlines())<64:
                    assert time.monotonic()<until,'all admitted requests did not enter together'
                    await asyncio.sleep(.01)
                assert (await client.get('/healthz')).status_code==200
                assert (await client.get('/readyz')).status_code==503
                excess=await client.post('/api/task6-probe/commit',json={'id':'excess'})
                assert excess.status_code==503 and excess.headers['retry-after']=='1'
                process.send_signal(signal.SIGTERM)
                responses=await asyncio.gather(*requests)
                assert all(r.status_code==200 for r in responses)
            code=await asyncio.to_thread(process.wait,10)
            output=process.stdout.read().decode(errors='replace')
            # Uvicorn 0.54 deliberately re-raises the received signal after its
            # graceful teardown. A negative SIGTERM return is expected on POSIX.
            assert code in (0,-signal.SIGTERM) and 'Application shutdown complete.' in output,output[-2000:]
            completed=(receipt/'completed').read_text().splitlines()
            assert sorted(map(int,completed))==list(range(64))
            print(json.dumps({'result':'passed','wire_requests_admitted':64,'overload_status':503,
                'liveness_while_saturated':200,'readiness_while_saturated':503,
                'completed_once_after_sigterm':64,'process_exit':code,
                'launcher':json.loads((receipt/'launcher.json').read_text()),
                'scope':'Synthetic local in-flight work over real TCP and the actual launcher; no academic/database or capacity claim.'}))
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=3)
                except subprocess.TimeoutExpired:process.kill();process.wait()


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='child':child()
    else:asyncio.run(probe())
