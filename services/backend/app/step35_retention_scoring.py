"""Literal Python port of retention/normalize.ts, measurement.ts, evaluator.ts (deterministic v5)."""
from __future__ import annotations
import re,unicodedata

VERSION='retention-deterministic-v5'
FUNCTION=set('a an the of in on at to for with by from as that which was were is are be been being am do does did has have had it its this these those there their and or so than then into about over after before when while also very more most such'.split())
NEGATIVE=['isn:is','wasn:was','weren:were','doesn:does','don:do','didn:did','hasn:has','haven:have','hadn:had','can:can','couldn:could','wouldn:would','shouldn:should','won:will','ain:is']
NUMBER={**dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(),range(20))),**dict(zip('twenty thirty forty fifty sixty seventy eighty ninety'.split(),range(20,100,10)))}
SCALE={'hundred':100,'thousand':1000,'million':1000000,'billion':1000000000}
BOUNDARY={',',';'}
CLAUSE={'.',',',';','but','however','though','although','yet','whereas'}
NEGATION={'not','never','no','without','none','neither','nor'}
FILLER={'not','never','no','but','and','so','however','what','all',',','actually','really','at'}
DISCLAIMER=['happen','true','correct','accurate','real','fact']

def normalize(raw):
    s=re.sub(r'(?<=\d)[,\u00a0\u202f\u2009](?=\d)','',raw or '')
    s=unicodedata.normalize('NFKC',s).lower().translate(str.maketrans({'\u2018':"'",'\u2019':"'",'\u02bc':"'",'`':"'",'´':"'"}))
    for replacement in NEGATIVE:
        name,full=replacement.split(':',1)
        s=re.sub(r'\b'+name+r"['\u2019]?t\b",' '+full+' not ',s)
    s=re.sub(r'\bcannot\b',' can not ',s)
    s=re.sub(r'[,;]',lambda m:' '+m[0]+' ',s)
    s=re.sub(r"[^\w'\s,;]",' ',s,flags=re.UNICODE)
    return ' '.join(s.split())

def tokens(raw):
    parts=normalize(raw).split();out=[];i=0
    while i<len(parts):
        t=parts[i];val=NUMBER.get(t,SCALE.get(t))
        if val is None:out.append(t);i+=1;continue
        i+=1
        while i<len(parts) and parts[i] in SCALE:
            val*=SCALE[parts[i]];i+=1
        out.append(str(val))
    return [t for t in out if t not in FUNCTION]

def units(raw):
    # Look behind/ahead preserve decimal points, split sentence punctuation.
    s=unicodedata.normalize('NFKC',raw or '')
    parts=re.split(r'(?:(?<!\d)\.|\.(?!\d)|[!?\n\r])+|;',s)
    return [tokens(x) for x in parts if x.strip()]

def levenshtein(a,b,limit):
    if a==b:return 0
    if abs(len(a)-len(b))>limit:return limit+1
    prev=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        cur=[i]+[0]*len(b);minimum=i
        for j,cb in enumerate(b,1):
            cur[j]=min(prev[j]+1,cur[j-1]+1,prev[j-1]+(ca!=cb));minimum=min(minimum,cur[j])
        if minimum>limit:return limit+1
        prev=cur
    return prev[-1]

def fuzzy(expected,actual):
    if expected==actual:return True
    if min(len(expected),len(actual))<5 or not any(c.isalpha() for c in expected) or not any(c.isalpha() for c in actual):return False
    limit=2 if len(expected)>=9 else 1
    return levenshtein(expected,actual,limit)<=limit

def at(hay,needle,i,approx):
    diff=0
    for expected in needle:
        while i<len(hay) and hay[i] in BOUNDARY:i+=1
        if i>=len(hay):return False
        if hay[i]!=expected:
            if not approx or diff or not fuzzy(expected,hay[i]):return False
            diff+=1
        i+=1
    return True

