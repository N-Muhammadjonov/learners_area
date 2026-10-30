"""Port of RIWI's TypeScript text-pattern diagnostics, without external services.
Source: src/lib/services/coach/providers/riwi/text.ts and writing-evaluation/heuristics.ts.
"""
from __future__ import annotations
import re,math
from collections import Counter

STOP=set('the a an and or but if of to in on at for with as is are was were be been being am do does did has have had it its this that these those i you he she we they my your his her our their there here so than then also not no will would can could should may might must from by about into over more most some any all one two many much'.split())
A_CONSONANT=set('university universities user users unique unit units union united uniform unicorn usual usually useful used using european one once uk us usa un eu uturn'.split())
AN_VOWEL=set('hour hours honest honestly honour honor heir x mp mba ngo sms fbi led lcd hiv ipod apple'.split())
LINK='however|moreover|therefore|furthermore|consequently|in contrast|on the other hand|for example|for instance|in conclusion|to conclude|to sum up|in addition|as a result|nevertheless|although|whereas|despite|firstly|secondly|thirdly|finally|overall|in general|because|while'.split('|')
DISCOURSE='first of all|firstly|secondly|to begin with|on the other hand|in addition|for example|for instance|as a result|in conclusion|to sum up|overall|in general|however|therefore|because|so that|such as'.split('|')
FILLERS='um uh erm er ah hmm mmm eh'.split()
VAGUE='you know|i mean|kind of|sort of|like i said|basically|actually'.split('|')
PREP=[('discuss about','discuss','discuss takes no preposition'),('depend of','depend on','the verb depend takes on'),('depends of','depends on','the verb depend takes on'),('married with','married to','people are married to someone'),('arrive to','arrive at','arrive takes at or in'),('interested for','interested in','interested in something'),('afraid from','afraid of','afraid of something'),('consist in','consist of','consist of parts'),('explain about','explain','explain takes a direct object'),('good in ','good at ','good at a skill'),('in the last years','in recent years','in recent years')]
SVA=[(r'\b(he|she|it)\s+(have|do|were|are)\b','third-person singular subject needs has / does / was / is'),(r'\b(they|we|you)\s+(has|does|is|was)\b','plural subject needs have / do / are / were'),(r'\bI\s+(has|is|are|were|does)\b','I takes have / am / was / do'),(r'\b(each|every|everyone|everybody|nobody|somebody|someone|either|neither)\s+(are|were|have|do)\b','singular indefinite subject takes a singular verb'),(r'\bthere\s+(is|was)\s+(many|several|two|three|four|five|both|few|numerous)\b','a plural quantity needs there are / there were')]
TENSE=[(r"\b(did not|didn't)\s+(\w+ed|went|saw|took|made|wrote|came|gave)\b",'after did, use the base form'),(r"\b(does not|doesn't|do not|don't)\s+(\w+s)\b",'after do / does, use the base form'),(r'\bwill\s+(\w+ed|went|saw|took|made)\b','after will, use the base form'),(r'\b(have|has)\s+(go|see|take|write|be|do|make)\b','after have / has, use the past participle'),(r'\bhad\s+(go|see|take|write|be|do|make)\b','after had, use the past participle'),(r'\b(was|were)\s+(go|see|take|write|make|be)\b','after was / were, use the -ing form or a participle'),(r'\bsince\s+\d{4}\s+.*\b(is|are|was)\b','with since, the present perfect fits better than a simple tense')]
FINITE=re.compile(r'(\b(?:am|is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|can|could|should|must|may|might)\b|\w+(?:ed|ing)\b|\w+s\b)',re.I)

def count(text):return len(text.strip().split()) if text.strip() else 0
def sentences(text):return [x.strip() for x in re.split(r'(?<=[.!?])\s+',text) if x.strip()]
def tokens(text):return [s for s in re.sub(r"[^a-z0-9'\s]",' ',text.lower()).split() if s]
def excerpt(text,cap=200):
    val=' '.join(text.strip().split())
    return val[:cap-1]+'…' if len(val)>cap else val

def containing(text,index):
    cursor=0
    for s in sentences(text):
        pos=text.find(s,cursor)
        if pos<0:continue
        cursor=pos+len(s)
        if pos<=index<cursor:return s
    return ''
def issue(cat,msg,seg,suggestion,severity,cap=200):return {'category':cat,'message':msg,'excerpt':excerpt(seg,cap),'suggestion':suggestion,'severity':severity}

