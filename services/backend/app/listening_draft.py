"""Opaque native Listening draft token, including playback resume position."""
from .reading_draft import draft_hash

def listening_draft_hash(answers,position):
    return draft_hash({'answers':answers,'audioPosition':float(position or 0)})
