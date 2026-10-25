import test from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import * as React from "react";

Object.assign(globalThis,{ React });
const sessionKey=Symbol.for("campus.test.user");
const sessionState=globalThis as typeof globalThis & { [sessionKey]: unknown };
// The application runs Node 24; its existing Node 20 type package predates this API.
type ResolveContext={parentURL?:string};
type Resolution={url:string;shortCircuit?:boolean};
const {registerHooks}=nodeModule as typeof nodeModule & {
  registerHooks(options:{resolve(specifier:string,context:ResolveContext,next:(specifier:string,context:ResolveContext)=>Resolution):Resolution}):{deregister():void};
};
const data=(source: string)=>({url:`data:text/javascript,${encodeURIComponent(source)}`,shortCircuit:true as const});
// Keep the actual database-backed role/status guard. Only replace its network
// boundary, translations and client renderer; no real accounts or providers are used.
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==="server-only" || specifier.endsWith(".css")) return data("");
  if(specifier==="@/lib/backend/server") return data('export async function backendSession(){return {user:globalThis[Symbol.for("campus.test.user")] ?? null}}');
  if(specifier==="@/lib/i18n") return data('export async function getLocale(){return "uz"} export function getDictionary(){return {nav:{management:"Boshqaruv"}}}');
  if(specifier==="@/components/campus/CampusWorld") return data('export function CampusWorld(){return null}');
  return next(specifier,context);
}});
const {default:LearningCampusPage}=await import("../src/app/app/(shell)/page");
hooks.deregister();

test("home derives castle visibility from the real active-staff guard for every role and revoked account",async()=>{
  try {
    for(const role of ["student","teacher","admin","owner"] as const) {
      for(const accountStatus of ["active","pending","suspended","rejected"] as const) {
        sessionState[sessionKey]={id:"campus-test-user",role,accountStatus};
        const page=await LearningCampusPage();
        assert.equal(page.props.showManagement,accountStatus==="active" && role!=="student",`${role} / ${accountStatus}`);
        assert.equal(page.props.managementLabel,"Boshqaruv");
      }
    }
    sessionState[sessionKey]=null;
    assert.equal((await LearningCampusPage()).props.showManagement,false);
  } finally { delete sessionState[sessionKey]; }
});
