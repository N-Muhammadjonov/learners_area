import {el} from '../../js/dom.js';
import {viewData,requireFields} from '../../js/adapters/frontend.js';
import {api} from '../../js/api-client.js';
import registry from '../../js/generated/view-registry.js';
import {privateScope} from '../../js/private-scope.js';
export async function mount(context){const {root,url,signal,dict,navigate,session}=context;const spec=registry.find(r=>r.path===url.pathname);if(!spec)throw Error('Unknown converted view');
 if(spec.roles&&!spec.roles.includes(session.user.role)){void navigate('/app',{replace:true});return;}
 const view=await import(`../../js/generated/views/${spec.name}.js`);if(signal.aborted)return;const host=el('div',{'data-native-view':spec.name}),status=el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,class:'h-32 animate-pulse rounded-xl bg-ink-50'});host.append(view.loading?.({dict})??status);root.append(host);
 async function load(){try{let data;if(spec.name==='notifications'){const result=await api.request('/api/notifications',{signal});data={rows:result.notifications};}else data=spec.fields.length?await viewData(url.pathname+url.search,signal):{};requireFields(data,spec.fields);
 for(const rule of spec.dates??[]){const [array,key]=rule.split('.');for(const row of data[array]){const date=new Date(row[key]);if(!Number.isFinite(date.getTime()))throw Error('Invalid date adapter');row[key]=date;}}
 const {render}=view;if(signal.aborted)return;const page=Math.max(1,Math.min(10000,parseInt(url.searchParams.get('page')??'1',10)||1));host.replaceChildren(render({...data,page,dict,locale:context.locale,user:session.user,context}));
 }catch(e){if(signal.aborted)return;if(e.status===401){privateScope.setScope(null);void navigate('/login',{replace:true});return;}host.replaceChildren(el('div',{role:'alert','data-integration-required':spec.name,class:'card p-5'},el('p',{class:'text-sm text-band-bad'},dict.auth.errorServer)));}}
 void load();
}
