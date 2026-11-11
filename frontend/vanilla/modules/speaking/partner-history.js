import {el} from '../../js/dom.js';

export function partnerHistory({t,history,busy,act,reload,call,online,button,tab='recent'}){
 const area=el('section',{class:'lp-history card','data-partner-history':'','data-history-tab':tab});
 const body=el('div',{class:'lp-history-content'});
 const friends=new Map((history?.friends??[]).map(person=>[person.userId,person]));
 const action=(name,payload)=>button(name,()=>void act(payload),'btn-secondary',{disabled:busy});
 body.append(button(t.refresh,reload,'btn-secondary'));
 if(history){
  const minutes=Math.floor(history.stats.seconds/60);
  if(tab==='recent')body.append(el('p',{},t.calls+' '+history.stats.calls+' · '+t.minutes+' '+minutes),el('h3',{},t.recent));
  if(tab==='recent'&&!history.recent.length)body.append(el('p',{},t.noCalls));
  for(const entry of (tab==='recent'?history.recent:[])){
   const row=el('div',{class:'lp-history-row'},el('strong',{},entry.name),
    el('small',{},Math.floor(entry.seconds/60)+'m '+(entry.seconds%60)+'s'));
   if(entry.peerRating!=null)row.append(el('small',{},t.receivedBand+' '+Number(entry.peerRating).toFixed(1)));
   body.append(row);
  }
  if(tab==='friends')body.append(el('h3',{},t.friends));
  if(tab==='friends'&&!friends.size)body.append(el('p',{},t.noFriends));
  for(const friend of (tab==='friends'?friends.values():[])){
   const person=online.find(person=>person.userId===friend.userId);
   body.append(el('div',{class:'lp-history-row'},el('strong',{},friend.name),
    friend.state==='received'?action(t.acceptFriend,{action:'friend_accept',userId:friend.userId}):null,
    friend.state==='sent'?el('span',{},t.friendPending):null,
    friend.state==='accepted'&&person?call(person):null,action(t.removeFriend,{action:'friend_remove',userId:friend.userId})));
  }
 }
 area.append(body);return area;
}
