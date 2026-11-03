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
 'kembrij':'cambridge','cambrij':'cambridge','nominalizasiya':'nominalizatsiya',
 'deontik':'deontic','epistemik':'epistemic','inversiya':'inversion','inversiyani':'inversion',
}
_MATCH_WORDS=('present','perfect','continuous','progressive','simple','passive','articles','conditional','conditionals','prepositions','diagramma','zamon','nisbat',
              'comparatives','quantifiers','collocation','grammar','vocabulary','listening','reading','speaking','writing','tushuntir','tushunmadim','soddaroq',
              'nominalisation','nominalization','nominalizatsiya','otlashtirish','hedging','cambridge','guardian')

# Closed loan-word roots: remove Uzbek suffixes only from a known English root,
# never from arbitrary names or Uzbek words (e.g. landscape+ni, picnic+ga).
_LOANS=frozenset(_MATCH_WORDS)|frozenset(_FIXES)|frozenset(('although despite borrow lend fun funny big large actually eventually finally '
 'interested decision information homework overview essay thesis paragraph sentence word meaning example examples '
 'landscape picnic podcast transcript grammar article noun verb adjective adverb phrasal collocation '
 'education environment opportunity achievement reliable relevant efficient evidence approach outcome inversion cleft ellipsis '
 'finite nonfinite subjunctive determiner pronoun quantifier clause participle deontic epistemic telicity '
 'speaking writing reading listening retention vocabulary dictionary question answer test skill plan').split())
_SUFFIXES=('laringizdan','laringizni','laringiz','larimizni','larimiz','laridan','larining','laridagi','larida','larini',
           'larning','lardan','larga','dagi','ning','dan','larni','lari','lar','imiz','ingiz','imni','imga','im','ni','ga','ka','da')


def loan_root(word):
    if word in _LOANS:return word
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and word[:-len(suffix)] in _LOANS:return word[:-len(suffix)]
    return word

def normalize_query(text):
    value=unicodedata.normalize('NFKC',str(text)).casefold()
    value=''.join(_CYRILLIC.get(c,c) for c in value)
    value=value.translate(str.maketrans('','',_APOSTROPHES))
    value=re.sub(r'\bpresentperfect','present perfect',value)
    value=re.sub(r'\bpastsimple','past simple',value)
    tokens=re.findall(r'[^\W_]+',value)
    result=[]
    for token in tokens:
        root=loan_root(token)
        word=loan_root(_FIXES.get(root,root))
        for suffix in ('ning','dan','ni','ga'):
            if word.endswith(suffix) and word[:-len(suffix)] in _MATCH_WORDS:
                word=word[:-len(suffix)];break
        if word not in _MATCH_WORDS and len(word)>=6:
            ranked=sorted(((difflib.SequenceMatcher(None,word,x).ratio(),x) for x in _MATCH_WORDS),reverse=True)
            if ranked[0][0]>=.85 and ranked[0][0]-ranked[1][0]>=.1:word=ranked[0][1]
        result.append(word)
    return ' '.join(result)
