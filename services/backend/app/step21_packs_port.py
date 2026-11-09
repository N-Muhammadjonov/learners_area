"""Learner batch add of canonical Vocabulary topic packs."""
from __future__ import annotations
import json
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .step21_vocab_batch import add_batch
router=APIRouter()

@router.post('/api/vocabulary/packs')
async def add_pack(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    b=await core.payload(req)
    if not isinstance(b,dict) or not isinstance(b.get('packId'),str) or len(b['packId'])>60:
        return core.j({'error':'unknown_pack'},400)
    pack_id=b['packId'];pool=await core.pool()
    async with pool.acquire() as con:
        published=await con.fetchrow('''SELECT id,slug,label_en FROM vocabulary_topic_packs
            WHERE publication_state='published' AND slug=$1''',pack_id)
        if published:
            words=await con.fetch('''SELECT l.id,l.term,l.part_of_speech,l.definition_en,l.translation_uz,l.example_sentence,l.collocations
                  FROM vocabulary_topic_pack_words m JOIN lexemes l ON l.id=m.lexeme_id WHERE m.pack_id=$1 ORDER BY m.position''',published['id'])
            folder_name=published['label_en']
            pack_words=[{'canonicalLexemeId':str(r['id']),'term':r['term'],'partOfSpeech':r['part_of_speech'] or '',
                'definitionEn':r['definition_en'],'translationUz':r['translation_uz'] or '',
                'exampleSentence':r['example_sentence'] or '', 'collocations':r['collocations'],'authored':True} for r in words]
        else:
            has_any=await con.fetchval("SELECT id FROM vocabulary_topic_packs WHERE publication_state='published' LIMIT 1")
            # Only the new Art pack can fall back while older DB packs are published.
            # Existing published pack definitions remain canonical.
            if has_any and pack_id != 'art':return core.j({'error':'unknown_pack'},400)
            built=json.loads(Path(__file__).with_name('vocabulary_builtin_packs.json').read_text())
            pack=next((p for p in built if p['id']==pack_id),None)
            if not pack:return core.j({'error':'unknown_pack'},400)
            folder_name=pack['label']['en']
            pack_words=[{'term':w['term'],'partOfSpeech':w.get('partOfSpeech',''),'definitionEn':w['definitionEn'],
                'translationUz':w.get('translationUz',''),'exampleSentence':w.get('example',''),
                'collocations':w.get('collocations'),'authored':True} for w in pack['words']]
        async with con.transaction():
            # Match the batch engine's user lock before creating a child folder.
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',u['id'])
            folder_id=await con.fetchval('''INSERT INTO vocab_folders(user_id,name) VALUES($1,$2)
                ON CONFLICT(user_id,name) DO UPDATE SET name=vocab_folders.name RETURNING id''',u['id'],folder_name)
            r=await add_batch(con,u['id'],pack_words,topic_pack=pack_id,source_type='topic_pack',folder_id=folder_id)
            if r['ok']:
                # Re-adding an unfiled pack restores its folder, never moves words
                # from another chosen folder and never resets learning progress.
                await con.execute('''UPDATE user_vocabulary SET folder_id=$3
                    WHERE user_id=$1 AND topic_pack=$2 AND folder_id IS NULL''',u['id'],pack_id,folder_id)
    if not r['ok']:return core.j({'error':r['error']},400)
    return core.j({'ok':True,'added':r['added'],'duplicates':r['duplicates'],'points':r['points']},headers={'Cache-Control':'private, no-store'})

@router.delete('/api/vocabulary/packs/{pack_id}')
async def remove_pack(req:Request,pack_id:str):
    """Remove the learner's imported pack words and any now-empty owned folders."""
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not pack_id or len(pack_id)>60:return core.j({'error':'unknown_pack'},400)
    pool=await core.pool()
    async with pool.acquire() as con:
        async with con.transaction():
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',u['id'])
            folders=await con.fetch('''SELECT DISTINCT folder_id FROM user_vocabulary
                WHERE user_id=$1 AND topic_pack=$2 AND folder_id IS NOT NULL''',u['id'],pack_id)
            removed=await con.execute('''DELETE FROM user_vocabulary
                WHERE user_id=$1 AND topic_pack=$2''',u['id'],pack_id)
            # Only empty owned folders are removed; unrelated words keep their folder.
            for row in folders:
                await con.execute('''DELETE FROM vocab_folders f WHERE f.id=$1 AND f.user_id=$2
                    AND NOT EXISTS(SELECT 1 FROM user_vocabulary v WHERE v.folder_id=f.id)''',row['folder_id'],u['id'])
    return core.j({'ok':True,'deletedWords':int(removed.rsplit(' ',1)[-1])},headers={'Cache-Control':'private, no-store'})

def install():core.app.include_router(router)
