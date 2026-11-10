import asyncio
from uuid import UUID
import pytest
from fastapi import HTTPException
from app.listening_revision import revision_package,revision_rows

TEST=UUID(int=21)
PACKAGE={'questions':[{'number':1,'text':'Original prompt','key':'A','options':['A. Original choice'],'alternatives':[],'evidence':{'why':'Original explanation'}}]}
ROW={'id':UUID(int=22),'order':1,'question_text':'Original prompt','correct_answer':'A. Original choice','explanation':'Legacy explanation'}

def test_matching_revision_preserves_question_identity_and_source_explanation():
    row=revision_rows(PACKAGE,[ROW])[0]
    assert row['id']==ROW['id']
    assert row['correct_answer']==ROW['correct_answer']
    assert row['explanation']=='Original explanation'

@pytest.mark.parametrize('change',[{'question_text':'Changed prompt'},{'correct_answer':'B'}])
def test_legacy_fallback_with_changed_assessment_is_held(change):
    with pytest.raises(HTTPException) as error:revision_rows(PACKAGE,[{**ROW,**change}])
    assert error.value.status_code==409
    assert error.value.detail=='content_revision_unavailable'

@pytest.mark.parametrize('record',[None,{'target_id':UUID(int=99),'content_snapshot':PACKAGE}])
def test_missing_or_foreign_snapshot_never_falls_back_to_current_content(record):
    class Connection:
        async def fetchrow(self,*args):return record
    with pytest.raises(HTTPException) as error:
        asyncio.run(revision_package(Connection(),{'content_version_id':UUID(int=23),'test_id':TEST},PACKAGE))
    assert error.value.status_code==409

def test_unversioned_legacy_attempt_retains_existing_package_contract():
    assert asyncio.run(revision_package(None,{'content_version_id':None},PACKAGE)) is PACKAGE
