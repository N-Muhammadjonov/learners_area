import { decodeShard, type ShardDescriptor } from "./shards";
import type { Entry } from "./model";
import { shardKey } from "./shards";
import type { DictionaryObjects } from "./object-store";

/** Limits include concurrent misses; neither failures nor arbitrary keys enter cache. */
export class DictionaryShardCache {
  private cache = new Map<string,{entries:Map<string,Entry>;bytes:number;expires:number}>();
  private pending = new Map<string,Promise<Map<string,Entry>>>();
  private bytes=0;
  constructor(private readonly objects:Pick<DictionaryObjects,"read">,private readonly budget=32*1024*1024,private readonly ttl=300_000,private readonly now=Date.now) {}
  stats() {return {bytes:this.bytes,shards:this.cache.size,inflight:this.pending.size,maxBytes:this.budget};}
  async get(release:string,descriptor:ShardDescriptor):Promise<Map<string,Entry>> {
    const key=shardKey(release,descriptor.shard)+":"+descriptor.sha256;
    const cached=this.cache.get(key);
    if(cached) {
      this.cache.delete(key);
      if(cached.expires>this.now()) {this.cache.set(key,cached);return cached.entries;}
      this.bytes-=cached.bytes;
    }
    const pending=this.pending.get(key);if(pending)return pending;
    if(this.pending.size>=4)throw Error("dictionary_retrieval_busy");
    const work=(async()=>{
      const body=await this.objects.read(shardKey(release,descriptor.shard),descriptor.compressed_bytes);
      const entries=decodeShard(release,descriptor,body);
      // Parsed JS objects cost more than UTF-8 bytes; reserve a conservative 4x.
      const bytes=descriptor.raw_bytes*4;
      while(this.bytes+bytes>this.budget&&this.cache.size) {
        const oldest=this.cache.keys().next().value!;
        this.bytes-=this.cache.get(oldest)!.bytes;this.cache.delete(oldest);
      }
      if(bytes<=this.budget){this.cache.set(key,{entries,bytes,expires:this.now()+this.ttl});this.bytes+=bytes;}
      return entries;
    })();
    this.pending.set(key,work);
    try{return await work;}finally{this.pending.delete(key);}
  }
}
