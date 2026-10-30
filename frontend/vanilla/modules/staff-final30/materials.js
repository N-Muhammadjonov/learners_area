import {el,mountStaff,BackLink} from './kit.js';
import {resourceComposer} from './resource-composer.js';
import {materialDelete} from './delete-material.js';
import {materialsKind,materialsOwner,kindLabel} from '../../js/adapters/staff-final30/reading.js';
const STAFF=['teacher','admin','owner'];
const parts=ctx=>ctx.url.pathname.split('/').filter(Boolean);
/**
 * Source: admin/materials/[type]/page.tsx (requireStaff). The index /app/admin/materials is the existing V4 view (PRESERVED).
 * An unknown kind is a 404 (a URL that cannot mean anything must not pretend to be a screen).
 */
export const kindMount=mountStaff({name:'materials-kind',roles:STAFF,notFoundBack:null,load:c=>materialsKind(parts(c).at(-1),c.signal),
 render(ctx,d){const {dict}=ctx,type=parts(ctx).at(-1);
  return el('div',{class:'mx-auto flex max-w-4xl flex-col gap-4','data-materials-kind':type},BackLink({fallbackHref:'/app/admin/materials',label:dict.admin.materialsBack}),el('h1',{class:'font-display text-2xl text-ink-900'},kindLabel(dict,type)),
   d.rows.length===0?el('div',{class:'panel flex flex-col items-center gap-2 py-12 text-center','data-empty-state':''},el('p',{class:'font-medium text-ink-900'},dict.admin.materialsEmpty),el('p',{class:'text-sm text-ink-500'},dict.admin.materialsHint)):
   el('ul',{class:'flex flex-col gap-2'},d.rows.map(r=>el('li',{},el('a',{href:`/app/admin/materials/${type}/${r.id}`,class:'card flex items-center justify-between gap-3 p-4 transition-colors hover:border-ink-300','data-materials-item':r.id},el('span',{class:'min-w-0 flex-1 truncate text-sm font-medium text-ink-900'},r.title),el('span',{class:'shrink-0 text-xs text-ink-500'},r.studentVisible?dict.admin.materialsVisible:dict.admin.materialsHidden))))));}});
/** Source: admin/materials/[type]/[id]/page.tsx — the ONE editor every content kind uses (the same composer, a different ownerType). */
export const editorMount=mountStaff({name:'materials-editor',roles:STAFF,notFoundBack:null,load:c=>{const p=parts(c);return materialsOwner(p.at(-2),p.at(-1),c.signal);},
 render(ctx,d){const {dict}=ctx,p=parts(ctx),type=p.at(-2),id=p.at(-1);
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4','data-materials-editor':type},BackLink({fallbackHref:`/app/admin/materials/${type}`,label:dict.admin.materialsBack}),
   el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},dict.admin.materialsFor.replace('{name}',d.owner.title)),el('p',{class:'meta-text mt-1'},`${kindLabel(dict,type)} · ${d.owner.studentVisible?dict.admin.materialsVisible:dict.admin.materialsHidden}`),el('p',{class:'body-text mt-2'},dict.admin.materialsHint)),
   materialDelete(ctx,{type,id,backTo:`/app/admin/materials/${type}`}),
   (ctx.resourceComposer??resourceComposer)(ctx,{ownerType:type,ownerId:id}));}});
