"""Pure Python renderers ported from lib/reporter/exports.ts.
All outputs use one immutable audited report snapshot; no external service.
"""
from __future__ import annotations
import hashlib,html,io,json,re,zipfile
from datetime import datetime

def jd(x,pretty=False):
    return json.dumps(x,ensure_ascii=False,indent=2 if pretty else None,separators=None if pretty else (',',':'),default=str)
def sha(b):return hashlib.sha256(b).hexdigest()
def snap_hash(s):return sha(jd(s).encode())
CONTENT_TYPES={'json':'application/json; charset=utf-8','csv':'text/csv; charset=utf-8',
 'xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'pdf':'application/pdf','zip':'application/zip'}
T={
'en':{'title':'RIWI report','scope':'Scope','period':'Period','timezone':'Timezone','generated':'Generated','reportId':'Report ID','owner':'Whole centre (owner)','teacher':'All students (teacher)','student':'Student','operations':'Centre operations','summary':'Summary','metrics':'Metrics','sources':'Sources',
 'cols':['Section','Metric','Value','Unit','Basis','Window from','Window to (exclusive)','Scope','Query ID','Generated at'],'sourceCols':['Query ID','SQL','Parameters'],'noData':'— = no data in this window','integrity':'Snapshot SHA-256',
 'sections':{'learning':'Learning','results':'Results','people':'People','operations':'Operations'},'basis':{'window':'in window','as_of_end':'as of window end'}},
'uz':{'title':'RIWI hisoboti','scope':'Qamrov','period':'Davr','timezone':'Vaqt mintaqasi','generated':'Yaratilgan','reportId':'Hisobot ID','owner':'Butun markaz (ega)','teacher':"Barcha talabalar (o'qituvchi)",'student':'Talaba','operations':'Markaz operatsiyalari','summary':'Xulosa','metrics':"Ko'rsatkichlar",'sources':'Manbalar',
 'cols':["Bo'lim","Ko'rsatkich","Qiymat","Birlik","Asos","Oyna boshi","Oyna oxiri (kirmaydi)","Qamrov","So'rov ID","Yaratilgan vaqt"], 'sourceCols':["So'rov ID","SQL","Parametrlar"], 'noData':"— = bu oynada ma'lumot yo'q",'integrity':'Snapshot SHA-256',
 'sections':{'learning':"O'qish faolligi",'results':'Natijalar','people':'Odamlar','operations':'Operatsiyalar'},'basis':{'window':'oyna ichida','as_of_end':'oyna oxiriga ko\'ra'}}}

def metric_value(m):
    v=m['value']
    if v is None:return '—'
    if m['unit']=='ratio':return f'{v*100:.1f}%'
    if m['unit'] in ('band','score'):return f'{v:.2f}'
    return str(round(v))
def head(s,lang):
    t=T[lang];scope=s['scope'];scope_text=f"{t['student']}: {scope['subjectName']}" if scope['kind']=='student' else t[scope['kind']]
    p=s['period'];return [(t['scope'],scope_text),(t['period'],f"{p['kind']}: {p['fromDate']} … {p['toDate']}"),(t['timezone'],s['timezone']),(t['generated'],s['generatedAt']),(t['reportId'],s['reportId']),(t['integrity'],snap_hash(s))]
def metric_row(m,lang):
    t=T[lang];return [t['sections'][m['section']],m['label'][lang],metric_value(m),m['unit'],t['basis'][m['window']['basis']],m['window']['from'],m['window']['to'],m['scope'],m['source']['queryId'],m['generatedAt']]
def safe(v):
    v=str(v)
    return "'"+v if re.match(r'^[=+\-@\t\r]',v) and not re.fullmatch(r'-?\d+(?:\.\d+)?%?',v) else v
def csv_cell(v):
    x=safe(v);return '"'+x.replace('"','""')+'"' if re.search(r'[,"\r\n]',x) else x
def csv(s,lang):
    lines=[','.join(map(csv_cell,r)) for r in head(s,lang)]+['',','.join(map(csv_cell,T[lang]['cols']))]
    lines+= [','.join(map(csv_cell,metric_row(m,lang))) for m in s['metrics']]
    return ('\ufeff'+'\r\n'.join(lines)+'\r\n').encode('utf-8')
def xml(s):
    return html.escape(re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(s)),quote=True).replace('&#x27;',"'")