def find_all(hay,needle,approx=False):
    if not hay or not needle:return []
    starts=[i for i in range(len(hay)) if hay[i] not in BOUNDARY]
    exact=[i for i in starts if at(hay,needle,i,False)]
    if not approx:return exact
    return exact+[i for i in starts if i not in exact and at(hay,needle,i,True)]

def negated(unit,i):
    for x in range(i-1,max(-1,i-4),-1):
        t=unit[x]
        if t in CLAUSE:return False
        if t=='not' and x+1<len(unit) and unit[x+1]=='only':continue
        if t in NEGATION:return True
    return False

def phrase_match(unit,phrase):return any(not negated(unit,i) for i in find_all(unit,tokens(phrase)))
def group_match(group,unit):
    approx=group['kind']=='concept' and not group.get('critical',False)
    return any(any(not negated(unit,i) for i in find_all(unit,tokens(alt),approx)) for alt in group['anyOf'])

def critical_conflict(claim,unit):
    allowed=set()
    for group in claim['groups']:
        if group['kind'] in ('number','date') or group.get('critical',False):
            allowed.update(t for alt in group['anyOf'] for t in tokens(alt) if t.isdecimal())
    present=[t for t in unit if t.isdecimal()]
    return bool(allowed and present and not any(t in allowed for t in present))

def unit_score(claim,unit):
    accepted=any(phrase_match(unit,p) for p in claim.get('acceptedPhrases',[]))
    conflict=critical_conflict(claim,unit)
    matched=[];total=0
    for g in claim['groups']:
        if (accepted and not g.get('critical',False) and not conflict) or group_match(g,unit):
            matched.append(g['id']);total+=g['points']
    return min(total,claim['points']),matched

def relevant(claim,unit):
    if any(phrase_match(unit,p) for p in claim.get('acceptedPhrases',[])):return True
    matched=[g for g in claim['groups'] if group_match(g,unit)]
    if not matched:return False
    if any(g['kind'] not in ('number','date') for g in matched):return True
    all_tokens={t for g in claim['groups'] for alt in g['anyOf'] for t in tokens(alt)}
    return all(t in all_tokens or t.isdecimal() or t in FILLER or any(t.startswith(p) for p in DISCLAIMER) for t in unit)

def anaphoric(unit):return all(t in FILLER or any(t.startswith(p) for p in DISCLAIMER) for t in unit)
def disclaims(unit):
    for i,t in enumerate(unit):
        if t not in ('not','never','no') or (i+1<len(unit) and unit[i+1]=='only'):continue
        if any(any(unit[x].startswith(p) for p in DISCLAIMER) for x in range(i+1,min(len(unit),i+4))):return True
    return False

def claim_score(claim,evidence,sentences):
    denied=any(disclaims(s) and (relevant(claim,s) or i>0 and anaphoric(s) and relevant(claim,sentences[i-1])) for i,s in enumerate(sentences))
    contradiction=denied or any(phrase_match(s,p) for s in evidence for p in claim.get('rejectPhrases',[]))
    possible=claim['points'];best=(0,[])
    if not contradiction:
        for s in evidence:
            verdict=unit_score(claim,s)
            if verdict[0]>best[0]:best=verdict
    score=best[0];matched=set(best[1])
    return {'claimId':claim['id'],'claimLabel':claim['label'],'possiblePoints':possible,'awardedPoints':score,
      'status':'contradicted' if contradiction else 'captured' if score>=possible else 'partial' if score else 'missed',
      'matchedGroupIds':[g['id'] for g in claim['groups'] if g['id'] in matched],
      'missingGroupIds':[g['id'] for g in claim['groups'] if g['id'] not in matched],
      'missingCriticalGroupIds':[g['id'] for g in claim['groups'] if g.get('critical',False) and g['id'] not in matched]}

class StructureError(ValueError):pass

