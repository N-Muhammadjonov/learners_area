"""Inert existing map geometry for the key-free native exam projection.

Only the authored PARTS constant is parsed. No JavaScript is executed and the
answer-bearing DATA/transcript/study objects are never returned.
"""
import json,re
from functools import lru_cache
from xml.etree import ElementTree as ET

ATTRS={'x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','d','points','fill','stroke','stroke-width','stroke-dasharray','font-size','text-anchor','transform','opacity'}
NAMES={'stroke-width':'strokeWidth','stroke-dasharray':'strokeDasharray','font-size':'fontSize','text-anchor':'textAnchor'}
TAGS={'path','rect','circle','ellipse','line','polyline','polygon','text','g'}

def svg_diagram(text):
    if not isinstance(text,str) or len(text)>150000:return None
    try:root=ET.fromstring(text)
    except ET.ParseError:return None
    raw=root.get('viewBox') or root.get('viewbox') or ''
    try:view=[float(v) for v in re.split(r'[,\s]+',raw.strip())]
    except ValueError:return None
    if len(view)!=4 or any(not (-100000<=v<=100000) for v in view) or min(view[2:])<=0:return None
    shapes=[]
    def visit(node,inherited):
        tag=node.tag.rsplit('}',1)[-1]
        if tag not in TAGS:return
        attrs=dict(inherited)
        for key,value in node.attrib.items():
            if key not in ATTRS or re.search(r'url\s*\(|javascript:|data:|https?:',value,re.I):continue
            target=NAMES.get(key,key)
            attrs[target]=(attrs.get(target,'')+' '+value).strip() if target=='transform' else value
        if tag=='g':
            for child in node:visit(child,attrs)
        else:
            item={'tag':tag,**attrs}
            if tag=='text':item['text']=''.join(node.itertext())[:2000]
            shapes.append(item)
    for child in root:visit(child,{})
    if not shapes or len(shapes)>1000:return None
    return {'viewBox':view,'label':root.get('aria-label') or 'Listening map','shapes':shapes}

@lru_cache(maxsize=32)
def source_map(source):
    match=re.fullmatch(r'listening-test-([1-9]|[12][0-9]|3[0-2])',str(source))
    if not match:return None
    from .listening_runtime import runtime
    data=runtime(int(match[1]));html=data['files'].get(data['entryPath'],'')
    found=re.search(r'\bconst PARTS\s*=\s*',html)
    if not found:return None
    try:parts,_=json.JSONDecoder().raw_decode(html[found.end():])
    except (ValueError,TypeError):return None
    if not isinstance(parts,dict):return None
    for text in parts.values():
        if not isinstance(text,str):continue
        for match in re.finditer(r'<svg\b[^>]*>.*?</svg>',text,re.I|re.S):
            diagram=svg_diagram(match[0])
            if diagram and diagram['viewBox'][2]>100:return diagram
    return None
