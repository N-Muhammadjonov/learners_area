"""Mock authoring security and publication preflight checks."""
import asyncio, pathlib, sys, unittest, uuid
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_mock_hybrid_system import _ensure_lightweight_fastapi_stub
_ensure_lightweight_fastapi_stub()
from app import mock_system_port as mock
from app import mock_authoring_port as author
class Req:
 def __init__(self,body): self.body=body
 async def json(self): return self.body
class Tests(unittest.TestCase):
 def post(self,data,role='teacher'):
  async def auth(_): return {'id':uuid.uuid4(),'role':role}
  with patch.object(mock,'_auth_user',auth):return asyncio.run(author.save_mock_draft(Req(data)))
 def test_published_version(self):
  row={'publication_state':'published','module':'mock','content_type':'task1','track':'academic','content_snapshot':{'prompt':'Real prompt'}}
  self.assertTrue(author._eligible_version(row,'writing','task1','academic'))
  self.assertFalse(author._eligible_version({**row,'publication_state':'draft'},'writing','task1','academic'))
  self.assertFalse(author._eligible_version({**row,'module':'writing'},'writing','task1','academic'))
  self.assertFalse(author._eligible_version(row,'writing','task2','academic'))
  self.assertFalse(author._eligible_version(row,'writing','task1','general'))
  self.assertTrue(author._eligible_version({**row,'track':'unspecified'},'writing','task1','general'))
 def test_imported_json_validation(self):
  q=[{'id':str(i),'questionText':'Real item','correctAnswer':'A'} for i in range(40)]
  self.assertEqual(author._validate_material_payload('listening',{'questions':q},True),(None,None))
  self.assertEqual(author._validate_material_payload('reading',{'questions':q,'passages':[{'bodyText':'Real passage'}]},False),(None,None))
  self.assertEqual(author._validate_material_payload('writingTask2',{'prompt':'Actual essay prompt'},False),(None,None))
  self.assertEqual(author._validate_material_payload('listening',{'questions':q},False)[0],'missing_audio')
  self.assertEqual(author._validate_material_payload('writingTask1',{'prompt':'Graph prompt'},False)[0],'missing_task1_visual')
  self.assertEqual(author._validate_material_payload('reading',{'questions':q[:39],'passages':[{'bodyText':'Passage'}]},False)[0],'invalid_question_count')
  self.assertEqual(author._validate_material_payload('reading',{'questions':q,'passages':[]},False)[0],'missing_passages')
 def test_only_mock_module_allowed(self):
  row={'publication_state':'published','module':'mock','content_type':'listening','track':'academic','content_snapshot':{'questions':[]}}
  self.assertTrue(author._eligible_version(row,'listening',None,'academic'))
  self.assertFalse(author._eligible_version({**row,'module':'listening'},'listening',None,'academic'))
 def test_invalid_title(self):
  r=self.post({'title':'','track':'academic','sections':{}})
  self.assertEqual(r.status_code,422)
 def test_no_materials_publish(self):
  r=self.post({'title':'Weekly Mock','track':'academic','sections':{},'publish':True})
  self.assertEqual(r.status_code,422)
  self.assertIn(b'missing_sections',r.body)
 def test_admin_rejected(self):
  self.assertEqual(self.post({'title':'Weekly Mock','track':'academic','sections':{}},'admin').status_code,403)
 def test_invalid_binding_uuid(self):
  self.assertEqual(self.post({'title':'Weekly Mock','track':'academic','sections':{'reading':'nonsense'}}).status_code,422)
if __name__=='__main__':unittest.main()
