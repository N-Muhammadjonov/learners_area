"""Python ports of RIWI Grammar, Vocabulary and Speaking evaluator algorithms.
These are deterministic text signals; pronunciation is explicitly unassessed.
"""
from __future__ import annotations
import math,re
from .step31_riwi_text import analyse,complete,contains_form,verdict

WRONG_USAGE=[('discuss about','discuss','discuss takes a direct object: discuss the issue'),('depend of','depend on','depend ON something'),('married with','married to','married TO someone'),('arrive to','arrive at','arrive AT / IN a place'),('interested for','interested in','interested IN something'),('good in','good at','good AT a skill'),('afraid from','afraid of','afraid OF something'),('explain about','explain','explain takes a direct object'),('suggest me','suggest to me','suggest something TO someone')]

def gval(promptText,studentAnswer,targetStructure=None,sampleAnswer=None):
    a=analyse(studentAnswer);sentence=studentAnswer.strip();issues=a['issues']+a['punctuationIssues']
    strengths=[];weaknesses=[];actions=[];iscomplete=complete(sentence)
    short=a['wordCount']<4;expects=a['wordCount']>6;critical=False
    if short:
        critical=True;weaknesses.append('The answer is too short to show the structure in use.');actions.append('Write one full sentence — a full sentence is what proves the structure is under control.')
    elif expects and not iscomplete:
        critical=True;weaknesses.append('The sentence looks incomplete (missing capital letter, finite verb or terminal punctuation).');actions.append('Check three things: capital letter, a finite verb, and a full stop at the end.')
    elif iscomplete:strengths.append('Complete sentence with a subject and a finite verb.')
    else:strengths.append('Phrase-level answer, which is accepted for this kind of item.')
    structure_tokens=[w for w in re.sub(r'[^a-z\s]',' ',promptText.lower()).split() if len(w)>2 and w in {'does','do','did','is','are','was','were','has','have','had','the','a','an','to','of','in','on','at','not','will','would'}]
    structure_present=not structure_tokens or any(contains_form(a['lower'],s) for s in structure_tokens)
    if not structure_present:
        critical=True;weaknesses.append('The expected structure does not appear in the answer.');actions.append('Rebuild the sentence around the structure shown in the explanation.')
    if sampleAnswer and not any(w in sampleAnswer.lower() for w in a['contentWords']) and structure_present:
        weaknesses.append('Your wording shares almost no vocabulary with the sample answer — that is allowed, but it makes the structure harder to verify automatically.')
    meaningful=[] if short or expects and not iscomplete else issues
    v=verdict(meaningful,critical)
    limiting=['Target structure present in the produced sentence.',f'{a["wordCount"]} words, {a["sentenceCount"]} sentence(s).']
    if expects and not iscomplete and not short:limiting.append('Completeness check failed.')
    labels={'correct':'Correct','mostly_correct':'Mostly correct','needs_correction':'Needs correction'}
    criteria=[{'key':'verdict','label':labels[v],'band':None,'note':' '.join(limiting)},
              {'key':'sentence_completeness','label':'Sentence completeness','band':None,
               'note':'Subject and finite verb present.' if iscomplete else 'Could not confirm a subject + finite verb.' if expects else 'Short answer: judged on the target structure only.'},
              {'key':'target_structure','label':f'Target: {targetStructure}' if targetStructure else 'Target structure','band':None,
               'note':'The expected structure appears in your sentence.' if structure_present else 'The expected structure was not found.'}]
    if issues:weaknesses.extend(i['message'] for i in issues[:4])
    return {'overallEstimate':None,'confidence':min(.8,.4+a['wordCount']*.02) if v=='correct' else min(.85,.5+a['wordCount']*.02),
            'criteria':criteria,'strengths':strengths[:4],'weaknesses':weaknesses[:5],
            'issues':[{**i,'excerpt':i.get('excerpt') or None} for i in issues[:8]],
            'nextActions':actions[:4] if actions else ['Use the structure again in a sentence about your own life — that is what moves it into active use.'],
            'recommendedExercises':[{'kind':'grammar','label':'Another item on this topic','href':'/app/grammar','reason':'Same structure, different content, immediately after the correction.'}],
            'verdict':v}