def diagnostics(text):
    article=[]
    for m in re.finditer(r"\ba\s+([a-z][a-z'-]*)",text,re.I):
        w=m.group(1).lower()
        if w not in A_CONSONANT and w[0] in 'aeiou':article.append(issue('GRAMMAR_ARTICLE',f'"a" before a vowel sound: "{m.group(0)}"',containing(text,m.start()),f'Use "an {w}".','medium'))
    for m in re.finditer(r"\ban\s+([a-z][a-z'-]*)",text,re.I):
        w=m.group(1).lower()
        if w not in AN_VOWEL and w[0] not in 'aeiou' and not re.fullmatch(r'[A-Z]{1,4}',m.group(1)):
            article.append(issue('GRAMMAR_ARTICLE',f'"an" before a consonant sound: "{m.group(0)}"',containing(text,m.start()),f'Use "a {w}".','medium'))
    sva=[]
    for pat,description in SVA:
        for m in re.finditer(pat,text,re.I):sva.append(issue('GRAMMAR_SVA',f'Subject–verb agreement: "{m.group(0).strip()}"',containing(text,m.start()),description,'high'))
    tense=[]
    for pat,description in TENSE:
        for m in re.finditer(pat,text,re.I):tense.append(issue('GRAMMAR_TENSE',f'Tense pattern: "{m.group(0).strip()}"',containing(text,m.start()),description,'high'))
    prep=[];lower=text.lower()
    for wrong,right,description in PREP:
        i=lower.find(wrong)
        if i>=0:prep.append(issue('GRAMMAR_PREPOSITION',f'Preposition pattern: "{wrong.strip()}"',containing(text,i),f'{description} — try "{right.strip()}".','medium',160))
    frag=[]
    for sentence in sentences(text):
        if 0<len(tokens(sentence))<=5 and not FINITE.search(sentence):frag.append(issue('GRAMMAR_FRAGMENT','Possible sentence fragment — no finite verb detected.',sentence,'Give the idea a subject and a finite verb, or join it to the previous sentence.','medium',120))
    punct=[]
    unter=[s for s in sentences(text) if not re.search(r'[.!?]"?\s*$',s.strip())]
    if unter:punct.append(issue('GRAMMAR_PUNCTUATION',f'{len(unter)} sentence(s) do not end with a full stop, question mark or exclamation mark.',unter[0],'Terminate every sentence.','low',120))
    m=re.search(r'[a-z],[^ ]',text,re.I)
    if m:punct.append(issue('GRAMMAR_PUNCTUATION','Comma without a following space.',m.group(),'Put a space after every comma.','low',60))
    m=re.search(r'(!{2,}|\?{2,}|!\?|\?!)',text)
    if m:punct.append(issue('GRAMMAR_PUNCTUATION','Repeated terminal punctuation.',m.group(),'Academic writing uses a single terminal mark.','low',20))
    return (sva[:6]+tense[:6]+article[:6]+prep[:5]+frag[:5],punct[:3])

def analyse(text):
    words=tokens(text);ss=sentences(text);content=[w for w in words if w not in STOP and len(w)>2]
    widths=[count(s) for s in ss];avg=sum(widths)/len(widths) if widths else 0
    counts=Counter(content);repeats=sorted(({'word':w,'count':n} for w,n in counts.items() if n>=3),key=lambda x:-x['count'])[:5]
    linkers=[{'word':p,'count':len(re.findall(r'\b'+re.escape(p)+r'\b',text.lower()))} for p in LINK]
    linkers=[l for l in linkers if l['count']]
    hesitation=sum(len(re.findall(r'\b'+re.escape(f)+r'\b',text.lower())) for f in FILLERS)
    bigrams=Counter(words[i]+' '+words[i+1] for i in range(max(0,len(words)-2)) if words[i] not in STOP)
    detected,punc=diagnostics(text)
    return {'lower':text.lower(),'wordCount':count(text),'words':words,'contentWords':content,'sentenceCount':len(ss),
        'shortSentences':[s for s in ss if 0<count(s)<6][:5], 'avgSentenceWords':avg,
        'topRepeatedContentWords':repeats, 'typeTokenRatioOnContentWords':len(set(content))/len(content) if content else 0,
        'discourseMarkers':[x for x in DISCOURSE if x in text.lower()], 'hesitationCount':hesitation,
        'hesitationRate':hesitation/count(text)*100 if count(text) else 0,
        'vaguePhraseCount':sum(len(re.findall(r'\b'+re.escape(p)+r'\b',text.lower())) for p in VAGUE),
        'issues':detected,'punctuationIssues':punc}

def complete(sentence):
    s=sentence.strip()
    return count(s)>=3 and re.match(r'^["\'(]?[A-Z]',s) is not None and re.search(r'[.!?]["\')]?\s*$',s) is not None and FINITE.search(s) is not None

def contains_form(sentence,target):
    base=target.lower().strip()
    if not base:return False
    stem=base[:-1] if len(base)>4 and base.endswith('e') else base
    return re.search(r'\b'+re.escape(stem)+r'(s|es|ed|ing|d|ies|ment|tion)?\b',sentence,re.I) is not None

def verdict(issues,critical):return 'needs_correction' if critical or any(i['severity']=='high' for i in issues) else 'mostly_correct' if issues else 'correct'
