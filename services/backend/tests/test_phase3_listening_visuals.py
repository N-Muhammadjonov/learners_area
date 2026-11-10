from app.listening_exam_visuals import source_map,svg_diagram

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
