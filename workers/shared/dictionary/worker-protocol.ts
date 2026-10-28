import {Buffer} from 'node:buffer';
const encoder=new TextEncoder();
const PURPOSE='learners-area:dictionary-gateway:v1';
export async function dictionaryProof(secret:string,body:string,timestamp:number){
 if(secret.length<32||!Number.isSafeInteger(timestamp))throw Error('dictionary_gateway_unconfigured');
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,encoder.encode(PURPOSE+'\n'+timestamp+'\n'+body));
 return timestamp+':'+Buffer.from(bytes).toString('base64url');
}
export async function verifyDictionaryProof(secret:string,body:string,proof:string,now=Date.now()){
 if(secret.length<32||body.length>16384||proof.length>100)return false;
 const [at,signature,...extra]=proof.split(':');const timestamp=Number(at);if(extra.length||!signature||!Number.isSafeInteger(timestamp)||Math.abs(now/1000-timestamp)>15)return false;
 try{const bytes=Buffer.from(signature,'base64url');if(bytes.length!==32||bytes.toString('base64url')!==signature)return false;const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,bytes,encoder.encode(PURPOSE+'\n'+timestamp+'\n'+body));}catch{return false;}
}
