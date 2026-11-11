"""Inert question layout and maps for the key-free native exam projection.

Only the matching public question identities and sanitized PARTS markup leave
the server. The authored JavaScript and answer-bearing objects stay server-side.
"""
import ast,json,re
from html import escape
from functools import lru_cache
from xml.etree import ElementTree as ET

from bleach import Cleaner
from bleach.css_sanitizer import CSSSanitizer
from bleach.html5lib_shim import Filter

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


PART_TAGS = frozenset('div section span p strong b em i br hr ul ol li table thead tbody tfoot tr th td h1 h2 h3 h4 label input select option main textarea button a img svg'.split()) | TAGS
SHELL_PATTERN = re.compile(r'<div class="exam-root\b[^>]*id="examRoot".*?</div></div>(?=`\))', re.S)
MAP_18 = 'https://ia601408.us.archive.org/3/items/skrinshot-2026-10-02-133313/Skrinshot%202026-10-02%20133313.png'
PART_ATTRIBUTES = frozenset('class id type name aria-label colspan rowspan placeholder data-q data-qnum data-group data-question data-code data-label data-placeholder data-pair-qs data-pair-group data-max data-ldm-group data-radio style for role title alt aria-hidden aria-modal aria-labelledby aria-pressed min max step disabled draggable target rel tabindex'.split())
PART_STYLES = frozenset('margin margin-top margin-bottom margin-left margin-right padding padding-top padding-bottom padding-left padding-right width min-width max-width height min-height display gap column-gap row-gap grid-template-columns grid-column flex flex-wrap flex-direction justify-content align-items text-align font-size font-weight border border-color border-width border-style border-collapse border-bottom color background-color vertical-align white-space line-height border-radius font-family list-style columns background'.split())


def part_attribute(tag: str, name: str, value: str) -> bool:
    if name == 'value':
        return tag in ('input','option') and (value == '' or bool(re.fullmatch(r'[A-Za-z0-9]{1,4}', value)))
    if name == 'href':
        return tag == 'a' and value == 'https://t.me/LEARNERS_AREA'
    if name == 'src':
        return tag == 'img' and value == MAP_18
    if tag in TAGS | {'svg'} and name in ATTRS | {'viewBox','font-weight','xmlns'}:
        return not re.search(r'url\s*\(|javascript:|data:', value, re.I)
    return name in PART_ATTRIBUTES and (name != 'style' or not re.search(r'url\s*\(|expression\s*\(',value,re.I))


class EmptyTextInputs(Filter):
    def __iter__(self):
        for token in super().__iter__():
            if token.get('name') == 'input' and token['type'] in ('StartTag', 'EmptyTag'):
                attrs = token['data']
                if attrs.get((None, 'type')) not in ('radio', 'checkbox'):
                    attrs.pop((None, 'value'), None)
            yield token


def normalized_choice(text: str, code: str) -> str:
    prefix = rf'^{re.escape(code)}(?:[.)]\s*|\s+)'
    value = ' '.join(text.split())
    while re.match(prefix, value):
        value = re.sub(prefix, '', value, count=1)
    return value


def source_signature(questions, number_key, part_key, text_key):
    return tuple(sorted((q[number_key], q[part_key], ' '.join(q[text_key].split())) for q in questions))


