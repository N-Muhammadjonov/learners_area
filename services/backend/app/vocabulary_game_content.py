"""Game eligibility from existing authored fields. Never generate missing examples."""
import re

def normalize(value):
    return ' '.join(re.sub(r"[^a-z0-9' ]+",' ',str(value or '').lower().replace('\u2018',"'").replace('\u2019',"'").replace('\u02bb',"'").replace('`',"'")).split())

def sentence_for(word):
    return str(word.get('exampleSentence') or '').strip() or str(word.get('definitionEn') or '').strip()

def gap_prompt(word):
    term=str(word.get('term') or '').strip();sentence=sentence_for(word)
    if not term or not sentence:return None
    pattern=r'(?<!\w)'+r'\s+'.join(re.escape(part) for part in term.split())+r'(?!\w)'
    replaced=re.sub(pattern,'______',sentence,flags=re.I)
    return replaced if replaced!=sentence else None

def eligible_words(words,game):
    result=[];ids=set();terms=set();meanings=set()
    for word in words:
        term=normalize(word.get('term'));meaning=normalize(word.get('definitionEn'))
        if not term or not meaning or word['id'] in ids:continue
        if game=='translation' and not str(word.get('translationUz') or '').strip():continue
        if game=='gap' and not gap_prompt(word):continue
        if game=='builder' and len(sentence_for(word).split())<2:continue
        if game in ('choice','match') and (term in terms or meaning in meanings):continue
        ids.add(word['id']);terms.add(term);meanings.add(meaning);result.append(word)
    return result
