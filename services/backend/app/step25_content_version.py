"""Content version hashing and immutable revision pinning from content/versions.ts.
Core helper shared by imported/authored content and Speaking attachment route.
"""
import hashlib,json

# ECMAScript whitespace set for String.prototype.trim (includes BOM but not U+001C).
JS_SPACE = " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

def _utf16_key(s):
    return s.encode("utf-16-be", errors="surrogatepass")

def _array_index(s):
    # JS Object.entries()/JSON.stringify enumerate canonical integer-index
    # properties before other string properties, regardless of insertion order.
    if not isinstance(s,str) or not s.isascii() or not s.isdecimal():return None
    if len(s)>1 and s[0]=="0":return None
    n=int(s)
    return n if n<4294967295 else None

def _js_key_order(keys):
    return sorted(keys, key=lambda k:(0,_array_index(k)) if _array_index(k) is not None else (1,_utf16_key(k)))

ANSWERS={'key','answer','keys','correctAnswer','correctOption','answers','accepted','pair'}
def canonical(v):
    if isinstance(v,str):return v.strip(JS_SPACE)
    if isinstance(v,list):return [canonical(x) for x in v]
    if isinstance(v,dict):return {k:canonical(v[k]) for k in _js_key_order(v)}
    return v

def encoded(v):return json.dumps(canonical(v),ensure_ascii=False,separators=(',',':'))
def digest(v):return hashlib.sha256(encoded(v).encode()).hexdigest()

def collect_keys(v,depth=0):
    if depth>8:return []
    if isinstance(v,list):return sum((collect_keys(x,depth+1) for x in v),[])
    if not isinstance(v,dict):return []
    found=[]
    for key,value in v.items():
        found.append(json.dumps(value,ensure_ascii=False,separators=(',',':'))) if key in ANSWERS else found.extend(collect_keys(value,depth+1))
        if len(found)>20000:break
    return found

def version_hashes(module,typ,content):
    keys=digest({'keys':sorted(collect_keys(content))})
    # Exact semanticProjection from src/lib/content/versions.ts: metadata is
    # excluded unless this is an unknown payload (the conservative fallback).
    fields = None
    if module == 'listening' and typ == 'full_test':
        fields = ('questions','sections','audio','image','imagePath','mapDiagram','keyword1','keyword2','collection')
    elif module == 'reading' and typ in ('general_set','passage','full_test'):
        fields = ('passages','questions','timeLimitMinutes')
    elif module == 'writing' and typ in ('task1','task2'):
        fields = ('prompt','instructions','taskType','visual','wordMinimum','recommendedMinutes','dataPoints')
    elif module == 'speaking' and typ == 'material':
        fields = ('category','primaryType','primaryUrl','hasPrimary','primaryOriginalName','primaryMimeType','primarySize','blocks','description')
    elif module == 'speaking':
        fields = ('part','promptText','cueCard','followUps','prepSeconds','answerSeconds','questions')
    elif module == 'grammar':
        fields = ('promptText','options','correctOption','targetStructures','translatePromptUz')
    elif module == 'vocabulary':
        fields = ('words','items','text')
    elif module in ('ted','media'):
        fields = ('mediaKind','provider','videoId','durationSeconds','beforeYouWatch','notes','transcript',
                  'transcriptText','transcriptLines','questions','vocabulary','timeline')
    semantic = ({k: content[k] for k in fields if k in content} if isinstance(content,dict) else {}) if fields else (content if content is not None else {})
    return {'content_hash':digest({'module':module,'contentType':typ,'content':content}),
            'semantic_hash':digest({'module':module,'contentType':typ,'semester':'assessment-semantics/v1','content':semantic}),
            'answer_key_hash':keys}

async def pin(con,module,typ,ref,title,content,actor,pub='draft',track='unspecified',target_type=None,target_id=None,provenance=None,force=False):
    before=await con.fetchrow('''SELECT * FROM content_versions WHERE module=$1 AND content_type=$2 AND source_ref=$3 ORDER BY version_no DESC LIMIT 1 FOR UPDATE''',module,typ,ref)
    hashes=version_hashes(module,typ,content)
    semantic_moved=not before or before['semantic_hash']!=hashes['semantic_hash']
    if before and not force and not semantic_moved:
        await con.execute('UPDATE content_versions SET title=$2,track=$3,publication_state=$4 WHERE id=$1',before['id'],title,track,pub)
        return str(before['id']),before['version_no'],False
    if before and before['status']=='published' and pub=='published':
        await con.execute("UPDATE content_versions SET status='superseded',superseded_at=NOW() WHERE id=$1",before['id'])
    kind='created' if not before else 'answer_key' if before['answer_key_hash']!=hashes['answer_key_hash'] else 'semantic'
    next_no=(before['version_no'] if before else 0)+1
    row=await con.fetchrow('''INSERT INTO content_versions(module,content_type,source_ref,version_no,status,title,track,content_hash,semantic_hash,
      answer_key_hash,content_snapshot,publication_state,target_type,target_id,created_by_user_id,change_kind,provenance,published_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17::jsonb,
      CASE WHEN $12='published' THEN NOW() ELSE NULL END) RETURNING id''',module,typ,ref,next_no,'published' if pub=='published' else 'draft',title,track,
      hashes['content_hash'],hashes['semantic_hash'],hashes['answer_key_hash'],encoded(content),pub,target_type,target_id,actor,kind,
      encoded(provenance) if provenance else None)
    return str(row['id']),next_no,True
