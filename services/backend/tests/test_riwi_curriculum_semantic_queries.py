"""New query variants from review, separate from the authored lesson fixtures."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.riwi_curriculum import choose_entry


@pytest.mark.parametrize("question,expected", [
    ("What is the difference between the past simple and the present perfect?", "grammar.past-simple-vs-present-perfect"),
    ("Compare present perfect with past simple.", "grammar.past-simple-vs-present-perfect"),
    ("Present perfect yoki past simple: qaysi birini tanlayman?", "grammar.past-simple-vs-present-perfect"),
    ("Past simple bilan present perfect orasidagi farq nima?", "grammar.past-simple-vs-present-perfect"),
    ("How do articles and countability interact?", None),
    ("Compare past simple with present perfect continuous.", None),
    ("Compare present perfect with past perfect.", None),
    ("Explain present perfect continuous to a beginner.", "grammar.present-perfect-continuous"),
    ("Teach present perfect progressive.", "grammar.present-perfect-continuous"),
    ("Present perfect continuous haqida soddaroq tushuntir.", "grammar.present-perfect-continuous"),
    ("How should I use the past perfect?", "grammar.past-perfect"),
    ("Teach reading multiple choice, please.", "reading.mcq_single"),
])
def test_question_selects_a_complete_topic_or_abstains(question, expected):
    assert choose_entry(question) == expected
