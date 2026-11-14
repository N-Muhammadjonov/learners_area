"""The learner's General Reading default folder is named after the passage."""
import asyncio
from uuid import UUID

from app.step21_vocab_batch import add_batch

USER = UUID("11111111-1111-4111-8111-111111111111")
PASSAGE = UUID("22222222-2222-4222-8222-222222222222")
FOLDER = UUID("33333333-3333-4333-8333-333333333333")


class FolderConnection:
    def __init__(self, title: str = "A brief history of canned food") -> None:
        self.title = title
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *args: object) -> dict[str, object]:
        self.calls.append((query, args))
        assert "SELECT id FROM users" in query
        assert args == (USER,)
        return {"id": USER}

    async def fetchval(self, query: str, *args: object) -> object:
        self.calls.append((query, args))
        if "SELECT title FROM reading_passages" in query:
            assert args == (PASSAGE,)
            return self.title
        if "INSERT INTO vocab_folders" in query:
            assert args == (USER, self.title)
            return FOLDER
        if "SELECT id FROM vocab_folders" in query:
            assert args == (FOLDER, USER)
            return FOLDER
        raise AssertionError("Unexpected folder query")

    async def fetch(self, query: str, *args: object) -> list[object]:
        self.calls.append((query, args))
        assert "FROM user_vocabulary" in query
        return []

    async def execute(self, query: str, *args: object) -> str:
        self.calls.append((query, args))
        assert "INSERT INTO activity_events" in query
        return "INSERT 0 1"


def test_unspecified_reading_folder_uses_exact_passage_name() -> None:
    con = FolderConnection()
    result = asyncio.run(add_batch(
        con, USER, [], source_type="reading", source_id=PASSAGE
    ))
    assert result["ok"] is True
    inserts = [args for query, args in con.calls if "INSERT INTO vocab_folders" in query]
    assert inserts == [(USER, "A brief history of canned food")]


def test_selected_folder_is_never_overridden() -> None:
    con = FolderConnection()
    result = asyncio.run(add_batch(
        con, USER, [], source_type="reading",
        source_id=PASSAGE, folder_id=FOLDER
    ))
    assert result["ok"] is True
    assert not any("INSERT INTO vocab_folders" in query for query, _ in con.calls)
    assert not any("SELECT title FROM reading_passages" in query
                   for query, _ in con.calls)