XML_HEAD='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
def zip_bytes(files,stamp):
    buf=io.BytesIO(); dt=datetime.fromisoformat(stamp.replace('Z','+00:00'))
    with zipfile.ZipFile(buf,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,body in files.items():
            i=zipfile.ZipInfo(name, date_time=(max(1980,dt.year),dt.month,dt.day,dt.hour,dt.minute,dt.second));i.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(i,body.encode('utf-8') if isinstance(body,str) else body)
    return buf.getvalue()
def sheet(rows):
    rows_xml=[]
    for r,row in enumerate(rows,1):
        cells=[]
        for c,cell in enumerate(row):
            idx=c+1;label=''
            while idx:idx,rem=divmod(idx-1,26);label=chr(65+rem)+label
            ref=f'{label}{r}'
            if cell is None:cells.append(f'<c r="{ref}"/>')
            elif isinstance(cell,(int,float)) and not isinstance(cell,bool):cells.append(f'<c r="{ref}"><v>{cell}</v></c>')
            else:cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{xml(safe(cell))}</t></is></c>')
        rows_xml.append(f'<row r="{r}">'+''.join(cells)+'</row>')
    return XML_HEAD+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join(rows_xml)+'</sheetData></worksheet>'
def xlsx(s,lang):
    t=T[lang];mrows=[list(r) for r in head(s,lang)]+[[],t['cols'][:3]+['Raw']+t['cols'][3:]]
    for m in s['metrics']:
        r=metric_row(m,lang);mrows.append(r[:3]+[m['value']]+r[3:])
    sources=[t['sourceCols']]+[[m['source']['queryId'],m['source']['sql'],jd(m['source']['parameters'])] for m in s['metrics']]
    return zip_bytes({
        '[Content_Types].xml':XML_HEAD+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels':XML_HEAD+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml':XML_HEAD+f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{xml(t["metrics"][:31])}" sheetId="1" r:id="rId1"/><sheet name="{xml(t["sources"][:31])}" sheetId="2" r:id="rId2"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':XML_HEAD+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml':sheet(mrows),'xl/worksheets/sheet2.xml':sheet(sources)},s['generatedAt'])
def para(v,bold=False,size=0,mono=False):
    props=('<w:b/>' if bold else '')+(f'<w:sz w:val="{size}"/>' if size else '')+('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' if mono else '')
    return '<w:p><w:r>'+('<w:rPr>'+props+'</w:rPr>' if props else '')+f'<w:t xml:space="preserve">{xml(v)}</w:t></w:r></w:p>'
def doctable(rows,header):
    def cell(v,bold=False):return '<w:tc><w:p><w:r>'+('<w:rPr><w:b/></w:rPr>' if bold else '')+f'<w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">{xml(v)}</w:t></w:r></w:p></w:tc>'
    border='<w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="2"/><w:insideV w:val="single" w:sz="2"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tblBorders>'
    return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>'+border+'</w:tblPr><w:tr>'+''.join(cell(x,True) for x in header)+'</w:tr>'+''.join('<w:tr>'+''.join(cell(v) for v in r)+'</w:tr>' for r in rows)+'</w:tbl>'
def docx(s,lang):
    t=T[lang];body=para(t['title'],True,36)+''.join(para(f'{k}: {v}') for k,v in head(s,lang))+para(t['summary'],True,28)
    body+=''.join(para(line) for line in s['narrative'][lang])+para(t['metrics'],True,28)
    body+=doctable([[r[i] for i in (0,1,2,4,8)] for r in (metric_row(m,lang) for m in s['metrics'])],[t['cols'][i] for i in (0,1,2,4,8)])
    body+=para(t['noData'])+para(t['sources'],True,28)
    for m in s['metrics']:
        source=m['source'];body+=para(source['queryId'],True)+para(source['sql'],size=16,mono=True)+para(jd(source['parameters']),size=16,mono=True)
    return zip_bytes({'[Content_Types].xml':XML_HEAD+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels':XML_HEAD+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml':XML_HEAD+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900"/></w:sectPr></w:body></w:document>'},s['generatedAt'])
def pdf_escape(v):
    v=v.replace('‘',"'").replace('’',"'").replace('ʻ',"'").replace('ʼ',"'").replace('“','"').replace('”','"').replace('–','-').replace('—','-').replace('…','...')
    return re.sub(r'[\\()]',lambda m:'\\'+m.group(),''.join(c if 32<=ord(c)<=126 else '?' for c in v))
def wrap(value,width):
    out=[];remain=value
    while len(remain)>width:
        cut=remain.rfind(' ',0,width+1)
        if cut<width/2:cut=width
        out.append(remain[:cut]);remain=remain[cut:].lstrip()
    if remain:out.append(remain)
    return out or ['']
def pdf(s,lang):
    t=T[lang];lines=[(t['title'],16,True,False),('',6,False,False)]
    for k,v in head(s,lang):lines.extend((w,9,False,False) for w in wrap(f'{k}: {v}',95))
    lines +=[('',6,False,False),(t['summary'],12,True,False)]
    for sentence in s['narrative'][lang]:lines.extend((w,9,False,False) for w in wrap(sentence,95))
    lines +=[('',6,False,False),(t['metrics'],12,True,False)]
    for m in s['metrics']:
        r=metric_row(m,lang);lines.append((f'{r[1]}: {r[2]}  ({r[4]})',9,False,False))
    lines +=[(t['noData'],8,False,False),('',6,False,False),(t['sources'],12,True,False)]
    for m in s['metrics']:
        lines.append((m['source']['queryId'],8,True,False))
        lines.extend((w,7,False,True) for w in wrap(m['source']['sql'],110))
        lines.extend((w,7,False,True) for w in wrap(jd(m['source']['parameters']),110))
    pages=[];ops=[];y=800
    for value,size,bold,mono in lines:
        lead=size+4
        if y-lead<50:pages.append('\n'.join(ops));ops=[];y=800
        y-=lead
        if value:ops.append(f'BT /{"F3" if mono else "F2" if bold else "F1"} {size} Tf 50 {y} Td ({pdf_escape(value)}) Tj ET')
    pages.append('\n'.join(ops));objects=[]
    def add(body):objects.append(body);return len(objects)
    root=add('');pages_id=add('');f1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');f2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');f3=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>')
    ids=[]
    for idx,content in enumerate(pages,1):
        stream=content+'\n'+f'BT /F1 7 Tf 50 30 Td ({pdf_escape(s["reportId"]+" - "+str(idx)+"/"+str(len(pages)))}) Tj ET'
        stream_id=add(f'<< /Length {len(stream.encode("latin1"))} >>\nstream\n{stream}\nendstream')
        ids.append(add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {f1} 0 R /F2 {f2} 0 R /F3 {f3} 0 R >> >> /Contents {stream_id} 0 R >>'))
    objects[root-1]=f'<< /Type /Catalog /Pages {pages_id} 0 R >>'
    objects[pages_id-1]='<< /Type /Pages /Kids ['+' '.join(f'{id} 0 R' for id in ids)+f'] /Count {len(ids)} >>'
    info=add(f'<< /Title ({pdf_escape(t["title"]+" "+s["reportId"])}) /Producer (RIWI Reporter) >>')
    out='%PDF-1.4\n';offsets=[]
    for i,body in enumerate(objects,1):offsets.append(len(out.encode('latin1')));out+=f'{i} 0 obj\n{body}\nendobj\n'
    xref_at=len(out.encode('latin1'))
    out+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'+''.join(f'{offset:010d} 00000 n \n' for offset in offsets)
    out+=f'trailer\n<< /Size {len(objects)+1} /Root {root} 0 R /Info {info} 0 R >>\nstartxref\n{xref_at}\n%%EOF\n'
    return out.encode('latin1')
def render(s,fmt,lang):
    if fmt=='json':return jd(s,True).encode()
    if fmt=='csv':return csv(s,lang)
    if fmt=='xlsx':return xlsx(s,lang)
    if fmt=='docx':return docx(s,lang)
    if fmt=='pdf':return pdf(s,lang)
    if fmt=='zip':
        files={f'report.{f}':render(s,f,lang) for f in ('json','csv','xlsx','docx','pdf')}
        manifest={'schemaVersion':s['schemaVersion'],'reportId':s['reportId'],'generatedAt':s['generatedAt'],'timezone':s['timezone'],
          'period':{k:s['period'][k] for k in ('kind','from','to')},'scope':s['scope']['kind'],'language':lang,'snapshotSha256':snap_hash(s),
          'files':[{'name':name,'bytes':len(b),'sha256':sha(b)} for name,b in files.items()]}
        return zip_bytes({**files,'manifest.json':jd(manifest,True)},s['generatedAt'])
    raise ValueError('Invalid report format')
