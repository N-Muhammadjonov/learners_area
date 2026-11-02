"""Conservative query matching; original learner writing is never rewritten."""
import difflib
import re
import unicodedata

_CYRILLIC=dict(zip('абвгдеёжзийклмнопрстуфхцчшъыьэюяқғҳў',
    ('a','b','v','g','d','e','yo','j','z','i','y','k','l','m','n','o','p','r','s','t','u','f','x','ts','ch','sh','','i','','e','yu','ya','q','g','h','o')))
_APOSTROPHES="'‘’ʻʼ`´ʹ"
_FIXES={
 'prezent':'present','presnt':'present','prsent':'present','presen':'present','perfekt':'perfect','perfct':'perfect','prfct':'perfect','perefect':'perfect',
 'simpl':'simple','simpel':'simple','kontinius':'continuous','kontinuous':'continuous','continous':'continuous','countinous':'continuous',
 'pasiv':'passive','passiv':'passive','artikl':'articles','artikllar':'articles','artikllarni':'articles','article':'articles',
 'farqi':'farq','farqini':'farq','farki':'farq','farkini':'farq','tushintir':'tushuntir','tushintr':'tushuntir','tushuntr':'tushuntir',
 'tushuntirib':'tushuntir','tushuntiring':'tushuntir','tushintirib':'tushuntir','tushunmadm':'tushunmadim','tushinmadim':'tushunmadim',
 'misollar':'misol','misollarni':'misol','misolini':'misol','misollarini':'misol','msol':'misol','mashqlar':'mashq','mashqni':'mashq',
 'soddarok':'soddaroq','qisqarok':'qisqaroq','oddiyrok':'oddiyroq','batafsilroq':'batafsil','gramatika':'grammatika',
 'birikmalar':'birikmasi','birikmalarini':'birikmasi','birikmalarni':'birikmasi','birikmalari':'birikmasi','birikmasini':'birikmasi',
 'zamonni':'zamon','zamonlar':'zamon','zamonlarini':'zamon','grammatikasini':'grammatika',
}
_MATCH_WORDS=('present','perfect','continuous','progressive','simple','passive','articles','conditional','conditionals','prepositions','diagramma','zamon','nisbat',
              'comparatives','quantifiers','collocation','grammar','vocabulary','listening','reading','speaking','writing','tushuntir','tushunmadim','soddaroq')

def normalize_query(text):
    value=unicodedata.normalize('NFKC',str(text)).casefold()
    value=''.join(_CYRILLIC.get(c,c) for c in value)
    value=value.translate(str.maketrans('','',_APOSTROPHES))
    value=re.sub(r'\bpresentperfect\b','present perfect',value)
    value=re.sub(r'\bpastsimple\b','past simple',value)
    tokens=re.findall(r'[^\W_]+',value)
    result=[]
    for token in tokens:
        word=_FIXES.get(token,token)
        for suffix in ('ning','dan','ni','ga'):
            if word.endswith(suffix) and word[:-len(suffix)] in _MATCH_WORDS:
                word=word[:-len(suffix)];break
        if word not in _MATCH_WORDS and len(word)>=6:
            ranked=sorted(((difflib.SequenceMatcher(None,word,x).ratio(),x) for x in _MATCH_WORDS),reverse=True)
            if ranked[0][0]>=.85 and ranked[0][0]-ranked[1][0]>=.1:word=ranked[0][1]
        result.append(word)
    return ' '.join(result)
