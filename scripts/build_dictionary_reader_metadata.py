"""Build small, hash-bound reader metadata from existing immutable entries and OEWN.

Usage: python scripts/build_dictionary_reader_metadata.py PREPARED OEWN_JSON_ZIP
No database, release or R2 object is written. Meaning text/IDs remain untouched.
"""
import gzip,hashlib,json,re,sys,zipfile
from pathlib import Path

def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def norm(s):return re.sub(r'\s+',' ',s.casefold()).strip()
def build(prepared,source,out):
    z=zipfile.ZipFile(source);synsets={};wordnet={}
    for file in z.namelist():
        if not file.endswith('.json'):continue
        data=json.loads(z.read(file))
        if file.startswith('entries-'):wordnet.update(data)
        else:synsets.update(data)
    wn_senses={}
    for lemma,poses in wordnet.items():
        for pos,record in poses.items():
            for s in record.get('sense',[]):
                wn_senses[s['id']]=(lemma,{norm(d) for d in synsets.get(s['synset'],{}).get('definition',[])})
    entries=[];plan=json.loads((prepared/'release-plan.json').read_text())
    for desc in plan['shards']:
        body=(prepared/'shards'/(desc['shard']+'.json.gz')).read_bytes()
        assert hashlib.sha256(body).hexdigest()==desc['sha256']
        entries.extend(json.loads(line) for line in gzip.decompress(body).splitlines() if line)
    assert len(entries)==plan['expected']['lexemes']
    targets={s['sense_id']:(e['display_lemma'],s['definition_en']) for e in entries for s in e['senses']}
    output={p:{} for p in '0123456789abcdef'};stats={'entries':len(entries),'sourceOrdered':0,'scopedAntonyms':0}
    levels={level:i for i,level in enumerate(('A1','A2','B1','B2','C1','C2'))}
    for e in entries:
        pos={'noun':'n','verb':'v','adjective':'a','s':'a','adverb':'r'}.get(e['part_of_speech'],e['part_of_speech'])
        senses=wordnet.get(e['display_lemma'],{}).get(pos,{}).get('sense',[])
        source_rows={}
        for i,s in enumerate(senses):
            for d in synsets.get(s['synset'],{}).get('definition',[]):source_rows.setdefault(norm(d),(i,s))
        has_source=any(norm(s['definition_en']) in source_rows for s in e['senses'])
        ordered=sorted(enumerate(e['senses']),key=lambda pair:(pair[1].get('sense_order',source_rows.get(norm(pair[1]['definition_en']),(999,))[0] if has_source else levels.get(pair[1].get('cefr'),999)),pair[0]))
        rows=[]
        for original_index,s in ordered:
            src=source_rows.get(norm(s['definition_en']));antonyms=[]
            if src:
                stats['sourceOrdered']+=1
                for target in src[1].get('antonym',[]):
                    info=wn_senses.get(target)
                    if not info:continue
                    for relation_index,rel in enumerate(e['relations']):
                        target_sense=targets.get(rel.get('target_sense_id'))
                        if rel['relation_type']=='antonym' and rel['display_lemma']==info[0] and target_sense and norm(target_sense[1]) in info[1]:
                            link=relation_index
                            if link not in antonyms:antonyms.append(link);stats['scopedAntonyms']+=1
            rows.append([original_index,antonyms])
        primary=ordered[0][1]
        preview=' / '.join(t['text'] for t in primary['translations'])
        # Explicit owner-requested learner label; canonical translations are retained.
        if e['display_lemma']=='happy' and primary['definition_en']=='enjoying or showing or marked by joy or pleasure':preview='xursand / baxtli'
        output[e['lexeme_id'][0]][e['lexeme_id']]=[digest({k:v for k,v in e.items() if k!='release_id'}),rows if len(rows)>1 or any(r[1] for r in rows) else [],preview,primary.get('cefr')]
    out.mkdir(parents=True,exist_ok=True);descriptors={}
    for prefix,data in output.items():
        body=gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=9,mtime=0)
        (out/(prefix+'.json.gz')).write_bytes(body);descriptors[prefix]={'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}
    manifest={'version':1,'sourceRelease':plan['release'],'wordnetSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'stats':stats,'shards':descriptors}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({**stats,'compressedBytes':sum(d['bytes'] for d in descriptors.values())}))
if __name__=='__main__':
    build(Path(sys.argv[1]),Path(sys.argv[2]),Path(__file__).resolve().parents[1]/'services/backend/assets/dictionary/reader')
