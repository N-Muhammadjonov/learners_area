"""Prepare idempotent content transactions from the reviewed import plan. No connection or credentials."""
import json,sys
from pathlib import Path
types=json.loads((Path(__file__).resolve().parents[1]/'services/backend/app/reading_question_types.json').read_text())
group_codes={canonical:next(a for a in aliases if len(a)<=16) for canonical,aliases,_ in types}
plan=json.loads(Path(sys.argv[1]).read_text());folder=Path(sys.argv[2]);folder.mkdir(exist_ok=True)
def value(v):
 if v is None:return 'NULL'
 if isinstance(v,bool):return 'true' if v else 'false'
 if isinstance(v,(int,float)):return str(v)
 if isinstance(v,(dict,list)):return "'"+json.dumps(v,ensure_ascii=False).replace("'","''")+"'::jsonb"
 return "'"+v.replace("'","''")+"'"
def insert(table,row):
 cols=','.join('"'+k+'"' for k in row);return 'INSERT INTO '+table+' ('+cols+') VALUES ('+','.join(value(v) for v in row.values())+') ON CONFLICT (id) DO NOTHING;'
for s in plan['sets']:
 parts=[p for p in plan['passages'] if any(m['id']==p['id'] for m in s['members'])];sql=['BEGIN;',"SET LOCAL lock_timeout='5s';","SET LOCAL statement_timeout='30s';",'SELECT pg_advisory_xact_lock(hashtext(\'learners-area:reading30:import\'));']
 sql.append(insert('general_reading_sets',{k:s[k] for k in ('id','title','source_ref')}))
 for p in parts:
  sql.append(insert('reading_passages',{k:v for k,v in p.items() if k not in ('groups','questions','paragraphs','sourceTest')}))
  for g in p['groups']:sql.append(insert('reading_question_groups',{**g,'type_code':group_codes[g['type_code']]}))
  for q in p['questions']:sql.append(insert('reading_questions',q))
  for par in p['paragraphs']:sql.append(insert('reading_passage_paragraphs',{'passage_id':p['id'],**par}))
 for m in s['members']:
  if m['existing']:sql.append('UPDATE general_reading_passages SET set_id='+value(s['id'])+',passage_no='+str(m['part'])+' WHERE passage_id='+value(m['id'])+' AND set_id IN ('+value(next(p for p in plan['usedSpares'] if p['id']==m['id'])['memberships'][0]['set'])+','+value(s['id'])+');')
  else:sql.append('INSERT INTO general_reading_passages (passage_id,set_id,passage_no) VALUES ('+','.join(map(value,[m['id'],s['id'],m['part']]))+') ON CONFLICT (passage_id) DO NOTHING;')
 if s['full']:sql.append("DO $$ BEGIN IF (SELECT count(*) FROM reading_questions q JOIN general_reading_passages g ON g.passage_id=q.passage_id WHERE g.set_id="+value(s['id'])+")<>40 OR (SELECT count(*) FROM general_reading_passages WHERE set_id="+value(s['id'])+")<>3 THEN RAISE EXCEPTION 'Invalid 3-passage/40-question source'; END IF; END $$;")
 sql.append('COMMIT;');(folder/(str(s['sourceTest']).zfill(2)+'.sql')).write_text('\n'.join(sql))
print('Prepared',len(plan['sets']),'transactional content batches')