@lru_cache(maxsize=2)
def original_entry_layout(source: str) -> dict | None:
    if source not in ('listening-test-1', 'listening-test-7'):
        return None
    from .listening_runtime import runtime
    data = runtime(int(source.rsplit('-', 1)[1]))
    html = data['files'][data['entryPath']]
    style = re.search(r'<style>(.*?)</style>', html, re.S | re.I)
    hub = re.search(r'<section\b[^>]*\bclass="hub"[^>]*>.*?</section>', html, re.S)
    activities = re.search(r'\bconst ACTIVITIES\s*=\s*(\[.*?\n\]);', html, re.S)
    if not style or not hub or not activities or re.search(r'@import|url\s*\(', style[1], re.I):
        return None
    try:
        rows = ast.literal_eval(activities[1])
    except (ValueError, SyntaxError):
        return None
    if not isinstance(rows, list) or not 1 <= len(rows) <= 12 or any(
        not isinstance(row, list) or len(row) != 4 or
        any(not isinstance(value, str) or len(value) > 1000 for value in row)
        for row in rows
    ) or rows[0][0] != 'exam':
        return None
    # Only original static presentation leaves the server. No embedded HTML audio,
    # authored scripts, answer keys or replacement for the existing Cloudflare audio.
    cleaner = Cleaner(tags=PART_TAGS, attributes=part_attribute,
                      css_sanitizer=CSSSanitizer(allowed_css_properties=PART_STYLES), strip=True)
    return {'shell': cleaner.clean(hub[0]), 'style': style[1],
            'activities': [dict(zip(('id', 'number', 'title', 'description'), row)) for row in rows]}


@lru_cache(maxsize=32)
def pinned_exam_parts(source: str) -> tuple[tuple, dict, dict[int, tuple[tuple[str, str], ...]]] | None:
    # Site-wide styles must never affect the internal interface of any of the 32 Listening tests.
    # Keep each test's original shell, stylesheet and four papers together for its isolated renderer.
    match=re.fullmatch(r'listening-test-([1-9]|[12][0-9]|3[0-2])',source)
    if not match:return None
    from .listening_runtime import runtime
    data=runtime(int(match[1]))
    html=data['files'].get(data['entryPath'],'')
    parts=re.search(r'\bconst PARTS\s*=\s*',html)
    catalogue=re.search(r'\bconst DATA\s*=\s*',html)
    shell = SHELL_PATTERN.search(html)
    style = re.search(r'<style>(.*?)</style>', html, re.S | re.I)
    if not parts or not catalogue or not shell or not style:return None
    if re.search(r'@import|url\s*\(', style[1], re.I):return None
    try:
        bodies,_=json.JSONDecoder().raw_decode(html[parts.end():])
        original,_=json.JSONDecoder().raw_decode(html[catalogue.end():])
        questions=original['questions']
        rows=list(questions.values()) if isinstance(questions,dict) else questions
        fingerprint=source_signature(rows,'q','part','prompt')
        if len(fingerprint)!=40 or set(bodies)!={'1','2','3','4'}:return None
        if any(re.search(r'<\s*(?:script|iframe|object|style|textarea)\b', body, re.I) for body in bodies.values()):
            return None
        choices = {
            q['q']: tuple((o['code'], normalized_choice(o['text'], o['code'])) for o in q['options'])
            for q in rows if q.get('options')
        }
        cleaner=Cleaner(tags=PART_TAGS,attributes=part_attribute,
                        css_sanitizer=CSSSanitizer(allowed_css_properties=PART_STYLES),
                        filters=[EmptyTextInputs],strip=True)
        sections = original['sections']
        if len(sections) != 4 or any(not isinstance(label, str) for label in sections):
            return None
        markup = shell[0].replace('${DATA.sections[0]}', escape(sections[0]))
        exam = {'shell': cleaner.clean(markup), 'style': style[1],
                'parts': tuple(cleaner.clean(bodies[str(n)]) for n in range(1, 5)),
                'sections': sections}
        return fingerprint, exam, choices
    except (TypeError,ValueError,KeyError):
        return None


def exam_parts(source: str | None, questions: list[dict]) -> dict | None:
    if not source or len(questions)!=40:return None
    pinned=pinned_exam_parts(source)
    if not pinned or pinned[0] != source_signature(questions, 'number', 'section', 'text'):
        return None
    _, parts, choices = pinned
    for q in questions:
        expected = choices.get(q['number'])
        if expected is not None and (
            len(expected) != len(q['options']) or
            any(normalized_choice(text, code) != label for (code, label), text in zip(expected, q['options']))
        ):
            return None
    return parts
