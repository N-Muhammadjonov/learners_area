import {el} from '../../js/dom.js';

export function partnerHistory({t,history,busy,act,reload,call,online,button}){
 const area=el('details',{class:'lp-history card','data-partner-history':''},el('summary',{},t.history));
 const body=el('div',{class:'lp-history-content'});
 const friends=new Map((history?.friends??[]).map(person=>[person.userId,person]));
 const action=(name,payload)=>button(name,()=>void act(payload),'btn-secondary',{disabled:busy});
 body.append(button(t.refresh,reload,'btn-secondary'));
 if(history){
  const minutes=Math.floor(history.stats.seconds/60);
  body.append(el('p',{},t.calls+' '+history.stats.calls+' · '+t.minutes+' '+minutes),el('h3',{},t.recent));
  if(!history.recent.length)body.append(el('p',{},t.noCalls));
  for(const entry of history.recent){
   const row=el('div',{class:'lp-history-row'},el('strong',{},entry.name),el('small',{},Math.floor(entry.seconds/60)+'m '+(entry.seconds%60)+'s'+(entry.mock?' · '+t.kinds.mock:'')));
   if(entry.mock)row.append(el('small',{},t.practiceResult+' '+(Math.round(entry.mock.bands.reduce((sum,band)=>sum+band,0)/4)/2).toFixed(1)));
   if(!friends.has(entry.userId))row.append(action(t.addFriend,{action:'friend_request',userId:entry.userId}));
   if(!entry.rated){
    const rating=el('select',{class:'input','aria-label':t.rating},...[1,2,3,4,5].map(value=>el('option',{value,selected:value===5},String(value))));
    row.append(el('div',{class:'lp-action-row'},rating,button(t.rating,()=>void act({action:'rating',sessionId:entry.sessionId,rating:Number(rating.value)}),'btn-secondary',{disabled:busy})));
   }
   if(!entry.reported){
    const reason=el('select',{class:'input','aria-label':t.report},...Object.entries(t.reasons).map(([value,label])=>el('option',{value},label)));
    row.append(el('details',{},el('summary',{},t.report),el('div',{class:'lp-action-row'},reason,
     button(t.sendReport,()=>void act({action:'report',sessionId:entry.sessionId,reason:reason.value}),'btn-secondary',{disabled:busy}))));
   }
   body.append(row);
  }
  body.append(el('h3',{},t.friends));
  if(!friends.size)body.append(el('p',{},t.noFriends));
  for(const friend of friends.values()){
   const person=online.find(person=>person.userId===friend.userId);
   body.append(el('div',{class:'lp-history-row'},el('strong',{},friend.name),
    friend.state==='received'?action(t.acceptFriend,{action:'friend_accept',userId:friend.userId}):null,
    friend.state==='sent'?el('span',{},t.friendPending):null,
    friend.state==='accepted'&&person?call(person):null,action(t.removeFriend,{action:'friend_remove',userId:friend.userId})));
  }
 }
 area.append(body);return area;
}
