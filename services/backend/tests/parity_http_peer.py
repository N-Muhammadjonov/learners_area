"""ASGI peer for main differential requests; stdin database is isolated test PostgreSQL."""
import json,sys,os,asyncio
from fastapi.testclient import TestClient
from app import main as core
from app.asgi import application
from stdio_postgres import Connection

connection=Connection()
async def pool():return connection
core.pool=pool
os.environ['NODE_ENV']='test'
if os.environ.get('PARITY_OFFLINE_LISTEN')=='true':
    import app.access_events as access
    async def offline_listener(*args,**kwargs):raise OSError('isolated test listener offline')
    access.asyncpg.connect=offline_listener
client=TestClient(application,base_url='http://preview.test',raise_server_exceptions=False)
for line in sys.stdin:
    command=json.loads(line)
    if command.get('event')=='close':break
    try:
        if command.get('operation'):
            try:
                if command['operation']=='context_bindings':
                    from app.dictionary_context import apply_context_bindings
                    value=asyncio.run(apply_context_bindings(connection,command['plan']))
                elif command['operation']=='retention_revision':
                    from app.editorial_revisions import revise_retention_wording
                    value=asyncio.run(revise_retention_wording(connection,command['plan'],command['actor']))
                else:raise ValueError('unknown_editorial_operation')
                print(json.dumps({'event':'response','status':200,'body':value}),flush=True)
            except Exception as error:
                print(json.dumps({'event':'response','status':400,'body':{'error':str(error)}}),flush=True)
            continue
        response=client.request(command['method'],command['path'],content=command.get('body'),headers=command.get('headers',{}),follow_redirects=False)
        content_type=response.headers.get('content-type','')
        try:body=response.json()
        except ValueError:body=response.text if content_type.startswith('text/') else {'binary':True}
        print(json.dumps({'event':'response','status':response.status_code,'body':body,'headers':dict(response.headers)},ensure_ascii=False),flush=True)
    except Exception as error:
        print(json.dumps({'event':'response','status':599,'body':{'testDriverError':str(error)}}),flush=True)
client.close()
