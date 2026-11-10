"""Fresh learner phrasing and negative cases, separate from content authoring."""
from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.riwi_study_library import choose_entry


@pytest.mark.parametrize('message,expected',[
 ('Otlashtirishni soddaroq tushuntirib ber','study.cambridge.unit-25'),
 ('Номинализация нима, учта мисол бер','study.cambridge.unit-25'),
 ('Nominalizatsiyadan misol ber','study.cambridge.unit-25'),
 ('Kembrij unit 12 ni tushuntir','study.cambridge.unit-12'),
 ('Cambrij unit 21 haqida','study.cambridge.unit-21'),
 ('How does hedging change the strength of a claim?','study.cambridge.unit-24'),
 ('Please explain introductory it with examples','study.cambridge.unit-21'),
 ('Guardian zoos level 1 bilan ishlaylik','study.guardian.zoos.pre-intermediate'),
 ('Explain Guardian colas at an advanced level','study.guardian.colas.advanced'),
 ('Guardian drug patents intermediate ni tushuntir','study.guardian.drug-patents.intermediate'),
 ('Compare Cambridge unit 1 with Cambridge unit 25',None),
 ('Compare Guardian waste and Guardian wind farms',None),
 ('Cambridge unit 100',None),
 ('Where are my car keys?',None),
 ('Is this historical article proof of current medical advice?',None),
])
def test_fresh_queries_preserve_topic_level_and_uncertainty(message,expected):
    assert choose_entry(message)==expected
