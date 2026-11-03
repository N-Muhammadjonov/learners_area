"""Private, bounded document assistance. File text is data, never system instructions."""
import base64
import ctypes
import io
import itertools
import re
import threading
import zipfile
from pathlib import Path

MAX_TEXT = 120_000
MAX_SOURCE_BYTES = 3_000_000
KINDS = ('pdf', 'docx', 'txt', 'md', 'html', 'csv', 'json', 'image')
_EXPORT_LOCK = threading.Lock()  # PDFium's process-wide native state is not thread safe.


def validate_attachments(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 4:
        raise ValueError('invalid_attachments')
    result = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {'name', 'kind', 'text'}:
            raise ValueError('invalid_attachments')
        name, kind, text = item['name'], item['kind'], item['text']
        if (not isinstance(name, str) or not 1 <= len(name) <= 160
                or any(ord(c) < 32 for c in name) or '/' in name or '\\' in name
                or kind not in KINDS or not isinstance(text, str)
                or not text.strip() or len(text) > 60_000 or '\x00' in text):
            raise ValueError('invalid_attachments')
        result.append({'name': name, 'kind': kind, 'text': text})
    if sum(len(x['text']) for x in result) > MAX_TEXT:
        raise ValueError('attachments_text_limit')
    return result


async def gate(conn, actor):
    from .riwi_capabilities import authorize_capability
    if not authorize_capability(actor, 'riwi.chat.self').allowed:
        raise PermissionError('forbidden')
    if actor.role == 'student':
        # Same exact active-assessment boundary as canonical material assistance.
        from .riwi_materials import gate as material_gate
        await material_gate(conn, actor, 'writing')


def requested_format(message):
    matches = list(re.finditer(r'\b(pdf|docx|txt)(?:ni|ga|da|dan|lar(?:ni|ga|da)?)?\b', message, re.I))
    match = matches[-1] if matches else None
    action = re.search(r'yarat|tayyorla|qilib\s*ber|chiqar|yukla|create|export|download|make|save|convert', message, re.I)
    if action and re.search(r'\bword(?:ni|ga|da)?\b',message,re.I) and re.search(r'fayl|hujjat|file|document',message,re.I): return 'docx'
    return match.group(1).lower() if match and action else None


def replacement_request(message):
    if not re.search(r'almashtir|o.zgartir|replace|change', message, re.I):
        return None
    values = re.findall(r'"([^"\n]*)"|“([^”\n]*)”|‘([^’\n]*)’|\'([^\'\n]*)\'', message)
    values = [next((v for v in parts if v), '') for parts in values]
    if len(values) != 2 or not values[0] or any(len(v) > 2000 for v in values):
        return None
    return values[0], values[1]


def answer_request(message, attachments, locale):
    """Extract/quote or propose an explicit edit. Never execute instructions in files."""
    uz = locale == 'uz'
    fmt = requested_format(message)
    if not attachments:
        # Explicit supplied content creates a file without relying on a model.
        if fmt and ':' in message and requested_format(message.split(':', 1)[0]):
            text = message.split(':', 1)[1].strip()
            if text:
                return {'answer': 'Yangi hujjat matni tayyor 🙂' if uz else 'The new document text is ready 🙂',
                        'action': {'mode': 'create', 'format': fmt, 'text': text}}
        return None
    selected = 0
    for i, item in enumerate(attachments):
        if item['name'].casefold() in message.casefold():
            selected = i
            break
    item = attachments[selected]
    # Explicit standalone sentences retain the canonical tutor, even with a file staged.
    file_reference = re.search(r'fayl|hujjat|rasm|matn|\bfile\b|document|image|pdf|docx',message,re.I) or any(x['name'].casefold() in message.casefold() for x in attachments)
    if not file_reference:
        from .riwi_understanding import text_request
        from .riwi_internal_tutor import correction_request
        if text_request(message) or correction_request(message): return None
    if re.search(r'tarjima|translate',message,re.I) and not ':' in message:
        return {'answer': ('Qaysi jumlani tarjima qilay? Fayldagi jumlani tanlab chatga yozing. Yangi uzun matnni erkin tarjima qilish bilim doiramdan tashqarida; bilgan tuzilma va lug‘at bilan yordam beraman.' if uz else
                          'Which sentence should I translate? Copy it from the file into chat. Free translation of a new long document is outside my current rule library; I can help with supported structures and vocabulary.')}
    change = replacement_request(message)
    if change:
        old, new = change
        count = item['text'].count(old)
        if not count:
            return {'answer': 'Bu aniq matn faylda topilmadi. Almashtiriladigan matnni fayldan aynan ko‘chirib yozing.' if uz else
                    'That exact text was not found. Copy the text to replace exactly from the file.'}
        output = fmt or (item['kind'] if item['kind'] in ('pdf', 'docx', 'txt') else 'txt')
        preserve = item['kind'] in ('pdf', 'docx') and output == item['kind']
        action = {'mode': 'replace' if preserve else 'create', 'format': output,
                  'attachmentIndex': selected, 'find': old, 'replacement': new,
                  'text': item['text'].replace(old, new)}
        return {'answer': (f'{count} ta almashtirish tayyorlandi. Tahrirlangan nusxa alohida fayl bo‘ladi.' if uz else
                           f'{count} replacements prepared. The edited copy will be a separate file.'), 'action': action}
    if fmt:
        return {'answer': 'Fayl matnidan yangi nusxa tayyorlandi 🙂' if uz else 'A new copy of the file text is ready 🙂',
                'action': {'mode': 'create', 'format': fmt, 'text': item['text'], 'attachmentIndex': selected}}
    if re.search(r'tahrir|tuzat|edit|correct', message, re.I):
        return {'answer': ('Qaysi matnni qanday o‘zgartiray? Masalan: “I am agree” ni “I agree” ga almashtir. '
                           'Matn muharririda ham o‘zingiz tahrir qilib, TXT, DOCX yoki PDF nusxa olishingiz mumkin.' if uz else
                          'What should change? For example: replace “I am agree” with “I agree”. '
                          'You can also edit the text in the document editor and export TXT, DOCX or PDF.')}
    lines = [x.strip() for x in re.split(r'\n\s*\n|\n', item['text']) if x.strip()]
    from .riwi_uzbek import normalize_query
    stop = {'fayl', 'file', 'pdf', 'docx', 'txt', 'haqida', 'bilan', 'nima', 'qanday', 'qilib', 'ber',
            'shu', 'this', 'that', 'what', 'does', 'the', 'and', 'from', 'please', 'tushuntir', 'explain', 'yozilgan'}
    words = set(normalize_query(message).split()) - stop
    ranked = sorted(enumerate(lines), key=lambda pair: (-len(words & set(normalize_query(pair[1]).split())), pair[0]))
    summary = bool(re.search(r'xulosa|mazmun|o.qib|nima\s+(?:haqida|bor|deyil|yozil)|asosiy\s+(?:mazmun|fikr)|what.*(?:about|contain)|main.*(?:idea|point)|summari|summary|read|content', message, re.I))
    if summary:
        chosen = lines[:6]
    else:
        chosen = [line for _, line in ranked[:4] if words & set(normalize_query(line).split())]
    if not chosen:
        return {'answer': ('Faylni o‘qidim, lekin savolingizga aniq bog‘liq bo‘lakni topa olmadim. '
                           'Qaysi jumla yoki masalani tushuntirishimni yozing.' if uz else
                          'I read the file but could not locate a passage that answers your question. '
                          'Specify the sentence or issue you want to discuss.')}
    heading = ('Fayldagi matndan ajratilgan mazmun' if summary else 'Savolingizga yaqin matn bo‘laklari') if uz else (
        'Extracted file content' if summary else 'Passages related to your question')
    note = ('Bu fayldan olingan matn; uning da’volarini mustaqil tekshirilgan fakt deb olmayman.' if uz else
            'These are excerpts from your file; its claims have not been independently verified.')
    return {'answer': heading + ' 🙂\n\n' + '\n\n'.join(x[:1000] for x in chosen)[:4800] + '\n\n' + note}


def _source(value):
    if not isinstance(value, str) or len(value) > (MAX_SOURCE_BYTES * 4 // 3 + 8):
        raise ValueError('source_file_limit')
    try:
        data = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise ValueError('invalid_source_file') from exc
    if not data or len(data) > MAX_SOURCE_BYTES:
        raise ValueError('source_file_limit')
    return data


def edit_docx(data, old, new):
    from lxml import etree
    try: source = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc: raise ValueError('invalid_docx') from exc
    infos = source.infolist()
    if (len(infos) > 2000 or len({x.filename for x in infos}) != len(infos)
            or sum(x.file_size for x in infos) > 40_000_000
            or any(x.flag_bits & 1 for x in infos)
            or 'word/document.xml' not in source.namelist()
            or any('vbaproject' in x.filename.lower() for x in infos)):
        raise ValueError('invalid_docx')
    changed, count = {}, 0
    for info in infos:
        if not re.fullmatch(r'word/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml', info.filename):
            continue
        xml = source.read(info)
        if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
            raise ValueError('invalid_docx')
        try: root = etree.fromstring(xml, etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False))
        except etree.XMLSyntaxError as exc: raise ValueError('invalid_docx') from exc
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        local = 0
        for paragraph in root.xpath('.//w:p', namespaces=ns):
            nodes = paragraph.xpath('.//w:t', namespaces=ns)
            text = ''.join(n.text or '' for n in nodes)
            if len(text)>MAX_TEXT: raise ValueError('document_replace_limit')
            matches = list(itertools.islice(re.finditer(re.escape(old), text),2001))
            if count+local+len(matches)>2000 or (count+local+len(matches))*max(0,len(new)-len(old))>MAX_TEXT:
                raise ValueError('document_replace_limit')
            # Work backwards so earlier offsets stay valid, preserving runs, tables and drawings.
            for match in reversed(matches):
                start, end = match.span()
                offset = 0
                for node in nodes:
                    value = node.text or ''
                    left, right = offset, offset + len(value)
                    offset = right
                    if right <= start or left >= end:
                        continue
                    first = left <= start < right
                    node.text = value[:max(0, start-left)] + (new if first else '') + value[min(len(value), end-left):]
                    node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                local += 1
        if local:
            count += local
            changed[info.filename] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    if not count:
        raise ValueError('replacement_not_found')
    target = io.BytesIO()
    with zipfile.ZipFile(target, 'w') as archive:
        for info in infos:
            archive.writestr(info, changed.get(info.filename, source.read(info)))
    return target.getvalue(), count


def edit_pdf(data, old, new):
    """Replace supported whole text-object spans; never paint an opaque cover over old text."""
    import pypdfium2 as pdfium
    raw = pdfium.raw
    try: document = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc: raise ValueError('invalid_pdf') from exc
    try:
        if len(document) > 50 or raw.FPDF_GetSignatureCount(document) or raw.FPDFDoc_GetJavaScriptActionCount(document):
            raise ValueError('pdf_layout_edit_unsupported')
        count = 0
        for page in document:
            try:
                textpage = page.get_textpage()
                objects = list(page.get_objects(filter=[raw.FPDF_PAGEOBJ_TEXT], max_depth=1, textpage=textpage))
                if len(objects) > 4000:
                    raise ValueError('pdf_layout_edit_unsupported')
                edits = []
                for obj in objects:
                    text = obj.extract()
                    if old not in text:
                        continue
                    matrix = obj.get_matrix()
                    if abs(matrix.b) > .001 or abs(matrix.c) > .001 or not new:
                        raise ValueError('pdf_layout_edit_unsupported')
                    if len(text)>MAX_TEXT or count+text.count(old)>2000 or text.count(old)*max(0,len(new)-len(old))>MAX_TEXT:
                        raise ValueError('document_replace_limit')
                    replacement = text.replace(old, new)
                    # Unknown glyphs are a reason to offer a new document, never a missing-glyph PDF.
                    font = obj.get_font()
                    for ch in replacement:
                        width = ctypes.c_float()
                        if not raw.FPDFFont_GetGlyphWidth(font, ord(ch), obj.get_font_size(), ctypes.byref(width)):
                            raise ValueError('pdf_layout_edit_unsupported')
                    left, bottom, right, top = obj.get_bounds()
                    limit = min([other.get_bounds()[0] for other in objects
                                 if other is not obj and other.get_bounds()[0] > right
                                 and other.get_bounds()[1] < top and other.get_bounds()[3] > bottom]
                                + [page.get_width() - 24])
                    edits.append((obj, replacement, limit, text.count(old)))
                textpage.close()
                for obj, text, limit, n in edits:
                    encoded = text.encode('utf-16-le') + b'\0\0'
                    buffer = (ctypes.c_ushort * (len(encoded)//2)).from_buffer_copy(encoded)
                    if not raw.FPDFText_SetText(obj, buffer) or obj.get_bounds()[2] > limit:
                        raise ValueError('pdf_layout_edit_unsupported')
                    count += n
                if edits:
                    page.gen_content()
            finally:
                page.close()
        if not count:
            raise ValueError('pdf_layout_edit_unsupported')
        output = io.BytesIO()
        document.save(output, flags=raw.FPDF_NO_INCREMENTAL)
        return output.getvalue(), count
    finally:
        document.close()


def create_pdf(text):
    from html import escape
    import unicodedata
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    font_path = Path(__file__).resolve().parents[1]/'assets/fonts/DejaVuSans.ttf'
    font = TTFont('RIWI-DejaVuSans', str(font_path))
    pdfmetrics.registerFont(font)
    supported = font.face.charToGlyph
    clean = []
    for char in text:
        if char.isspace() or ord(char) in supported:
            clean.append(char)
        elif unicodedata.category(char) in ('So', 'Mn', 'Cf'):
            continue  # Decorative emoji have no glyph in the bundled document font.
        else:
            raise ValueError('document_glyph_unsupported')
    stream = io.BytesIO()
    document = SimpleDocTemplate(stream, pagesize=(595,842),leftMargin=45,rightMargin=45,topMargin=42,bottomMargin=42,
                                 title='RIWI document',author='RIWI')
    style = ParagraphStyle('RIWI',fontName='RIWI-DejaVuSans',fontSize=11,leading=17,spaceAfter=6)
    story = [Paragraph(escape(line),style) if line.strip() else Spacer(1,10) for line in ''.join(clean).splitlines()]
    document.build(story)
    return stream.getvalue()


def export_document(payload):
    if not isinstance(payload, dict) or set(payload) - {'format', 'mode', 'text', 'sourceBase64', 'find', 'replacement'}:
        raise ValueError('invalid_document_export')
    fmt, mode = payload.get('format'), payload.get('mode')
    if fmt not in ('txt', 'docx', 'pdf') or mode not in ('create', 'replace'):
        raise ValueError('invalid_document_export')
    count = None
    with _EXPORT_LOCK:
        if mode == 'replace':
            old, new = payload.get('find'), payload.get('replacement')
            if not isinstance(old, str) or not old or not isinstance(new, str) or max(len(old), len(new)) > 2000:
                raise ValueError('invalid_replacement')
            data = _source(payload.get('sourceBase64'))
            if fmt == 'docx' and data.startswith(b'PK'):
                content, count = edit_docx(data, old, new)
            elif fmt == 'pdf' and data.startswith(b'%PDF-'):
                content, count = edit_pdf(data, old, new)
            else:
                raise ValueError('invalid_source_file')
        else:
            text = payload.get('text')
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT or '\x00' in text:
                raise ValueError('invalid_document_text')
            if fmt == 'txt':
                content = text.encode('utf-8')
            elif fmt == 'docx':
                from docx import Document
                document = Document()
                document.core_properties.title = 'RIWI document'
                for line in text.splitlines():
                    document.add_paragraph(line)
                stream = io.BytesIO()
                document.save(stream)
                content = stream.getvalue()
            else:
                content = create_pdf(text)
    if len(content) > MAX_SOURCE_BYTES:
        raise ValueError('document_output_limit')
    mime = {'txt': 'text/plain;charset=utf-8', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'pdf': 'application/pdf'}[fmt]
    return {'name': 'RIWI-document.'+fmt, 'mime': mime, 'base64': base64.b64encode(content).decode(),
            'replacementCount': count, 'layoutPreserved': mode == 'replace'}
