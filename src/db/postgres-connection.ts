import type {ClientConfig} from 'pg';
import {SUPABASE_ROOT_CA} from './supabase-root-ca';

/** Supabase's private CA needs an explicit, host-verified TLS configuration.
 * Keep loopback fixtures and other providers' existing connection contracts.
 */
export function postgresConnectionOptions(connectionString:string|undefined):Pick<ClientConfig,'connectionString'|'ssl'> {
 if(!connectionString)return {connectionString};
 let url:URL;try{url=new URL(connectionString);}catch{return {connectionString};}
 const supabase=url.hostname.endsWith('.pooler.supabase.com')||url.hostname.endsWith('.supabase.co');
 if(!supabase)return {connectionString};
 // node-postgres URL SSL parameters overwrite the explicit ssl object. Remove
 // them rather than letting sslmode=disable/require bypass CA/hostname checks.
 for(const key of [...url.searchParams.keys()])if(/^ssl/i.test(key))url.searchParams.delete(key);
 return {connectionString:url.toString(),ssl:{ca:SUPABASE_ROOT_CA,rejectUnauthorized:true,servername:url.hostname}};
}
