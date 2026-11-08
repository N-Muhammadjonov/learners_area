import re
from app import main as core,step21_reading_port as reading
from app.reading_presentation import presentations

def rows():
 return [{'id':'first','question_no':20,'correct_answer':'C','options':['A','B','C','D','E'],'answer_constraint':{'source_multi_group':'own-source'}},
         {'id':'second','question_no':21,'correct_answer':'E','options':['A','B','C','D','E'],'answer_constraint':{'source_multi_group':'own-source'}}]

def test_unordered_source_selection_keeps_partial_credit_and_no_duplicate_points():
 assert reading.align_source_choices(rows(),{'first':'E','second':'C'})=={'first':'C','second':'E'}
 assert reading.align_source_choices(rows(),{'first':'A','second':'C'})=={'first':'C','second':'A'}
 assert reading.align_source_choices(rows(),{'first':'C','second':'C'})=={'first':'C','second':''}

def test_regular_answer_identity_is_unchanged():
 assert reading.align_source_choices([{'id':'own','answer_constraint':{}}],{'own':'exact text'})=={'own':'exact text'}

def test_source_presentations_are_inert_and_have_no_grading_payload():
 data=presentations();assert len(data)==73
 for p in data.values():
  text=p['passageHtml']+''.join(p['groups'].values())
  assert not re.search(r'<(?:script|iframe|object)|\son[a-z]+\s*=|javascript:|correct_answer|LA_EXPLANATIONS',text,re.I)
  assert p['groups']
