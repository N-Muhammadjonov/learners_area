"""RIWI Writing pattern evaluator ported from coach/providers/riwi/writing.ts.
No semantic relevance or audio claims; band estimates are based on observable text.
"""
from __future__ import annotations
import re,math
from .step31_riwi_text import analyse,LINK

def _band(value):return math.floor(max(4,min(9,value))*2+.5)/2

def _confidence(words,sentences,task):
    return math.floor(min(.85 if task=='task1' else .8,.35+.3*min(1,words/120)+.15*min(1,sentences/8))*100+.5)/100

def wval(taskType,prompt,content,targetWordCount):
    a=analyse(content);wc=a['wordCount'];paragraphs=[p.strip() for p in re.split(r'\n{2,}',content) if p.strip()]
    lower=content.lower();strengths=[];weaknesses=[];actions=[];recommended=[]
    issues=[{**i,'excerpt':i.get('excerpt') or None} for i in (a['issues']+a['punctuationIssues'])[:8]]
    ratio=wc/targetWordCount if targetWordCount>0 else 1
    task=6.
    if ratio<.6:
        task-=2;weaknesses.append(f'Well under the target length: {wc} words against a {targetWordCount}-word task.')
        actions.append(f'Write at least {targetWordCount} words for this task type before submitting again.')
        issues.append({'category':'WRITING_LENGTH','message':f'Under length: {wc}/{targetWordCount} words.','severity':'high','suggestion':'An under-length answer cannot reach the higher bands regardless of quality.'})
    elif ratio<.9:
        task-=1;weaknesses.append(f'Slightly under the target length ({wc}/{targetWordCount} words).')
        issues.append({'category':'WRITING_LENGTH','message':f'Slightly under length: {wc}/{targetWordCount} words.','severity':'medium','suggestion':'Add one more developed example or explanation.'})
    elif wc>=targetWordCount:task+=.5;strengths.append(f'Meets the word target ({wc} words).')
    if taskType=='task2':
        if len(paragraphs)<4:
            task-=.5;weaknesses.append(f'Only {len(paragraphs)} paragraph(s); a Task 2 answer usually needs an introduction, two body paragraphs and a conclusion.')
            issues.append({'category':'WRITING_TASK_RESPONSE','message':f'{len(paragraphs)} paragraph(s) detected (blank-line separated).','severity':'medium','suggestion':'Separate the introduction, two body paragraphs and the conclusion with blank lines.'})
        else:strengths.append('Clear four-part paragraph structure.')
        first=paragraphs[0].lower() if paragraphs else ''
        markers=('i believe','i think','in my opinion','i agree','i disagree','this essay','it will be argued','i would argue','personally')
        if not any(m in first for m in markers):
            task-=.5;weaknesses.append('No clear position detected in the introduction.')
            issues.append({'category':'WRITING_TASK_RESPONSE','message':'The opening paragraph does not state a position.','severity':'high','suggestion':'State your view explicitly, e.g. "I believe that …" or "This essay will argue that …".'})
            actions.append('Rewrite the introduction so the examiner can find your position in the first two sentences.')
        else:strengths.append('The introduction states a position.')
    else:
        if not any(m in lower for m in ('overall','in general','in summary','generally speaking','it is clear that','it can be seen that','in conclusion')):
            task-=1;weaknesses.append('No overview sentence detected — Task 1 requires an overall summary of the main trends.')
            issues.append({'category':'WRITING_TASK_RESPONSE','message':'No overview marker found ("Overall, …").','severity':'high','suggestion':'Add an overview paragraph naming the main trends without quoting every figure.'})
            actions.append('Write a two-sentence overview that names the biggest differences and the general trend.')
        else:strengths.append('Includes an overview of the main trends.')
        if not re.search(r'\d|\b(percent|percentage|proportion|twice|half|third|quarter|increase|decrease|rise|fall|higher|lower|double)\b',content,re.I):
            task-=.5;weaknesses.append('Few or no figures/comparative language detected — Task 1 is scored on selecting and reporting key features.')
            issues.append({'category':'WRITING_TASK_RESPONSE','message':'No figures or comparative language detected.','severity':'medium','suggestion':'Support each claim with a figure or an explicit comparison.'})
        if re.search(r'^\s*[^.]*\b(in this graph|in this chart|i can see|the graph shows us)\b',content,re.I):
            weaknesses.append('Wording such as "in this graph" or "I can see" is not needed — describe the data directly.')
    linker=[len(re.findall(r'\b'+re.escape(m)+r'\b',lower)) for m in LINK];linkocc=sum(linker);linkunique=sum(bool(n) for n in linker);per100=linkocc/wc*100 if wc else 0
    coherence=6.
    if linkocc==0:
        coherence-=1.5;weaknesses.append('No cohesive devices detected — the reader has to infer how the ideas connect.')
        actions.append('Add linking phrases such as "however", "in contrast" and "as a result" where the logic turns.')
        recommended.append({'kind':'grammar','label':'Cohesive devices','href':'/app/grammar','reason':'Practise the linking patterns you are missing.'})
    else:
        coherence+=min(1,linkunique*.2)
        if linkunique>=3:strengths.append(f'Uses {linkunique} different cohesive devices.')
    if per100>8:
        coherence-=.5;weaknesses.append('Cohesive devices are used very densely — over-linking reads as mechanical.')
        issues.append({'category':'WRITING_COHESION','message':f'{per100:.1f} linking words per 100 words.','severity':'medium','suggestion':'Keep the connectors that mark a real turn in the argument and cut the rest.'})
    if taskType=='task2' and len(paragraphs)>=4 and wc>0 and len(paragraphs[1:-1])>=2:
        if any(len(p.split())<35 for p in paragraphs[1:-1]):
            coherence-=.5;weaknesses.append('At least one body paragraph is very short — the idea is stated but not developed.')
        else:strengths.append('Body paragraphs are developed rather than listed.')
    lexical=5.5+a['typeTokenRatioOnContentWords']*4
    if a['topRepeatedContentWords'] and a['topRepeatedContentWords'][0]['count']>=6:
        lexical-=.5;worst=a['topRepeatedContentWords'][0];weaknesses.append(f'Heavy repetition of "{worst["word"]}" ({worst["count"]} times).')
        issues.append({'category':'WRITING_LEXICAL_REPETITION','message':f'"{worst["word"]}" appears {worst["count"]} times.','severity':'medium','suggestion':'Build a small synonym set for this word and alternate.'})
        recommended.append({'kind':'vocabulary','label':f'Replace repeated "{worst["word"]}"','href':'/app/vocabulary','reason':'Lexical repetition is the fastest band-limited quick win at this stage.'})
    if a['typeTokenRatioOnContentWords']>=.6 and wc>=120:lexical+=.5;strengths.append('Good variety among content words.')
    words=a['words'];bigramcounts={}
    for i in range(max(0,len(words)-1)):
        key=words[i]+' '+words[i+1];bigramcounts[key]=bigramcounts.get(key,0)+1
    repeated=[(k,n) for k,n in bigramcounts.items() if n>=3]
    if repeated:
        lexical-=.25;weaknesses.append(f'Repeated phrasing detected: "{sorted(repeated,key=lambda x:-x[1])[0][0]}".')
    grammar=6.;high=sum(i['severity']=='high' for i in a['issues'])
    if high:
        grammar-=min(1.5,high*.5);weaknesses.append(f'{high} clear grammatical error pattern(s) detected (agreement, tense or form).')
    avg=a['avgSentenceWords'];ss=a['sentenceCount']
    if 0<avg<8:
        grammar-=.5;weaknesses.append('Sentences are short and simple on average — few complex structures are attempted.')
        actions.append('Combine two related short sentences into one complex sentence using although / because / while.')
    elif avg>=12:grammar+=.5;strengths.append('Sentences are long enough to attempt complex structures.')
    lengths=[len(s.split()) for s in re.split(r'(?<=[.!?])\s+',content) if s.strip()];variance=sum((n-avg)**2 for n in lengths)/len(lengths) if lengths else 0
    if 0<math.sqrt(variance)<3 and ss>=4:grammar-=.5;weaknesses.append('Sentence lengths are uniform — vary short and long sentences for emphasis.')
    if any(n>35 for n in lengths):grammar-=.25;weaknesses.append('At least one sentence runs past 35 words — check for a comma splice or a lost main verb.')
    criteria=[{'key':'task_achievement' if taskType=='task1' else 'task_response','label':'Task Achievement' if taskType=='task1' else 'Task Response','band':_band(task),'note':f'{wc} words against a {targetWordCount}-word target.'},
              {'key':'coherence','label':'Coherence and Cohesion','band':_band(coherence),'note':f'{len(paragraphs)} paragraph(s), {linkunique} distinct cohesive devices.'},
              {'key':'lexical','label':'Lexical Resource','band':_band(lexical),'note':f'Content-word variety {a["typeTokenRatioOnContentWords"]*100:.0f}%.'},
              {'key':'grammar','label':'Grammatical Range and Accuracy','band':_band(grammar),'note':f'Average sentence {avg:.1f} words; {len(a["issues"])} pattern-level issue(s).'}]
    if not strengths:strengths.append('You produced a full attempt under task conditions — that repetition is what moves the real score.')
    if not weaknesses:weaknesses.append('No structural problems detected by the pattern checks RIWI runs.')
    if not actions:actions.append('Rewrite this answer once, fixing the two weakest criteria above, then compare the two drafts.')
    if not prompt:actions.append('Attach the task prompt next time — without it, relevance cannot be checked at all.')
    return {'overallEstimate':_band(sum(c['band'] for c in criteria)/4),'confidence':_confidence(wc,ss,taskType),'criteria':criteria,
        'strengths':strengths[:6],'weaknesses':weaknesses[:6],'issues':issues[:12], 'nextActions':actions[:5],
        'recommendedExercises':recommended[:4],'verdict':None}
