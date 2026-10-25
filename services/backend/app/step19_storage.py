"""Storage deletion adapter: the original local, R2 and S3 object semantics.
Private object keys remain validated and never become public URLs.
"""
from __future__ import annotations
import asyncio,os,re
from pathlib import Path

SAFE=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._/-]*$')
def valid_key(key):
    return isinstance(key,str) and 0<len(key)<=400 and bool(SAFE.fullmatch(key)) and '..' not in key and all(segment and segment!='.' for segment in key.split('/'))

def provider():
    selected=(os.getenv('STORAGE_PROVIDER') or ('' if os.getenv('NODE_ENV')=='production' else 'local')).lower().strip()
    if selected not in ('local','r2','s3'):
        raise RuntimeError('STORAGE_PROVIDER must be local, r2 or s3')
    return selected

async def delete_object(key):
    if not valid_key(key):raise ValueError('unsafe storage key')
    kind=provider()
    if kind=='local':
        root=Path(os.getenv('STORAGE_LOCAL_DIR') or '.data/uploads').resolve()
        location=root.joinpath(*key.split('/'))
        try:await asyncio.to_thread(location.unlink)
        except FileNotFoundError:pass
        return
    import boto3
    bucket=os.getenv('R2_BUCKET_NAME') or os.getenv('S3_BUCKET')
    access=os.getenv('R2_ACCESS_KEY_ID') or os.getenv('S3_ACCESS_KEY_ID')
    secret=os.getenv('R2_SECRET_ACCESS_KEY') or os.getenv('S3_SECRET_ACCESS_KEY')
    if not all((bucket,access,secret)):raise RuntimeError('Storage credentials missing')
    endpoint=os.getenv('R2_ENDPOINT') or os.getenv('S3_ENDPOINT')
    region=os.getenv('R2_REGION') or os.getenv('S3_REGION') or 'auto'
    def task():
        s3=boto3.client('s3',region_name=region,aws_access_key_id=access,
                        aws_secret_access_key=secret,endpoint_url=endpoint)
        s3.delete_object(Bucket=bucket,Key=key)
    await asyncio.to_thread(task)

async def head_object(key):
    """Storage HEAD metadata (local or S3-compatible), without exposing the bytes."""
    if not valid_key(key):raise ValueError('unsafe storage key')
    if provider()=='local':
        root=Path(os.getenv('STORAGE_LOCAL_DIR') or '.data/uploads').resolve()
        file=root.joinpath(*key.split('/'))
        try:
            st=await asyncio.to_thread(file.stat)
            return {'size':st.st_size,'contentType':None} if file.is_file() else None
        except OSError:return None
    import boto3
    s3,bucket=_client()
    def task():
        try:
            result=s3.head_object(Bucket=bucket,Key=key)
            return {'size':int(result['ContentLength']),'contentType':result.get('ContentType'),
                'etag':result.get('ETag'),'lastModified':result.get('LastModified')}
        except s3.exceptions.ClientError as exc:
            if exc.response.get('Error',{}).get('Code') in ('404','NoSuchKey','NotFound'):return None
            raise
    return await asyncio.to_thread(task)


def _client():
    import boto3
    bucket=os.getenv('R2_BUCKET_NAME') or os.getenv('S3_BUCKET')
    access=os.getenv('R2_ACCESS_KEY_ID') or os.getenv('S3_ACCESS_KEY_ID')
    secret=os.getenv('R2_SECRET_ACCESS_KEY') or os.getenv('S3_SECRET_ACCESS_KEY')
    if not all((bucket,access,secret)):raise RuntimeError('Storage credentials missing')
    endpoint=os.getenv('R2_ENDPOINT') or os.getenv('S3_ENDPOINT')
    region=os.getenv('R2_REGION') or os.getenv('S3_REGION') or 'auto'
    return boto3.client('s3',region_name=region,aws_access_key_id=access,
        aws_secret_access_key=secret,endpoint_url=endpoint),bucket

async def read_object(key,start=None,end=None):
    """Bounded byte range. In production S3 read is confined to the requested bytes."""
    if not valid_key(key):raise ValueError('unsafe storage key')
    if provider()=='local':
        root=Path(os.getenv('STORAGE_LOCAL_DIR') or '.data/uploads').resolve()
        file=root.joinpath(*key.split('/'))
        def task():
            try:
                with file.open('rb') as f:
                    if start is not None:f.seek(start)
                    return f.read(end-start+1 if start is not None and end is not None else -1)
            except FileNotFoundError:return None
        return await asyncio.to_thread(task)
    s3,bucket=_client()
    def task():
        kw={'Bucket':bucket,'Key':key}
        if start is not None and end is not None:kw['Range']=f'bytes={start}-{end}'
        try:
            result=s3.get_object(**kw)
            try:return result['Body'].read()
            finally:result['Body'].close()
        except s3.exceptions.ClientError as e:
            if e.response.get('Error',{}).get('Code') in ('404','NoSuchKey','NotFound'):return None
            raise
    return await asyncio.to_thread(task)