def vval(targetWord,definition,studentSentence):
    sentence=studentSentence.strip();a=analyse(sentence);strengths=[];weaknesses=[];actions=[];issues=[]
    used=contains_form(sentence,targetWord);exact=targetWord.lower().strip() in sentence.lower();iscomplete=complete(sentence);short=a['wordCount']<4;critical=False
    if not used:
        critical=True;weaknesses.append(f'"{targetWord}" does not appear in the sentence.')
        issues.append({'category':'VOCAB_NOT_USED','message':'Target word missing.','severity':'high','suggestion':f'Write a new sentence that contains "{targetWord}" with a real meaning.'})
        actions.append(f'Re-read the definition ({definition}) and produce one sentence of your own.')
    elif short:
        critical=True;weaknesses.append('The sentence is too short to show the word in use.');actions.append('One full sentence with a subject, a verb and a reason is enough for the word to count as used.')
    elif not iscomplete:
        critical=True;weaknesses.append('The word appears, but not inside a complete sentence.')
        issues.append({'category':'VOCAB_WRONG_FORM','message':'Incomplete sentence around the target word.','severity':'medium','suggestion':'Add a finite verb and finish the sentence with a full stop.'})
    else:strengths.append(f'"{targetWord}" is used inside a complete sentence.')
    if used and not exact:strengths.append('Used in an inflected form rather than copied verbatim — that is real active use.')
    if used and exact and a['wordCount']<=6:weaknesses.append('The sentence is very close to a copied phrase — try to express something of your own.')
    for wrong,right,explanation in WRONG_USAGE:
        if wrong not in a['lower']:continue
        issues.append({'category':'VOCAB_COLLOCATION','message':f'Collocation pattern: "{wrong}"','severity':'medium','suggestion':f'{explanation} — try "{right}".'})
        weaknesses.append(f'"{wrong}" is not the accepted pattern — {explanation}.')
    for i in [i for i in a['issues'] if i['severity']!='low'][:3]:issues.append({**i,'excerpt':i.get('excerpt') or None})
    v='needs_correction' if critical or any(i['severity']=='high' for i in issues) else 'mostly_correct' if issues else 'correct'
    actions.append('Use the same word in tomorrow\'s writing task to push it from recognition into active use.' if v=='correct' else 'Rewrite the sentence once, fixing the point above, then submit again.')
    labels={'correct':'Correct','mostly_correct':'Mostly correct','needs_correction':'Needs correction'}
    return {'overallEstimate':None,'confidence':.65 if v=='correct' else .6,
        'criteria':[{'key':'verdict','label':labels[v],'band':None,'note':f'Target word found ({a["wordCount"]} words).' if used else 'Target word not found.'},
                    {'key':'active_use','label':'Active use','band':None,'note':"The word appears in the student's own sentence." if used else 'Recognition only — not yet used.'},
                    {'key':'sentence_completeness','label':'Sentence completeness','band':None,'note':'Complete sentence.' if iscomplete else 'Sentence completeness could not be confirmed.'}],
        'strengths':strengths[:4],'weaknesses':weaknesses[:4],'issues':issues[:8], 'nextActions':actions[:4],
        'recommendedExercises':[{'kind':'vocabulary','label':'Review the due words','href':'/app/vocabulary/review','reason':'Recognition still has to be maintained while active use is practised.'}],
        'verdict':v}

def to_band(raw):return math.floor(min(9,max(4,raw))*2+.5)/2

