from app.listening_exam_visuals import exam_parts, pinned_exam_parts, source_map, svg_diagram


def test_all_remaining_canonical_packages_keep_their_own_original_exam_layout():
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    for number in range(2, 33):
        package = json.loads((root / f'content/listening/academic/test-{number:02d}/canonical.json').read_text())
        source = f'listening-test-{number}'
        exam = exam_parts(source, package['content']['questions'])
        assert exam is not None, source
        assert exam == pinned_exam_parts(source)[1], source

def test_existing_authored_maps_are_inert_and_source_exact_geometry():
    for source,count in [('listening-test-1',23),('listening-test-11',44)]:
        diagram=source_map(source)
        assert len(diagram['shapes'])==count
        assert diagram['viewBox'][2]>100
        assert all(s['tag'] in ('path','rect','circle','ellipse','line','polyline','polygon','text') for s in diagram['shapes'])
        assert all('answer' not in s and 'key' not in s for s in diagram['shapes'])
    assert any(s.get('transform')=='translate(30,40)' for s in source_map('listening-test-11')['shapes'])

def test_svg_never_exposes_scripts_urls_or_arbitrary_attributes():
    diagram=svg_diagram('<svg viewBox="0 0 200 100"><script>secret()</script><foreignObject>hidden</foreignObject><rect x="5" onclick="bad()" fill="url(https://evil.test)"/><text x="1">A</text></svg>')
    assert [s['tag'] for s in diagram['shapes']]==['rect','text']
    assert diagram['shapes'][0]=={'tag':'rect','x':'5'}
    assert source_map('../../private') is None
    assert svg_diagram('<svg viewBox="NaN 0 2 3"></svg>') is None


def test_cd_layout_for_every_pinned_full_exam_is_key_free():
    import re

    for test in range(1, 33):
        source = f'listening-test-{test}'
        signature, exam, choices = pinned_exam_parts(source)
        questions = [
            {'number': number, 'section': section, 'text': text,
             'options': [f'{code}) {label}' for code, label in choices.get(number, ())]}
            for number, section, text in signature
        ]
        assert len(exam['parts']) == 4 and len(exam['sections']) == 4
        assert exam_parts(source, questions) == exam
        assert '.exam-header' in exam['style'] and '.bottom-navigation' in exam['style']
        for id in ('examRoot', 'startTestBtn', 'examInterface', 'timerDisplay', 'bottomNav', 'examQuestionHost', 'notesBtn', 'flagBtn', 'optionsBtn', 'highlightBtn'):
            assert f'id="{id}"' in exam['shell']
        for part in [exam['shell'], *exam['parts']]:
            assert not re.search(r'<(?:script|iframe|object|foreignObject)\b|\s(?:on\w+|data-(?:key|correct|answer))=', part, re.I)
            assert not any('value=' in tag for tag in re.findall(r'<input\b[^>]*>', part, re.I)
                           if not re.search(r'type="(?:radio|checkbox)"', tag))
        questions[0]['text'] += ' revised'
        assert exam_parts(source, questions) is None
        questions[0]['text'] = signature[0][2]
        first_choice = next(q for q in questions if q['options'])
        first_choice['options'][0] = 'Changed choice'
        assert exam_parts(source, questions) is None


def test_cd_layout_keeps_the_original_map_at_its_question_location():
    _, first, _ = pinned_exam_parts('listening-test-1')
    _, last, _ = pinned_exam_parts('listening-test-32')
    assert any('<svg' in part and 'viewBox=' in part for part in first['parts'])
    assert '<img' in last['parts'][1] and 'Outdoor Education Centre map' in last['parts'][1]
    assert 'data:image/' not in last['parts'][1]
