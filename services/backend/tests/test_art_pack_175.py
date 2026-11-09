"""Art pack contract: 175 exercises, seven named sections and production fallbacks."""
import asyncio
import json
import re
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch
from starlette.requests import Request
from app import step21_packs_port as port
from app.step21_vocab_batch import sense_key
from app.step19_vocab_games_port import builtin_ids, conditions, normalize
from app.vocabulary_flashcard_batches import source_groups, named_parts, batch_plan

APP=Path(__file__).resolve().parents[1]/"app"

def words():
    packs=json.loads((APP/"vocabulary_builtin_packs.json").read_text(encoding="utf-8"))
    return next(p["words"] for p in packs if p["id"]=="art")

def groups():
    return json.loads((APP/"vocabulary_pack_groups.json").read_text(encoding="utf-8"))["art"]

def test_every_art_entry_is_valid_for_games_and_translation():
    rows=words()
    assert len(rows)==175
    assert rows[0]["term"]=="the arts"
    assert rows[-1]["term"]=="a cult following"
    assert len({normalize(w["term"]) for w in rows})==175
    assert len({sense_key(w) for w in rows})==175
    for w in rows:
        assert set(w)=={"term","partOfSpeech","definitionEn","translationUz","example"}
        assert all(isinstance(v,str) and v.strip() for v in w.values())
        assert len(w["term"])<=120
        assert len(w["definitionEn"])<=500
        assert len(w["translationUz"])<=500
        assert len(w["example"])<=500
        # Current gap game blanks the full answer, not just an article-stripped substring.
        pattern=r"\\b"+re.escape(w["term"])+r"\\w*\\b"
        assert re.search(pattern,w["example"],flags=re.I),w["term"]
        # Choice, match, translation, gap, race and sentence-builder all need fields.
        assert normalize(w["term"]) and normalize(w["example"])
    assert "art" in builtin_ids()
    args=["student"]
    assert "uv.topic_pack=$2" in conditions("topic",None,"art",args)
    assert args==["student","art"]

def test_flashcard_groups_cover_all_175_without_loss():
    data=words()
    gs=groups()
    assert len(gs)==7
    assert [g["end"]-g["start"] for g in gs]==[24,8,31,22,27,30,33]
    assert gs[0]["start"]==0 and gs[-1]["end"]==175
    assert all(gs[i]["end"]==gs[i+1]["start"] for i in range(len(gs)-1))
    assert len({g["label"] for g in gs})==7
    source_groups.cache_clear()
    lookup=source_groups()
    rows=[]
    for i,w in enumerate(data):
        group=lookup[("art",sense_key(w))]
        assert group[2]==i
        assert group[1]==gs[group[0]]["label"]
        rows.append({"id":str(i+1),"topic_pack":"art","sense_key":sense_key(w),
                     "term":w["term"],"part_of_speech":w["partOfSpeech"],
                     "definition_en":w["definitionEn"]})
    parts=named_parts(rows)
    assert [label for label,_ in parts]==[g["label"] for g in gs]
    ids=[wid for _,part in parts for wid in part]
    assert ids==[str(i+1) for i in range(175)]
    batches=batch_plan(ids,{},parts)
    assert len(batches)==7
    assert sum(b["count"] for b in batches)==175
    assert batches[0]["unlocked"]
    assert all(not b["unlocked"] for b in batches[1:])

def test_add_art_works_when_other_published_packs_exist():
    actor=uuid.UUID(int=17)
    folder=uuid.UUID(int=18)
    class Con:
        async def __aenter__(self):return self
        async def __aexit__(self,*args):return False
        def transaction(self):return self
        async def fetchrow(self,sql,*args):
            if "FROM vocabulary_topic_packs" in sql:
                assert args==("art",)
                return None
            assert "FROM users WHERE id=$1 FOR UPDATE" in sql
            return {"id":actor}
        async def fetchval(self,sql,*args):
            if "FROM vocabulary_topic_packs" in sql:return uuid.UUID(int=19)
            assert "INSERT INTO vocab_folders" in sql
            assert args==(actor,"Art")
            return folder
        async def execute(self,sql,*args):
            assert args==(actor,"art",folder)
            return "UPDATE 0"
    class Pool:
        def acquire(self):return Con()
    async def run():
        with patch.object(port.core,"current_user",AsyncMock(return_value={"id":actor})),\
             patch.object(port.core,"payload",AsyncMock(return_value={"packId":"art"})),\
             patch.object(port.core,"pool",AsyncMock(return_value=Pool())),\
             patch.object(port,"add_batch",AsyncMock(return_value={"ok":True,"added":175,"duplicates":0,"points":0})) as add:
            req=Request({"type":"http","method":"POST","path":"/api/vocabulary/packs",
                         "query_string":b"","headers":[],"scheme":"https","server":("test.invalid",443)})
            result=await port.add_pack(req)
            assert result.status_code==200
            assert json.loads(result.body)=={"ok":True,"added":175,"duplicates":0,"points":0}
            args,kwargs=add.call_args
            assert len(args[2])==175
            assert args[2][0]["term"]=="the arts"
            assert all(x["authored"] is True for x in args[2])
            assert kwargs=={"topic_pack":"art","source_type":"topic_pack","folder_id":folder}
    asyncio.run(run())
