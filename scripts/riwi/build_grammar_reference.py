"""Read the supplied original DOCX as data and compile governed grammar cards."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as E
import zipfile

ROOT=Path(__file__).resolve().parents[2]
SOURCE_HASH='29bc917a2c5fb6e42696a4aa037eaa86b988ce4825f644ef957126f2baf7f86c'
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def build(path):
    data=path.read_bytes()
    if hashlib.sha256(data).hexdigest()!=SOURCE_HASH:raise ValueError('source_document_changed')
    with zipfile.ZipFile(path) as z:root=E.fromstring(z.read('word/document.xml'))
    rows=[]
    for i,p in enumerate(root.findall('.//w:body/w:p',NS)):
        style=p.find('./w:pPr/w:pStyle',NS)
        rows.append({'paragraph':i+1,'style':style.get('{'+NS['w']+'}val','') if style is not None else '',
                     'text':''.join(t.text or '' for t in p.findall('.//w:t',NS))})
    tables=[[[ ''.join(t.text or '' for t in c.findall('.//w:t',NS)) for c in row.findall('./w:tc',NS)]
              for row in table.findall('./w:tr',NS)] for table in root.findall('.//w:tbl',NS)]
    additions={}
    for line in (Path(__file__).parent/'grammar_reference_additions.txt').read_text().splitlines():
        n,rule,*examples=line.split('|');n=int(n)
        if n in additions or len(examples)!=2:raise ValueError('invalid_authored_addition')
        additions[n]={'explanationEn':rule,'examples':[dict(zip(('en','uz'),x.split('~'))) for x in examples]}
    entries=[];chapter=''
    for i,row in enumerate(rows):
        if row['style']=='Heading1':chapter=row['text']
        m=re.fullmatch(r'(\d{3})\. (.+)',row['text']) if row['style']=='Heading2' else None
        if not m:continue
        n=int(m[1]);parts=rows[i+1:i+5]
        if [p['style'] for p in parts]!=['Rule','Pattern','Example','Caution']:raise ValueError('invalid_source_structure')
        ex=re.fullmatch(r'EN\s+(.+?)\s+\|\s+UZ\s+(.+)',parts[2]['text'])
        if not ex:raise ValueError('source_example_not_readable')
        title=m[2];aliases=[title]
        short=re.split(r':',title)[0]
        if len(short.split())>=2:aliases.append(short)
        entries.append({'id':f'grammar.reference.{n:03d}','number':n,'title':title,
          'aliases':list(dict.fromkeys(aliases)), 'chapter':chapter,
          'explanationUz':re.sub(r'^QOIDA\s+','',parts[0]['text']),
          'explanationEn':additions[n]['explanationEn'],
          'pattern':re.sub(r'^TUZILMA\s+','',parts[1]['text']),
          'tipUz':re.sub(r'^E.TIBOR\s+','',parts[3]['text']),
          'examples':[{'en':ex[1],'uz':ex[2]},*additions[n]['examples']],
          'source':{'sha256':SOURCE_HASH,'paragraphs':[p['paragraph'] for p in [row,*parts]],'suppliedByOwner':True}})
    if {e['number'] for e in entries}!=set(range(1,291)) or set(additions)!=set(range(1,291)):raise ValueError('incomplete_grammar_reference')
    # Preserve the original file; curated display notes avoid overgeneralising
    # three source formulations. Paragraph provenance remains available inside.
    entries[13]['tipUz']='Vergulni gaplar tuzilishi, uzunligi va ma’nosiga qarab tanlang; har ikki qisqa clause orasida majburiy emas.'
    entries[52]['tipUz']='Might not — ehtimol bunday emas yoki bo‘lmaydi; can’t esa xulosa ma’nosida ko‘pincha imkonsizlikni bildiradi.'
    entries[137]['pattern']='all three of my books; the first two chapters'
    entries[210]['examples'][0]={'en':'How could we ignore such clear evidence?','uz':'Bunchalik aniq dalilni qanday qilib e’tiborsiz qoldiramiz? — bu yerda ritorik e’tiroz.'}
    extras={
      151:['only after inversion','only when inversion','only then inversion'],
      155:['had conditional inversion','had i known'],156:['were conditional inversion'],157:['should conditional inversion'],
      158:['it cleft','cleft sentences'],159:['pseudo cleft'],185:['deontic epistemic','deontic modality','epistemic modality'],
      205:['telicity','telic atelic'],254:['finite non finite','finite and nonfinite'],
      290:['dangling modifier','dangling modifiers'],283:['by va to farqi','increase by increase to'],
      284:['percentage points','foiz punkt','foiz punkti'],150:['negative inversion','inkor inversiyasi'],
    }
    for n,aliases in extras.items():entries[n-1]['aliases']+=aliases
    # Supplementary data remains scoped learning material, never a replacement
    # for the canonical sense-level dictionary or an official level certificate.
    support=[]
    for start in range(1,len(tables[4]),28):
        support.append({'id':f'grammar.reference.verbs.{start:03d}','kind':'verb_forms','rows':tables[4][start:start+28]})
    for start in range(1,len(tables[1]),5):
        support.append({'id':f'grammar.reference.errors.{start:03d}','kind':'error_patterns','rows':tables[1][start:start+5]})
    support += [{'id':'grammar.reference.tense-map','kind':'tense_map','rows':tables[2][1:]},
                {'id':'grammar.reference.terminology','kind':'terminology','rows':tables[3][1:]},
                {'id':'grammar.reference.study-plan','kind':'illustrative_plan','rows':tables[5][1:]}]
    result={'schemaVersion':1,'version':'riwi-grammar-reference-v1',
      'source':{'file':path.name,'sha256':SOURCE_HASH,'paragraphCount':len(rows),'topicCount':290,
                'tableCount':len(tables),'levelLabels':'source pedagogic labels, not CEFR certification',
                'permission':'Owner supplied and requested internal teaching use; binary not imported'},
      'entries':entries,'support':support}
    return json.loads(unicodedata.normalize('NFC',json.dumps(result,ensure_ascii=False)))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);args=parser.parse_args()
    pack=build(args.source)
    (ROOT/'services/backend/contracts/riwi_grammar_reference_v1.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'topics':len(pack['entries']),'supportUnits':len(pack['support']),'examples':sum(len(e['examples']) for e in pack['entries'])}))
