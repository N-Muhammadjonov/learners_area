"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useScopedResponse } from "@/lib/http/use-scoped-response";
import type { Dictionary } from "@/lib/i18n/en";

export function DeleteMaterialButton({type,id,dict,backTo}:{type:string;id:string;dict:Dictionary;backTo?:string}) {
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const request=useScopedResponse(25000),router=useRouter(),t=dict.admin.materialDeletion;
  async function remove(){
    setBusy(true);setFailed(false);
    const response=await request(`/api/admin/content/${type}/${id}`,{method:"DELETE"}).catch(()=>null);
    setBusy(false);
    if(!response?.ok){setFailed(true);return;}
    setConfirm(false);if(backTo)router.push(backTo);router.refresh();
  }
  return <span className="inline-flex flex-wrap items-center gap-2" data-material-delete={id}>
    <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={()=>setConfirm(true)}>{dict.common.delete}</button>
    {confirm&&<span className="w-full space-y-2 rounded-xl border border-ink-100 p-3" role="alert">
      <span className="block">{t.confirm}</span>
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>void remove()}>{busy?dict.common.loading:dict.common.delete}</button>{" "}
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>setConfirm(false)}>{dict.common.cancel}</button>
    </span>}
    {failed&&<span role="status">{t.failed}</span>}
  </span>;
}
