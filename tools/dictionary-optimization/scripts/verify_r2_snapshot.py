#!/usr/bin/env python3
"""Read immutable R2 bytes and compare with a captured PostgreSQL projection.

No database connection, Worker/R2 writes, cache purge or credential export.
A fresh channel/publisher recheck is required after this receipt is produced.
Uses the production decoder and ICU canonicalizer from the pinned checkout.
"""
import argparse,concurrent.futures,hashlib,json,os,sys,time
from pathlib import Path
import boto3
from botocore.config import Config

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'services/backend'))
from app.step40_dictionary_storage import decode_shard,decompress_bounded,ensure_key
from app.dictionary_canonical import stable

def sha(body):return hashlib.sha256(body).hexdigest()
def require(value,code):
 if not value:raise ValueError(code)
def identity(records):
 ordered=sorted(records,key=lambda e:e['lexeme_id'])
 ids=[e['lexeme_id'] for e in ordered]
 senses=sorted(s for e in ordered for s in e['sense_ids'])
 examples=sorted(x for e in ordered for x in e['example_ids'])
 require(len(ids)==len(set(ids)) and len(senses)==len(set(senses)) and len(examples)==len(set(examples)),'duplicate_identity')
 hashes=[e['lexeme_id']+':'+e['content_sha'] for e in ordered]
 return {'entries':len(ids),'senses':len(senses),'examples':len(examples),'entry_inventory_sha256':sha('\n'.join(hashes).encode()),'sense_set_sha256':sha(json.dumps(senses,separators=(',',':')).encode()),'example_set_sha256':sha(json.dumps(examples,separators=(',',':')).encode())}

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--projection',required=True);p.add_argument('--out',required=True)
 args=p.parse_args()
 projection=json.loads(Path(args.projection).read_text())
 require(len(projection)==2 and all(all(r[k] for k in ('entry_inventory_matches','sense_inventory_matches','example_inventory_matches')) for r in projection),'unverified_projection')
 result={'status':'RUNNING','scope':'protected_r2_bytes_and_captured_database_identity','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'databaseRecheckRequired':True,'r2Writes':0,'logicalReadCalls':0,'compressedBytes':0,'releases':[]}
 out=Path(args.out)
 def checkpoint():out.write_text(json.dumps(result,indent=2)+'\n')
 client=boto3.client('s3',endpoint_url=os.environ['R2_ENDPOINT'],aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],region_name=os.environ.get('R2_REGION','auto'),config=Config(connect_timeout=8,read_timeout=30,retries={'max_attempts':2},max_pool_connections=8))
 bucket=os.environ['R2_BUCKET_NAME'];require(bucket=='learners-area','unexpected_bucket')
 def read(key,limit):
  ensure_key(key);require(0<limit<=2*1024*1024,'object_size_limit')
  response=client.get_object(Bucket=bucket,Key=key)
  stream=response['Body']
  try:body=stream.read(limit+1)
  finally:stream.close()
  require(len(body)<=limit and response['ContentLength']==len(body),'object_size_mismatch')
  return body
 try:
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
   for row in projection:
    release=row['release_id'];body=read(f'dictionary/releases/{release}/manifest.json',2*1024*1024)
    require(sha(body)==row['manifest_sha'],'manifest_mismatch')
    manifest=json.loads(body);require(manifest['release_id']==release,'manifest_release_mismatch')
    result['logicalReadCalls']+=1;result['compressedBytes']+=len(body)
    records=[]
    for at in range(0,len(manifest['storage']['shards']),4):
     descriptors=manifest['storage']['shards'][at:at+4]
     bodies=list(executor.map(lambda d:read(f"dictionary/releases/{release}/shards/{d['shard']}.json.gz",d['compressed_bytes']),descriptors))
     for d,compressed in zip(descriptors,bodies):
      for entry in decode_shard(release,d,compressed):
       records.append({'lexeme_id':entry['lexeme_id'],'content_sha':sha(stable({k:v for k,v in entry.items() if k!='release_id'}).encode()),'sense_ids':[s['sense_id'] for s in entry['senses']],'example_ids':[x['example_id'] for s in entry['senses'] for x in s['examples']]})
      result['logicalReadCalls']+=1;result['compressedBytes']+=len(compressed)
     if at%32==0:checkpoint();print(json.dumps({'release':release,'verifiedShards':at+len(descriptors)}),flush=True)
    actual=identity(records)
    require(all(actual[k]==row[k] for k in actual),'database_projection_mismatch')
    require(all(actual[k]==manifest[k] for k in ('senses','examples','entry_inventory_sha256','sense_set_sha256','example_set_sha256')) and actual['entries']==manifest['lexemes'],'manifest_identity_mismatch')
    del records
    objects=manifest['storage']['search']['objects']
    for at in range(0,len(objects),4):
     descriptors=objects[at:at+4]
     bodies=list(executor.map(lambda d:read(f"dictionary/releases/{release}/search/{d['name']}.json.gz",d['compressed_bytes']),descriptors))
     for d,compressed in zip(descriptors,bodies):
      require(len(compressed)==d['compressed_bytes'] and sha(compressed)==d['sha256'],'index_checksum_mismatch')
      raw=decompress_bounded(compressed,d['raw_bytes'])
      require(len(raw)==d['raw_bytes'] and sha(raw)==d['raw_sha256'],'index_raw_checksum_mismatch')
      require(json.loads(raw)['release_id']==release,'index_identity_mismatch')
      result['logicalReadCalls']+=1;result['compressedBytes']+=len(compressed)
     if at%128==0:checkpoint();print(json.dumps({'release':release,'verifiedSearchObjects':at+len(descriptors)}),flush=True)
    result['releases'].append({'release':release,'manifestSha':row['manifest_sha'],'shards':len(manifest['storage']['shards']),'searchObjects':len(objects),**actual});checkpoint()
  result['status']='BYTES_VERIFIED_RECHECK_PENDING'
 except KeyboardInterrupt:
  result['status']='INTERRUPTED'
 except Exception as exc:
  result['status']='FAILED';result['errorType']=type(exc).__name__
 finally:
  result['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());checkpoint();print(json.dumps(result),flush=True)
 return 0 if result['status']=='BYTES_VERIFIED_RECHECK_PENDING' else 1

if __name__=='__main__':raise SystemExit(main())
