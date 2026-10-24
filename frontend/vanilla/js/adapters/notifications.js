import {ApiError} from '../api-client.js';import {safeNextPath} from '../safe-next.js';
const date=x=>(typeof x==='string'||x instanceof Date)&&Number.isFinite(new Date(x).getTime());
function safeHref(value){if(value==null||value==='')return true;if(typeof value!=='string'||/[\u0000-\u001f\\]/.test(value))return false;if(safeNextPath(value)===value)return true;try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
/** Original GET /api/notifications projection, validated before controls mount. */
export function notificationRows(rows){if(!Array.isArray(rows)||rows.some(r=>!r||typeof r.id!=='string'||typeof r.title!=='string'||r.body!=null&&typeof r.body!=='string'||!date(r.createdAt)||r.readAt!==null&&!date(r.readAt)||!safeHref(r.href))||new Set(rows.map(r=>r.id)).size!==rows.length)throw new ApiError(502,'invalid_notifications_adapter');return rows;}
