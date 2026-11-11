/* Original book exercise engine scoped to a single unit and ShadowRoot. */
export function renderInteractiveBook(root, units, signal, storageKey) {
const U=units;const CON=[["i'm","i am"],["you're","you are"],["he's","he is"],["she's","she is"],["it's","it is"],["we're","we are"],["they're","they are"],["there's","there is"],["that's","that is"],["what's","what is"],["where's","where is"],["who's","who is"],["isn't","is not"],["aren't","are not"],["don't","do not"],["doesn't","does not"],["can't","can not"],["won't","will not"],["didn't","did not"],["wasn't","was not"],["weren't","were not"],["i've","i have"],["let's","let us"]];
function norm(s,strict){s=String(s).replace(/[’‘`]/g,"'").replace(/\s+/g,' ').trim();if(strict)return s;s=s.toLowerCase();CON.forEach(([a,b])=>{s=s.split(a).join(b)});return s.replace(/[.,!?;:"]/g,'').replace(/\s+/g,' ').trim()}
function ok(inp,alts,strict){const n=norm(inp,strict);return alts.some(a=>norm(a,strict)===n)}
const $=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const md=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
let S={};try{S=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch(e){}
const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(S))}catch(e){}};
function stat(u){return S[u.id]=S[u.id]||{}}
function pct(u,si){const st=stat(u)[si]||{};let c=0,t=0;u.stages[si].ex.forEach((e,ei)=>{const n=e.kind==='write'?1:e.items.length;t+=n;c+=(st[ei]||0)});return t?Math.round(100*c/t):0}
function done(u,si){const st=stat(u)[si]||{};return u.stages[si].ex.every((e,ei)=>st[ei]!==undefined)}
function setScore(u,si,ei,v){const s=stat(u);s[si]=s[si]||{};s[si][ei]=v;save();refresh(u,true)}
function clearScore(u,si,ei){const st=S[u.id]?.[si];if(!st||!Object.prototype.hasOwnProperty.call(st,ei))return;delete st[ei];if(!Object.keys(st).length)delete S[u.id][si];save();refresh(u,false)}
function cls(p){return p>=80?'hi':p>=50?'mid':'lo'}
function refresh(u,auto){const allDone=u.stages.every((s,i)=>done(u,i));const rtb=root.getElementById('rt-'+u.id);if(rtb){rtb.style.display=allDone?'':'none';if(!allDone)delete rtb.dataset.opened}if(rtb&&allDone){rtb.style.display='';const sc=root.getElementById('u-'+u.id);if(auto&&sc&&sc._sel&&!rtb.dataset.opened){rtb.dataset.opened=1;sc._sel(4)}}const tabs=root.querySelectorAll('#tabs-'+u.id+' .tab');u.stages.forEach((s,i)=>{const em=tabs[i].querySelector('em');if(done(u,i)){const p=pct(u,i);em.textContent=p+'%';em.className=cls(p)}else{em.textContent='';em.className=''}});const side=root.getElementById('pc-'+u.id);const ps=u.stages.map((s,i)=>pct(u,i));const a=Math.round(ps.reduce((x,y)=>x+y,0)/4);side.textContent=a?a+'%':''}
function exCard(u,si,ei,e){
  const card=$('div','exc');const h=$('div','exh');h.append($('div','exl',e.letter));h.append($('div','ins','<b>'+esc(e.instr.split('. ')[0]+(e.instr.includes('. ')?'.':''))+'</b> '+esc(e.instr.includes('. ')?e.instr.split('. ').slice(1).join('. '):'')+(e.note?'<div class="note">'+esc(e.note)+'</div>':'')));card.append(h);
  const body=$('div');card.append(body);const kind=e.kind;let correct=0;const marks=[];
  const finish=()=>{setScore(u,si,ei,correct)};
  if(kind==='mcq'||kind==='judge'){let answered=0;e.items.forEach((it,i)=>{const row=$('div','item');row.append($('div','num',i+1));const m=$('div','main');m.append($('div','q',esc(it.q)));const box=$('div');const fb=$('div','fb');
    const opts=kind==='mcq'?it.opts:["To'g'ri","Noto'g'ri"];opts.forEach(o=>{const b=$('button','opt',esc(o));b.onclick=()=>{if(box.dataset.d)return;box.dataset.d=1;const good=kind==='mcq'?o===it.a:((o==="To'g'ri")===it.t);b.classList.add(good?'ok':'no');if(!good){[...box.children].forEach(x=>{if(kind==='mcq'?x.textContent===it.a:((x.textContent==="To'g'ri")===it.t))x.classList.add('ok')});if(kind==='judge'&&it.fix)fb.innerHTML='<b>To\'g\'ri:</b> '+esc(it.fix);fb.className='fb no'}if(good)correct++;answered++;if(answered===e.items.length)finish()};box.append(b)});m.append(box,fb);row.append(m);body.append(row)})}
  else if(kind==='match'){const sels=[];e.items.forEach((it,i)=>{const row=$('div','item');row.append($('div','num',i+1));const m=$('div','main');m.append($('span','',esc(it.l)+'  →  '));const s=$('select','s');s.append(new Option('— tanlang —',''));e.rights.forEach(r=>s.append(new Option(r,r)));m.append(s);const fb=$('span','fb');m.append(fb);sels.push([s,it,fb]);row.append(m);body.append(row)});
    const b=$('button','btn','Tekshirish');b.onclick=()=>{if(b.dataset.d)return;b.dataset.d=1;sels.forEach(([s,it,fb])=>{const g=s.value===it.r;if(g)correct++;s.style.borderColor=g?'#2f7d5b':'#c0394b';fb.className='fb '+(g?'ok':'no');fb.innerHTML=g?' ✓':' ✗ <b>'+esc(it.r)+'</b>'});finish()};body.append(b)}
  else if(kind==='bank'){const chips=$('div','chips');const blanks=[];let act=null;
    e.bank.forEach(w=>{const c=$('span','chip',esc(w));c.onclick=()=>{if(c.classList.contains('used'))return;let t=act&&!act.dataset.v?act:blanks.find(x=>!x.dataset.v);if(!t)return;t.dataset.v=w;t.textContent=w;t.dataset.c=c.dataset.id=c.dataset.id||Math.random();c.classList.add('used');t._chip=c;act=null;blanks.forEach(x=>x.classList.remove('act'))};chips.append(c)});body.append(chips);
    const items=[];e.items.forEach((it,i)=>{const row=$('div','item');row.append($('div','num',i+1));const m=$('div','main');const parts=it.q.split('___');const bl=[];parts.forEach((p,k)=>{m.append(document.createTextNode(p));if(k<parts.length-1){const b=$('span','blank','&nbsp;');b.onclick=()=>{if(b.dataset.d)return;if(b.dataset.v){b._chip&&b._chip.classList.remove('used');b.dataset.v='';b.innerHTML='&nbsp;';return}blanks.forEach(x=>x.classList.remove('act'));act=b;b.classList.add('act')};blanks.push(b);bl.push(b);m.append(b)}});const fb=$('div','fb');m.append(fb);items.push([bl,it,fb]);row.append(m);body.append(row)});
    const b=$('button','btn','Tekshirish');b.onclick=()=>{if(b.dataset.d)return;b.dataset.d=1;items.forEach(([bl,it,fb])=>{let g=true;bl.forEach((x,k)=>{x.dataset.d=1;if(norm(x.dataset.v||'',false)!==norm(it.a[k],false))g=false;x.classList.add(norm(x.dataset.v||'',false)===norm(it.a[k],false)?'ok':'no')});if(g)correct++;else{fb.className='fb no';fb.innerHTML='<b>To\'g\'ri:</b> '+esc(it.a.join(' / '))}});finish()};body.append(b)}
  else if(kind==='order'){const items=[];e.items.forEach((it,i)=>{const row=$('div','item');row.append($('div','num',i+1));const m=$('div','main');const pool=$('div','words');const line=$('div','line');const fb=$('div','fb');
    it.words.forEach(w=>{const c=$('span','wchip',esc(w));c.onclick=()=>{if(c.parentNode===pool){line.append(c)}else{pool.append(c)}};pool.append(c)});m.append(pool,line,fb);items.push([line,it,fb]);row.append(m);body.append(row)});
    const b=$('button','btn','Tekshirish');b.onclick=()=>{if(b.dataset.d)return;b.dataset.d=1;items.forEach(([line,it,fb])=>{const s=[...line.children].map(x=>x.textContent).join(' ');const g=ok(s,it.a,false);if(g){correct++;fb.className='fb ok';fb.textContent='✓'}else{fb.className='fb no';fb.innerHTML='<b>To\'g\'ri:</b> '+esc(it.a[0])}});finish()};body.append(b)}
  else if(kind==='speak'){
    let completed=0;
    const canRec=!!(window.MediaRecorder&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
    e.items.forEach((it,i)=>{
      const row=$('div','item');row.append($('div','num',i+1));
      const main=$('div','main');main.append($('div','prompt',esc(it.q)));
      const feedback=$('div','fb'),player=$('div','aud');
      const record=$('button','btn',canRec?'● Yozish':'Aytdim ✓');
      const remove=$('button','btn ghost aud-delete','🗑 O‘chirish');
      remove.hidden=true;remove.type='button';remove.setAttribute('aria-label','Ovozli xabarni o‘chirish');
      const sample=$('button','btn ghost','Namunani ko‘rish');
      sample.style.display='none';sample.style.marginLeft='8px';
      let recorder=null,stream=null,audioUrl=null,marked=false,starting=false,disposed=false;
      function stopTracks(){stream?.getTracks().forEach(track=>track.stop());stream=null}
      function clearAudio(){
        for(const audio of player.querySelectorAll('audio')){audio.pause();audio.removeAttribute('src');audio.load()}
        player.replaceChildren();
        if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null}
        remove.hidden=true;
      }
      function mark(){
        if(marked)return;
        marked=true;correct++;completed++;sample.style.display='';
        if(completed===e.items.length)finish();
      }
      function unmark(){
        if(!marked)return;
        marked=false;correct=Math.max(0,correct-1);completed=Math.max(0,completed-1);
        sample.style.display='none';clearScore(u,si,ei);
      }
      signal?.addEventListener('abort',()=>{
        disposed=true;
        if(recorder?.state==='recording'){
          recorder.onstop=null;
          try{recorder.stop()}catch{}
        }
        stopTracks();clearAudio();
      },{once:true});
      sample.onclick=()=>{feedback.className='fb';feedback.innerHTML='<b>Namuna:</b> '+esc(it.a[0]);sample.style.display='none'};
      remove.onclick=()=>{
        if(disposed||starting||recorder?.state==='recording')return;
        clearAudio();unmark();feedback.textContent='';
        record.textContent='● Yozish';record.classList.remove('live');record.disabled=false;
      };
      if(!canRec){
        record.onclick=()=>{record.disabled=true;mark()};
        feedback.className='fb no';
        feedback.textContent='Brauzeringiz ovoz yozishni qo‘llamaydi. Gapni ovoz chiqarib ayting va "Aytdim" ni bosing.';
      }else{
        record.onclick=async()=>{
          if(disposed||starting)return;
          if(recorder?.state==='recording'){
            record.disabled=true;
            try{recorder.stop()}catch{record.disabled=false}
            return;
          }
          starting=true;record.disabled=true;remove.disabled=true;
          try{
            const requested=await navigator.mediaDevices.getUserMedia({audio:true});
            if(disposed||signal?.aborted){requested.getTracks().forEach(t=>t.stop());return}
            stream=requested;
            const chunks=[],active=new MediaRecorder(requested);
            let failed=false;
            recorder=active;
            active.ondataavailable=ev=>{if(ev.data?.size)chunks.push(ev.data)};
            active.onerror=()=>{failed=true};
            active.onstop=()=>{
              stopTracks();recorder=null;
              if(disposed||signal?.aborted)return;
              record.disabled=false;remove.disabled=false;record.classList.remove('live');
              if(failed||!chunks.length){
                feedback.className='fb no';feedback.textContent='Ovoz yozilmadi. Qayta urinib ko‘ring.';
                record.textContent=audioUrl?'● Qayta yozish':'● Yozish';
                return;
              }
              const blob=new Blob(chunks,{type:active.mimeType||'audio/webm'});
              const url=URL.createObjectURL(blob);
              clearAudio();audioUrl=url;
              const playerElement=document.createElement('audio');
              playerElement.controls=true;playerElement.preload='metadata';playerElement.src=url;
              player.append(playerElement);
              remove.hidden=false;
              record.textContent='● Qayta yozish';
              feedback.className='fb';feedback.textContent='';
              mark();
            };
            active.start();
            record.textContent='■ To‘xtatish';record.classList.add('live');record.disabled=false;
          }catch{
            stopTracks();recorder=null;
            if(!disposed){
              feedback.className='fb no';
              feedback.textContent='Mikrofon ishlamadi. Brauzerda mikrofonga ruxsat bering.';
              record.textContent=audioUrl?'● Qayta yozish':'● Yozish';
            }
          }finally{
            starting=false;
            if(!disposed&&recorder?.state!=='recording')record.disabled=false;
            if(!disposed)remove.disabled=false;
          }
        };
      }
      main.append(record,remove,sample,feedback,player);row.append(main);body.append(row);
    });
  }
  else if(kind==='write'){const ta=$('textarea','t');ta.placeholder=e.placeholder;const cnt=$('div','note','0 ta so\'z · kamida '+e.min);ta.oninput=()=>{const n=(ta.value.trim().match(/\S+/g)||[]).length;cnt.textContent=n+' ta so\'z · kamida '+e.min};const b=$('button','btn','Yakunlash →');const mod=$('div','fb');b.onclick=()=>{const n=(ta.value.trim().match(/\S+/g)||[]).length;if(n<e.min){cnt.style.color='#c0394b';return}mod.className='fb';mod.innerHTML='<b>Namuna:</b> '+esc(e.model);setScore(u,si,ei,1)};body.append(ta,cnt,b,mod)}
  else{const items=[];e.items.forEach((it,i)=>{const row=$('div','item');row.append($('div','num',i+1));const m=$('div','main');const isTr=kind==='tr';
    if(isTr||kind==='transform'||kind==='fix'||kind==='typed'){m.append($('div',isTr?'prompt':'',esc(it.q)))}
    const inp=$('input','t');inp.placeholder=isTr?'':'';const fb=$('div','fb');m.append(inp,fb);inp.onkeydown=ev=>{if(ev.key==='Enter'){const n=inp.closest('.exc').querySelector('.btn');n&&n.click()}};items.push([inp,it,fb]);row.append(m);body.append(row)});
    const b=$('button','btn','Tekshirish');b.onclick=()=>{if(b.dataset.d)return;b.dataset.d=1;items.forEach(([inp,it,fb])=>{const g=ok(inp.value,it.a,e.strict);inp.readOnly=true;inp.classList.add(g?'ok':'no');if(g)correct++;fb.className='fb '+(g?'ok':'no');fb.innerHTML=g?'✓':'<b>To\'g\'ri emas.</b> '+esc(it.a[0])+' ';if(!g){const o=$('button','opt','Mening javobim ham to\'g\'ri');o.onclick=()=>{o.remove();correct++;fb.className='fb ok';fb.innerHTML='✓ (qabul qilindi)';inp.classList.remove('no');inp.classList.add('ok');finish()};fb.append(o)}});finish()};body.append(b)}
  return card}
function build(){const main=root.getElementById('units');const side=root.getElementById('nav');
  let lastC='';U.forEach((u,ui)=>{if(u.code!==lastC){lastC=u.code;side.append($('div','grp',u.code))}const a=$('a','',`<span>${u.id.split('-')[1]}. ${esc(u.title)}</span><span class="pc" id="pc-${u.id}"></span>`);a.href='#'+u.id;a.onclick=ev=>{ev.preventDefault();show(u.id)};side.append(a);
   const sec=$('section','unit');sec.id='u-'+u.id;
   sec.append($('div','',`<span class="pill">${u.code} · DARS ${u.lessons}</span><h2 class="utitle">${esc(u.title)}</h2>`));
   const tabs=$('div','tabs');tabs.id='tabs-'+u.id;const panels=[];
   u.stages.forEach((s,i)=>{const t=$('button','tab',`<b>${s.n}</b> ${esc(s.name)} <em></em>`);t.onclick=()=>sel(i);tabs.append(t)});const rt=$('button','tab','Natija');rt.id='rt-'+u.id;rt.style.display='none';rt.onclick=()=>sel(4);tabs.append(rt);sec.append(tabs);
   const rule=$('div','rule');const rh=$('header','',`<span class="pill">QOIDA</span><h3>${esc(u.rule.title)}</h3>`);const rb=$('div','body');
   rb.append($('div','',''));const tb=u.rule.table;rb.innerHTML='<table><thead><tr>'+tb[0].map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+tb.slice(1).map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+(u.img?'<img class="ruleimg" src="'+u.img+'" alt="">':'')+u.rule.points.map(p=>'<p>'+md(p)+'</p>').join('')+'<ul class="ex">'+u.rule.examples.map(x=>'<li><span class="en">'+esc(x[0])+'</span><span class="uz">'+esc(x[1])+'</span></li>').join('')+'</ul>';
   rh.onclick=()=>rb.classList.toggle('off');rule.append(rh,rb);
   u.stages.forEach((s,si)=>{const p=$('div','panel');p.style.display='none';p.append($('div','stagehead',`<span class="pill">${s.n} · ${esc(s.name.toUpperCase())}</span><h3>${esc(u.title)}</h3><p>${esc(s.sub)}</p>`));if(si===0)p.append(rule);s.ex.forEach((e,ei)=>p.append(exCard(u,si,ei,e)));panels.push(p);sec.append(p)});
   const rp=$('div','panel');rp.style.display='none';panels.push(rp);sec.append(rp);
   function sel(i){[...tabs.children].forEach((t,k)=>t.classList.toggle('on',k===i));panels.forEach((p,k)=>p.style.display=k===i?'block':'none');if(i===4)result(u,rp)}
   sec._sel=sel;main.append(sec);refresh(u);sel(0)});
  show(U[0].id)}
function result(u,rp){const ps=u.stages.map((s,i)=>pct(u,i));const worst=ps.indexOf(Math.min(...ps));const need=ps.some((p,i)=>done(u,i)&&p<70)||ps.some((p,i)=>!done(u,i));
  rp.innerHTML=`<div class="res"><h3>${need?'Mashq kerak':'Zo\'r natija!'}</h3><p class="sub">${esc(u.title)}</p><div class="rows">`+u.stages.map((s,i)=>`<div class="row"><div class="nn">${s.n}</div><div>${esc(s.name)}</div><div class="bar"><i style="width:${ps[i]}%;background:${ps[i]>=80?'#2f7d5b':ps[i]>=50?'#d08a2b':'#c0394b'}"></i></div><div class="pp" style="color:${ps[i]>=80?'#2f7d5b':ps[i]>=50?'#d08a2b':'#c0394b'}">${ps[i]}%</div></div>`).join('')+`</div><p class="sub">70% dan past bosqichni qaytadan bajaring. Qoidani qayta o'qing.</p></div>`;
  const b=$('button','btn ghost','Qaytadan');b.onclick=()=>{delete S[u.id];save();root.getElementById('units').replaceChildren();root.getElementById('nav').replaceChildren();build()};rp.firstChild.append(b)}
function show(id){root.querySelectorAll('.unit').forEach(s=>s.classList.toggle('on',s.id==='u-'+id));root.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+id));window.scrollTo(0,0)}
build();
}
