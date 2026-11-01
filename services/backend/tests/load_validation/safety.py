"""Fail before connection setup unless this is the disposable Docker target."""
import os
from urllib.parse import urlsplit


def guard():
    target=urlsplit(os.environ.get('DATABASE_URL',''))
    assert (os.getenv('LOAD_TEST_ONLY')=='1' and target.scheme in ('postgres','postgresql')
            and target.hostname=='db' and target.port in (None,5432)
            and target.path=='/learners_load' and not target.query and not target.fragment), 'isolated synthetic database required'