def sval(transcript,part,durationMs=None,promptText=None,origin='manual',pronunciationAvailable=False):
    if not transcript or not transcript.strip():raise ValueError('riwi_speaking_requires_transcript')
    a=analyse(transcript);words=a['wordCount'];minwords={'part1':40,'part2':150,'part3':60,'general':80,'mock':120}[part]
    strengths=[];weaknesses=[];actions=[];recommended=[];issues=[{**i,'excerpt':i.get('excerpt') or None} for i in a['issues']]
    sec=durationMs/1000 if durationMs and durationMs>0 else None
    wpm=(words/sec*60) if sec else None
    fluency=6.;notes=[]
    if sec is None:notes.append('No recording duration was supplied, so the speaking rate could not be measured.');fluency-=.5
    else:
        # JS Math.round positive halves toward +inf.
        rounded=lambda n:math.floor(n+.5)
        notes.append(f'~{rounded(wpm)} words per minute over {rounded(sec)}s.')
        if wpm<90:
            fluency-=1;weaknesses.append(f'Speaking rate of about {rounded(wpm)} words per minute is slow — hesitation is likely to be audible.')
            issues.append({'category':'SPEAKING_FLUENCY','message':f'Slow delivery: ~{rounded(wpm)} wpm.','severity':'medium','suggestion':'Practise the same answer twice, aiming for a steady 110–150 words per minute.'})
        elif wpm>200:fluency-=.5;weaknesses.append(f'Speaking rate of about {rounded(wpm)} words per minute is very fast — clarity may suffer.')
        else:fluency+=.5;strengths.append('Delivery rate sits in the comfortable range (roughly 110–150 words per minute).')
    if a['hesitationCount']:
        rate=a['hesitationRate'];fluency-=min(1.5,rate/2)
        weaknesses.append(f'{a["hesitationCount"]} hesitation sound(s) detected ({rate:.1f} per 100 words).')
        issues.append({'category':'SPEAKING_FILLERS','message':f'{a["hesitationCount"]} hesitation sound(s) transcribed.','severity':'high' if rate>4 else 'medium','suggestion':'Replace the filler with a one-second pause — silence reads as control, fillers read as hesitation.'})
        recommended.append({'kind':'speaking','label':'Filler-free 30-second answers','href':'/app/speaking/practice','reason':'Recording the same prompt twice is the fastest fix for hesitation.'})
    else:strengths.append('No hesitation sounds transcribed.')
    if a['vaguePhraseCount']>2:fluency-=.25;weaknesses.append(f'{a["vaguePhraseCount"]} vague phrase(s) such as "kind of" or "you know" — these dilute a formal answer.')
    if not a['discourseMarkers']:
        fluency-=.5;weaknesses.append('No discourse markers — the answer reads as a list rather than a developed response.');actions.append('Structure the answer out loud: "First…", "On the other hand…", "So overall…".')
    else:strengths.append(f'Signposts the answer with {len(a["discourseMarkers"])} discourse marker(s).')
    if words<minwords:
        fluency-=1.;weaknesses.append(f'Only {words} words; this part expects at least about {minwords}.')
        issues.append({'category':'SPEAKING_SHORT_RESPONSE','message':f'Short answer: {words} words (target ≈ {minwords}).','severity':'high','suggestion':'Develop each point with a reason and a concrete example before moving on.'})
        recommended.append({'kind':'speaking','label':f'Extend answers to {minwords}+ words','href':'/app/speaking/practice','reason':'Answer length is the most common ceiling on the fluency band.'})
    else:strengths.append(f'Answer length ({words} words) fits the expectations for this part.')
    lexical=5.5+a['typeTokenRatioOnContentWords']*4
    if a['topRepeatedContentWords'] and a['topRepeatedContentWords'][0]['count']>=5:
        worst=a['topRepeatedContentWords'][0];lexical-=.5;weaknesses.append(f'"{worst["word"]}" repeated {worst["count"]} times.')
        issues.append({'category':'SPEAKING_REPETITION','message':f'Repeated word: "{worst["word"]}" ({worst["count"]}×).','severity':'medium','suggestion':'Prepare two alternatives for this word and use them next time.'})
    if a['typeTokenRatioOnContentWords']>=.55 and words>=60:lexical+=.5;strengths.append('Varied vocabulary across the answer.')
    grammar=6.;high=sum(i['severity']=='high' for i in a['issues'])
    if high:
        grammar-=min(1.5,high*.5);weaknesses.append(f'{high} grammatical error pattern(s) detected in the transcript.')
    if len(a['shortSentences'])>2:grammar-=.5;weaknesses.append('Many very short clauses — try one subordinating structure per answer.')
    if a['avgSentenceWords']>=12:grammar+=.5;strengths.append('Attempts complex structures rather than isolated short clauses.')
    crit=[{'key':'fluency','label':'Fluency and Coherence','band':to_band(fluency),'note':' '.join(notes)},
          {'key':'lexical','label':'Lexical Resource','band':to_band(lexical),'note':f'Content-word variety {a["typeTokenRatioOnContentWords"]*100:.0f}%.'},
          {'key':'grammar','label':'Grammatical Range and Accuracy','band':to_band(grammar),'note':f'{len(a["issues"])} pattern-level issue(s) in the transcript.'},
          {'key':'pronunciation','label':'Pronunciation','band':None,'limited':True,'note':'Not assessed: pronunciation cannot be judged from a transcript, and no connected provider analyses audio. This criterion is left empty on purpose rather than estimated.'}]
    overall=to_band(sum(c['band'] for c in crit if c['band'] is not None)/3)
    confidence=.3+.3*min(1,words/150)
    if durationMs:confidence+=.1
    if origin=='stt':confidence+=.1
    if origin=='manual':confidence-=.05
    if not pronunciationAvailable:confidence-=.05
    confidence=math.floor(min(.72,max(.15,confidence))*100+.5)/100
    if origin=='manual':actions.append('This transcript was typed by you, not transcribed from the audio — check it against your recording before acting on the details.')
    if promptText:recommended.append({'kind':'speaking','label':'Repeat this same prompt one week later','href':'/app/speaking/history','reason':'Comparing two recordings of the same topic makes progress visible.'})
    if not actions:actions.append('Record one more take of the same prompt and compare the two transcripts side by side.')
    if not strengths:strengths.append('A complete recorded attempt is the raw material every speaking improvement is built from.')
    if not weaknesses:weaknesses.append('No structural problems detected in the transcript patterns RIWI checks.')
    return {'overallEstimate':overall,'confidence':confidence,'criteria':crit,'strengths':strengths[:6],'weaknesses':weaknesses[:6],
            'issues':issues[:12],'nextActions':actions[:5],'recommendedExercises':recommended[:4],'verdict':None}
