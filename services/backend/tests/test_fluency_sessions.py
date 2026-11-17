"""Topic tiers, complete topics, exclusions and exact Part 2–3 pairing."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.fluency_sessions import choose_session, topic_level, LEVELS


def bank():
    rows=[]
    for level,numbers,pair in [('beginner',(1,2,3,4),2),('intermediate',(11,12,13,14),1),('advanced',(15,27,28,29),4)]:
        for n in numbers:
            for q in range(2):
                rows.append({'id':f'{level}-{n}-{q}','part':'part1','topic':f'{n:03}. Topic {n}','prompt_text':f'Question {n}-{q}'})
        rows.append({'id':f'{level}-p2','part':'part2','topic':f'{pair:03}. Topic','prompt_text':'Describe the topic.','external_id':f's166-{pair:03}-part2-00','follow_ups':['Why?','How?']})
        for q,text in enumerate(['Why?','How?']):
            rows.append({'id':f'{level}-p3-{q}','part':'part3','topic':f'{pair:03}. Discussion','prompt_text':text,'external_id':f's166-{pair:03}-part3-0{q}'})
    return rows


class FluencySessionsTests(unittest.TestCase):
    def test_every_level_gets_three_complete_topics_and_its_own_pair(self):
        rows=bank();before=copy.deepcopy(rows)
        for level in LEVELS:
            with self.subTest(level=level),patch('secrets.choice',side_effect=lambda items:items[0]):
                session=choose_session(rows,level)
                self.assertEqual([q['part'] for q in session],['part1']*6+['part2','part3','part3'])
                self.assertEqual(len({q['topic'] for q in session[:6]}),3)
                self.assertTrue(all(q['id'].startswith(level) and q['difficulty']==level for q in session))
        self.assertEqual(rows,before)

    def test_unknown_level_and_unassigned_questions_fail_closed(self):
        with self.assertRaisesRegex(ValueError,'invalid_level'):choose_session(bank(),'unknown')
        self.assertIsNone(topic_level({'part':'part1','topic':'Unassigned'}))
        with self.assertRaisesRegex(ValueError,'question_empty'):choose_session([], 'beginner')

    def test_explicit_editorial_assignment_takes_priority(self):
        self.assertEqual(topic_level({'part':'part1','topic':'001. Home','study_support':{'fluencyLevel':'advanced'}}),'advanced')

    def test_unrelated_part3_and_recent_topics_are_not_selected(self):
        rows=bank()
        rows.append({'id':'unrelated','part':'part3','topic':'002. Food','prompt_text':'Why?','external_id':'s166-099-part3-01'})
        session=choose_session(rows,'beginner',{'beginner-1-0'})
        self.assertNotIn('beginner-1-0',[q['id'] for q in session])
        self.assertNotIn('unrelated',[q['id'] for q in session])

if __name__=='__main__':unittest.main()