def validate_structure(value):
    if not isinstance(value,dict) or set(value)!={'schemaVersion','maxScore','claims'} or value.get('schemaVersion')!=1 or type(value.get('maxScore')) is not int or value['maxScore']!=100:raise StructureError('invalid root')
    claims=value['claims']
    if not isinstance(claims,list) or not 1<=len(claims)<=40:raise StructureError('claims')
    claim_ids=set();points=0;normalized=[]
    for claim in claims:
        if not isinstance(claim,dict) or set(claim)-{'id','label','points','scope','groups','acceptedPhrases','rejectPhrases'}:raise StructureError('claim fields')
        cid=claim.get('id');label=claim.get('label');cp=claim.get('points');gs=claim.get('groups')
        if not isinstance(cid,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,60}',cid.strip()) or cid.strip() in claim_ids:raise StructureError('claim id')
        claim_ids.add(cid.strip())
        if not isinstance(label,str) or not 3<=len(label.strip())<=300 or type(cp) is not int or not 1<=cp<=100 or claim.get('scope') not in ('sentence','answer') or not isinstance(gs,list) or not 1<=len(gs)<=20:raise StructureError('claim validation')
        n_groups=[];seen=set();gpoints=0
        for g in gs:
            if not isinstance(g,dict) or set(g)-{'id','points','kind','anyOf','critical'}:raise StructureError('group fields')
            gid=g.get('id');v=g.get('points');kind=g.get('kind');anyof=g.get('anyOf')
            if not isinstance(gid,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,60}',gid.strip()) or gid.strip() in seen:raise StructureError('group id')
            seen.add(gid.strip())
            if type(v) is not int or not 1<=v<=100 or kind not in ('concept','entity','number','date') or not isinstance(anyof,list) or not 1<=len(anyof)<=30 or any(not isinstance(a,str) or not 1<=len(a.strip())<=180 for a in anyof) or ('critical' in g and type(g['critical']) is not bool):raise StructureError('group validation')
            n_groups.append({'id':gid.strip(),'points':v,'kind':kind,'anyOf':[a.strip() for a in anyof],'critical':g.get('critical',False)});gpoints+=v
        if gpoints!=cp:raise StructureError('group point total')
        phrases={}
        for key,maximum in [('acceptedPhrases',32),('rejectPhrases',20)]:
            p=claim.get(key,[])
            if not isinstance(p,list) or len(p)>maximum or any(not isinstance(x,str) or not 2<=len(x.strip())<=220 for x in p):raise StructureError('phrases')
            phrases[key]=[x.strip() for x in p]
        normalized.append({'id':cid.strip(),'label':label.strip(),'points':cp,'scope':claim['scope'],'groups':n_groups,**phrases});points+=cp
    if points!=100:raise StructureError('claim total')
    return {'schemaVersion':1,'maxScore':100,'claims':normalized}

def evaluate_recall(raw,structure):
    s=validate_structure(structure)
    parts=[x.strip() for x in re.split(r',(?!\d)|[;\n]',raw) if x.strip()]
    rubric={' '.join(tokens(term)) for claim in s['claims'] for g in claim['groups'] for term in g['anyOf']}
    isolated=len(parts)>=2 and all(' '.join(tokens(part)) in rubric for part in parts)
    sentence=[tokens(x) for x in parts] if isolated else units(raw)
    whole=[item for i,unit in enumerate(sentence) for item in ((['.'] if i else [])+unit)]
    claims=[claim_score(c,sentence if c['scope']=='sentence' or isolated else [whole],sentence) for c in s['claims']]
    score=sum(c['awardedPoints'] for c in claims)
    totals={status:sum(c['status']==status for c in claims) for status in ('captured','partial','missed','contradicted')}
    totals.update(matchedGroups=sum(len(c['matchedGroupIds']) for c in claims),totalGroups=sum(len(c['groups']) for c in s['claims']),mainIdeasRemembered=totals['captured'],mainIdeasPossible=len(claims))
    return score,{'schemaVersion':1,'evaluatorVersion':VERSION,'maxScore':100,'score':score,'totals':totals,'claims':claims}
