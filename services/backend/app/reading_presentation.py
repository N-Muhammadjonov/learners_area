"""Source-exact, inert Reading presentation, served only inside authorized DTOs."""
import json
from functools import lru_cache
from pathlib import Path

@lru_cache(maxsize=1)
def presentations():
    path=Path(__file__).resolve().parents[1]/'assets/reading-cd/presentations.json'
    return json.loads(path.read_text()) if path.exists() else {}

def for_passage(passage_id):
    return presentations().get(str(passage_id),{})
