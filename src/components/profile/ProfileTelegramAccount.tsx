"use client";
import {Suspense,useState} from 'react';
import type {Dictionary} from '@/lib/i18n/en';
import {TelegramIntentLogin} from '@/components/auth/TelegramIntentLogin';
export function ProfileTelegramAccount({dict,linked,username,phone,student,botUsername}:{dict:Dictionary;linked:boolean;username:string|null;phone:string|null;student:boolean;botUsername?:string}){
 const [changing,setChanging]=useState(false),t=dict.profile;
 return <section className="panel space-y-4" data-profile-telegram><h2 className="text-xl font-semibold">{t.telegramAccount}</h2>{linked&&<div className="space-y-2"><p>{username?`@${username.replace(/^@/,'')}`:'Telegram'}</p><p>{phone??'—'}</p></div>}{!linked||changing?<><p className="text-sm">{linked?t.telegramChangeHint:''}</p><Suspense><TelegramIntentLogin dict={dict} configured botUsername={botUsername} purpose={linked?'replace':'link'}/></Suspense>{changing&&<button type="button" className="btn-secondary" onClick={()=>setChanging(false)}>{dict.common.cancel}</button>}</>:<><button type="button" className="btn-secondary" disabled={!student} onClick={()=>setChanging(true)}>{t.telegramChange}</button>{!student&&<p className="text-sm">{t.telegramStaffChange}</p>}</>}</section>;
}
