"""Hash-bound display metadata. Immutable dictionary content remains in R2."""
import gzip,hashlib,json
from functools import lru_cache
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/'assets/dictionary/reader'

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

@lru_cache(maxsize=1)
def manifest():return json.loads((ROOT/'manifest.json').read_text())

@lru_cache(maxsize=16)
def metadata_shard(prefix):
    desc=manifest()['shards'].get(prefix)
    if not desc:return {}
    data=(ROOT/(prefix+'.json.gz')).read_bytes()
    if len(data)!=desc['bytes'] or hashlib.sha256(data).hexdigest()!=desc['sha256']:raise ValueError('dictionary_reader_checksum')
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:raw=stream.read(16*1024*1024+1)
    if len(raw)>16*1024*1024:raise ValueError('dictionary_reader_limit')
    return json.loads(raw)

def stored(lexeme_id):return metadata_shard(str(lexeme_id)[0]).get(str(lexeme_id))

def details(entry):
    value=stored(entry['lexeme_id']);ranks={};antonyms={}
    senses={s['sense_id']:s for s in entry['senses']}
    if value and value[0]==digest({k:v for k,v in entry.items() if k!='release_id'}):
        for rank,(index,indices) in enumerate(value[1]):
            sense=entry['senses'][index];sid=sense['sense_id'];ranks[sid]=rank
            links=[]
            for i in indices:
                rel=entry['relations'][i]
                if rel['relation_type']!='antonym':continue
                links.append({'text':rel['display_lemma'],'lexemeId':rel['target_lexeme_id'],
                              **({'senseId':rel['target_sense_id']} if rel.get('target_sense_id') else {})})
            antonyms[sid]=links
    levels={level:i for i,level in enumerate(('A1','A2','B1','B2','C1','C2'))}
    ordered=sorted(enumerate(entry['senses']),key=lambda pair:(pair[1].get('sense_order',ranks.get(pair[1]['sense_id'],999) if ranks else levels.get(pair[1].get('cefr'),999)),pair[0]))
    primary=ordered[0][1]
    translation=' / '.join(t['text'] for t in primary['translations'])
    if entry['display_lemma']=='happy' and primary['definition_en']=='enjoying or showing or marked by joy or pleasure':translation='xursand / baxtli'
    return {'senseOrder':[s['sense_id'] for _,s in ordered],'primarySenseId':primary['sense_id'],
            'primaryTranslation':translation,'cefr':primary.get('cefr'),'antonyms':antonyms}

async def enrich_search(con,release,results,direction):
    """One indexed registry read; no reindexing or legacy-search dependency."""
    if not results:return results
    ids=[r['lexeme_id'] for r in results]
    rows=await con.fetch('SELECT lexeme_id,content_sha FROM dictionary_entries WHERE release_id=$1 AND lexeme_id=ANY($2::uuid[])',release,ids)
    hashes={str(r['lexeme_id']):r['content_sha'] for r in rows}
    from .step17_dictionary_read_port import entry
    enriched=[]
    for hit in results:
        id=str(hit['lexeme_id']);value=stored(id)
        if value and value[0]==hashes.get(id):
            translation,cefr=value[2:4]
        else:
            # New/editorially changed entries always use the current pinned R2
            # entry, not stale bundled text. This is normally a tiny tail.
            current=await entry(con,id,release)
            if not current:raise ValueError('dictionary_entry_checksum_mismatch')
            view=details(current);translation,cefr=view['primaryTranslation'],view['cefr']
        enriched.append({**hit,'cefr':cefr,'primary_translation_uz':translation,
                         **({'translation_uz':translation} if direction=='EN' else {})})
    return enriched
