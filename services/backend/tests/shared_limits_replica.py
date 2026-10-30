"""Each child is an independent backend process sharing only PostgreSQL."""
import asyncio,json,os
from stdio_postgres import Connection
from app import rate_limit as limits
os.environ.update(AUTH_SECRET='isolated-replica-shared-key-123456789',RATE_LIMIT_BACKEND='postgres',APP_ENV='development')
con=Connection()
async def run():
    admitted=0
    for n in range(8):
        limits.BUCKETS.clear() # restart/local state cannot create new allowances
        if await limits.async_counter('login_account','two-independent-processes',True,connection=con) is None:admitted+=1
    return admitted
allowed=asyncio.run(run())
print(json.dumps({'event':'done','checks':8,'allowed':allowed,'wire':{}}),flush=True)
