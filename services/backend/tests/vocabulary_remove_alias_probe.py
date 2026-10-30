"""Authenticated selected-delete HTTP boundaries on isolated PostgreSQL data."""
import asyncio
import json
import os
from uuid import UUID

from fastapi.testclient import TestClient
from stdio_postgres import Connection
from app import main as core
from app.asgi import application
from app.security import SESSION_COOKIE

os.environ.update(AUTH_SECRET='isolated-vocabulary-probe-only',NODE_ENV='development',RATE_LIMIT_BACKEND='memory')
con=Connection()
async def pool():return con
core.pool=pool
def run(coro):return asyncio.run(coro)
def uid(n):return UUID(int=9000+n)
for n in (1,2):
    run(con.execute("INSERT INTO users(id,name,role,account_status,locale) VALUES($1,'Synthetic learner','student','active','en')",uid(n)))
    run(con.execute("INSERT INTO lexemes(id,term,sense_key,definition_en) VALUES($1,$2,$2,'Synthetic meaning')",uid(10+n),'isolated-vocabulary-'+str(n)))
    run(con.execute('INSERT INTO user_vocabulary(id,user_id,lexeme_id) VALUES($1,$2,$3)',uid(20+n),uid(n),uid(10+n)))
tokens=[core.issue_token(dict(run(con.fetchrow('SELECT * FROM users WHERE id=$1',uid(n))))) for n in (1,2)]
client=TestClient(application,base_url='http://preview.test');checks=0
def check(value):
    global checks
    assert value;checks+=1
def post(ids,token=None,**kwargs):
    headers={'origin':'http://preview.test'}
    if token:headers['cookie']=SESSION_COOKIE+'='+token
    headers.update(kwargs)
    return client.post('/api/vocabulary/remove',json={'ids':ids},headers=headers)
check(post([str(uid(21))]).status_code==401)
check(post([str(uid(21))],tokens[0],origin='https://foreign.invalid').status_code==403)
for ids in ([],['invalid'],[str(uid(21))]*2):check(post(ids,tokens[0]).status_code==400)
check(post([str(uid(22))],tokens[0]).status_code==404)
check(post([str(uid(21)),str(uid(22))],tokens[0]).status_code==404)
check(run(con.fetchval('SELECT count(*) FROM user_vocabulary'))==2)
response=post([str(uid(21))],tokens[0])
check(response.status_code==200 and response.json()=={'ok':True,'deleted':1,'deletedIds':[str(uid(21))]})
check(post([str(uid(21))],tokens[0]).status_code==404)
check(run(con.fetchval('SELECT count(*) FROM user_vocabulary WHERE id=$1',uid(22)))==1)
check(post([str(uid(22))],tokens[1]).status_code==200)
print(json.dumps({'event':'done','checks':checks,'external_calls':0}),flush=True)
