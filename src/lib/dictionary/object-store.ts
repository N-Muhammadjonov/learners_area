import "server-only";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { bytesHash, MAX_SHARD_COMPRESSED } from "./shards";

export interface DictionaryObjects {
  read(key: string, maxBytes: number): Promise<Buffer>;
  putImmutable(key: string, body: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
}
const safeKey = (key: string) => /^dictionary\/releases\/rel-v1-[a-f0-9]{24}\/(manifest\.json|shards\/[a-f0-9]{2}\.json\.gz)$/.test(key);
/** Backend-only transport. No signed URLs or arbitrary caller-provided paths. */
export function dictionaryObjects(): DictionaryObjects {
  if (process.env.STORAGE_PROVIDER !== "r2") throw Error("dictionary_r2_required");
  const bucket = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) throw Error("dictionary_storage_unavailable");
  const client = new S3Client({region:"auto", endpoint, forcePathStyle:true, maxAttempts:2, credentials:{accessKeyId,secretAccessKey}});
  const assert = (key:string) => {if (!safeKey(key)) throw Error("invalid_dictionary_key");};
  const read = async (key:string, maxBytes:number) => {
    assert(key);
    if (maxBytes < 1 || maxBytes > MAX_SHARD_COMPRESSED) throw Error("dictionary_object_limit");
    const result = await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)});
    if (!result.Body || (result.ContentLength ?? maxBytes + 1) > maxBytes) throw Error("dictionary_object_limit");
    const chunks:Buffer[]=[]; let size=0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size+=chunk.length;
      if(size>maxBytes) { (result.Body as {destroy?:()=>void}).destroy?.(); throw Error("dictionary_object_limit"); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };
  return {
    read,
    async putImmutable(key,body) {
      assert(key);
      if (body.length>MAX_SHARD_COMPRESSED) throw Error("dictionary_object_limit");
      try {
        await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,IfNoneMatch:"*",ContentType:key.endsWith(".gz")?"application/gzip":"application/json",CacheControl:"private, max-age=31536000, immutable"}),{abortSignal:AbortSignal.timeout(15000)});
      } catch(error) {
        if ((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode !== 412) throw error;
        const existing=await read(key,body.length);
        if (bytesHash(existing)!==bytesHash(body)) throw Error("immutable_dictionary_object_conflict");
      }
      if(bytesHash(await read(key,body.length))!==bytesHash(body)) throw Error("dictionary_upload_verification_failed");
    },
    async delete(key) {assert(key);await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)});},
  };
}
