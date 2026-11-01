"""Synthetic, disposable load fixture. Never accepts a remote/production target."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID

import asyncpg
import bcrypt
from app.db import initialize_connection
from app.security import issue_token, SESSION_COOKIE
from browser_fixtures import seed, id as fixture_id
from safety import guard


def uid(kind, n):
    return UUID(hashlib.md5(f'load-{kind}-{n}'.encode()).hexdigest())


async def main():
    guard()
    con=await asyncpg.connect(os.environ['DATABASE_URL'])
    await initialize_connection(con)
    try:
        assert await con.fetchval("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")==0
        for file in sorted(Path('/migrations').glob('*.sql')):
            for sql in file.read_text().split('--> statement-breakpoint'):
                if sql.strip():await con.execute(sql)
        # Current main's Mock extension lives in the platform migration tree.
        # Apply this reviewed additive DDL only to the guarded disposable target.
        for path in json.loads(Path('/fixtures/platform-migrations.json').read_text()):
            parts=Path(path).parts
            assert len(parts)==3 and parts[:2]==('supabase','migrations') and parts[2].endswith('.sql')
            async with con.transaction():await con.execute((Path('/platform-migrations')/parts[2]).read_text())
        digest=bcrypt.hashpw(b'IsolatedLoadOnly123!',bcrypt.gensalt(rounds=4)).decode()
        await con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,'Synthetic learner 1','load-1@example.test',$2,'student','active','en')",uid('user',1),digest)
        await seed(con,str(uid('user',1)),digest)
        await con.execute("""INSERT INTO users(id,name,email,role,account_status,locale)
          SELECT md5('load-user-'||n)::uuid,'Synthetic learner '||n,'load-'||n||'@example.test','student','active','en'
          FROM generate_series(2,1000) n""")
        await con.execute("""INSERT INTO lexemes(id,term,sense_key,part_of_speech,definition_en,translation_uz)
          SELECT md5('load-word-'||n)::uuid,'load'||lpad(n::text,5,'0'),'load-sense-'||n,'noun',
          'Synthetic definition '||md5(n::text),'Suniy izoh' FROM generate_series(1,8200) n""")
        await con.execute("""INSERT INTO user_vocabulary(user_id,lexeme_id,state)
          SELECT md5('load-user-'||u)::uuid,md5('load-word-'||w)::uuid,
          (CASE WHEN w%3=0 THEN 'known' ELSE 'new' END)::vocab_state
          FROM generate_series(1,1000) u CROSS JOIN generate_series(1,50) w""")
        await con.execute("""INSERT INTO writing_submissions(id,user_id,prompt_id,content,word_count)
          SELECT md5('load-writing-'||n)::uuid,md5('load-user-'||n)::uuid,$1,
          'LAPRIVATE_'||n||'_v0 synthetic draft',3 FROM generate_series(1,1000) n""",fixture_id('writing-prompt'))
        await con.execute("""INSERT INTO reading_passages(id,title,body_text,publication_state,suggested_minutes)
          SELECT md5('load-passage-'||n)::uuid,'Synthetic passage '||n,
          repeat('An authored synthetic English passage. '||md5(n::text)||' ',100),'published',20
          FROM generate_series(4,105) n""")
        await con.execute("""INSERT INTO reading_questions(id,passage_id,"order",type,type_code,question_text,correct_answer,explanation)
          SELECT md5('load-question-'||n)::uuid,md5('load-passage-'||(4+(n%102)))::uuid,1+n/102,
          'short_answer','short_answer','Synthetic objective question','fixture','Synthetic answer evidence'
          FROM generate_series(1,1366) n""")
        await con.execute("""INSERT INTO reading_attempts(id,user_id,passage_id)
          SELECT md5('load-reading-'||n)::uuid,md5('load-user-'||n)::uuid,$1 FROM generate_series(1,1000) n""",fixture_id('passage1'))
        await con.execute("""INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,audio_url,publication_state)
          SELECT md5('load-listening-'||n)::uuid,$1,'Synthetic Listening '||n,'audio',
          '/api/resources/listening/fixture.mp3','published' FROM generate_series(4,62) n""",fixture_id('teacher'))
        await con.execute("""INSERT INTO listening_packages(test_id,source_id,payload,audio_object_key,source_hash)
          SELECT md5('load-listening-'||n)::uuid,'load-listening-'||n,$1::jsonb,'listening/fixture.mp3',repeat('a',64)
          FROM generate_series(4,62) n""",{'collection':'academic','audio':{'path':'audio.mp3'},'sections':[],'questions':[],'vocabulary':[]})
        await con.execute("""INSERT INTO listening_questions(id,test_id,"order",type,type_code,question_text,options,correct_answer,explanation)
          SELECT md5('load-listening-question-'||n)::uuid,md5('load-listening-'||(4+(n%59)))::uuid,1+n/59,
          'multiple_choice','mcq_single','Synthetic choice','["A","B"]'::jsonb,'A','Synthetic evidence'
          FROM generate_series(1,1382) n""")
        # Match the observed production footprint: 322,263 R2-backed identities,
        # ~20% retained previews, ~80% range locations, not customer dictionary text.
        await con.execute("""INSERT INTO dictionary_releases(id,state)
          SELECT 'rel-v1-'||left(md5('load-release-'||n),24),'building' FROM generate_series(0,4) n""")
        await con.execute("""INSERT INTO dictionary_entries(release_id,lexeme_id,lemma_norm,part_of_speech,lexical_type,payload,content_sha,
          storage_shard,storage_release,search_preview,sense_ids,example_ids,storage_offset,storage_length,storage_raw_bytes)
          SELECT 'rel-v1-'||left(md5('load-release-'||(n%5)),24),md5('load-dictionary-'||n)::uuid,
          'load'||lpad((n%60000)::text,5,'0'),'n','word',NULL,md5(n::text)||md5(n::text),
          left(md5('load-dictionary-'||n),2),'rel-v1-'||left(md5('load-release-'||(n%5)),24),
          CASE WHEN n%5=0 THEN jsonb_build_object('headword','load'||n,'definitionEn',repeat(md5(n::text),4),'translationUz',md5((n+1)::text)) END,
          CASE WHEN n%2=0 THEN ARRAY[md5('sense-'||n)::uuid,md5('sense-other-'||n)::uuid] ELSE ARRAY[md5('sense-'||n)::uuid] END,
          CASE WHEN n%4=0 THEN ARRAY[]::uuid[] ELSE ARRAY[md5('example-'||n)::uuid] END,
          CASE WHEN n%5<>0 THEN 0 END,CASE WHEN n%5<>0 THEN 400 END,CASE WHEN n%5<>0 THEN 1000 END
          FROM generate_series(1,322263) n""")
        tables=await con.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        for row in tables:
            name=row['tablename'];assert name.replace('_','').isalnum()
            await con.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
        await con.execute('ANALYZE')
        volume={t:await con.fetchval(f'SELECT count(*) FROM {t}') for t in ('users','dictionary_entries','lexemes','user_vocabulary','reading_passages','reading_questions','listening_tests','listening_questions','writing_submissions')}
        volume['database_bytes']=await con.fetchval('SELECT pg_database_size(current_database())')
        users=[]
        for n in range(1,1001):
            user={'id':uid('user',n),'name':f'Synthetic learner {n}','role':'student','locale':'en','auth_version':0}
            users.append({'n':n,'id':str(user['id']),'cookie':SESSION_COOKIE+'='+issue_token(user),'writing':str(uid('writing',n)),'reading':str(uid('reading',n))})
        result={'users':users,'volume':volume,'reading_questions':[fixture_id('reading-1-'+str(i)) for i in range(1,15)]}
        Path('/results/fixture.json').write_text(json.dumps(result))
        print(json.dumps({'seeded':True,'synthetic_only':True,'volume':volume}),flush=True)
    finally:await con.close()


if __name__=='__main__':asyncio.run(main())
