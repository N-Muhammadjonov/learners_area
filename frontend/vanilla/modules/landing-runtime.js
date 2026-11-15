/** Landing interactions preserved from the approved visual preview. */
export function initializeLanding(root,{signal,navigate}){
 if(signal.aborted)return;
 const hadJsClass=document.documentElement.classList.contains('js');
 const hadMouseClass=document.documentElement.classList.contains('has-mouse');
 const oldLanguage=document.documentElement.lang;
 const timers=new Set(),intervals=new Set();
 const onWindow=(type,handler,options={})=>window.addEventListener(type,handler,
  typeof options==='boolean'?{capture:options,signal}:{...options,signal});
 const onDocument=(type,handler,options={})=>document.addEventListener(type,handler,
  typeof options==='boolean'?{capture:options,signal}:{...options,signal});
 const onInterval=(callback,delay)=>{const id=setInterval(callback,delay);intervals.add(id);return id};
 const onTimeout=(callback,delay)=>{const id=setTimeout(()=>{timers.delete(id);if(!signal.aborted)callback()},delay);timers.add(id);return id};
 signal.addEventListener('abort',()=>{
  for(const id of intervals)clearInterval(id);
  for(const id of timers)clearTimeout(id);
  if(!hadJsClass)document.documentElement.classList.remove('js');
  if(!hadMouseClass)document.documentElement.classList.remove('has-mouse');
  document.documentElement.lang=oldLanguage;
  delete window.__laCinematicState;
  const video=root.querySelector('#cinematicDesertVideo');
  if(video){video.pause();video.removeAttribute('src');video.load();}
  if(window.laPublicAudio){try{window.laPublicAudio.pause()}catch{}window.laPublicAudio=null}
 },{once:true});

document.documentElement.classList.add('js');
const REGISTER='/register';
const LV=['A1','A2','B1','B2','C1','C2'],NM=['Starter','Elementary','Intermediate','Upper-intermediate','Advanced','Proficiency'],
IE=['IELTS 4.0 dan past','IELTS 4.0 dan past','IELTS 4.0–5.0','IELTS 5.5–6.5','IELTS 7.0–8.0','IELTS 8.5–9.0'],
NT=['Asoslardan boshlaymiz: sodda grammatika va kundalik lug‘at.','Poydevor mustahkamlanadi, so‘ng IELTS formatiga o‘tiladi.','Poydevor bor — endi IELTS format va strategiyasiga o‘tamiz.','IELTS 6.0–6.5 uchun yaxshi asos. Zaif ko‘nikma ko‘tariladi.','Kuchli daraja. Reja nozik xatolar va vaqt boshqaruviga qaratiladi.','Yuqori daraja. Reja aniqlik va tezlikka qaratiladi.'],
SK={g:'Grammar',v:'Vocabulary',r:'Reading',l:'Listening',u:'Use of English'},ORD=['l','r','u','g','v'],
MP={l:'listening',r:'reading',g:'writing',u:'writing',v:'speaking'},
T={l:'Listening: 1 Section + xatolar tahlili',r:'Reading: 1 passage, T/F/NG tahlili',g:'Grammar: 1 mavzu + 15 mashq',v:'Vocabulary: 15 yangi so‘z + takror',u:'Use of English: 20 tezkor savol',w:'Writing: Task 2 reja + paragraf',s:'Speaking: Part 2 javobini yozib oling',m:'Mini-mock va haftalik tahlil'};
/* [daraja, ko‘nikma, savol, [to‘g‘ri, xato, xato, xato], matn/audio] */
const Q=[{"l":0,"s":"g","q":"Choose the sentence about a daily routine.","opts":["She usually walk to work.","She usually walks to work.","She is usually walk to work.","She walking usually to work."],"answer":1,"x":""},{"l":0,"s":"v","q":"Choose the opposite of “early”.","opts":["soon","late","quickly","before"],"answer":1,"x":""},{"l":0,"s":"r","q":"When does Ali finish work?","opts":["At 8 a.m.","At 9 a.m.","At 5 p.m.","At 6 p.m."],"answer":2,"x":"Ali works in a library. He arrives at eight forty-five, begins work at nine and goes home at five. His brother finishes at six."},{"l":0,"s":"l","q":"What time will the train actually leave?","opts":["7:45","8:05","8:15","8:30"],"answer":2,"x":"Good morning. The train at seven forty-five has been cancelled. The next one leaves at eight fifteen. Please be on the platform by eight five."},{"l":0,"s":"u","q":"At a café, you are ready to order. Which request is most appropriate?","opts":["Could I have a tea, please?","Would you have a tea?","Do I get you a tea?","I should give you a tea."],"answer":0,"x":""},{"l":1,"s":"g","q":"“We ___ the exhibition last Saturday.”","opts":["have visited","visited","were visiting","had visited"],"answer":1,"x":""},{"l":1,"s":"v","q":"Which document shows you have already paid?","opts":["invoice","receipt","estimate","application"],"answer":1,"x":""},{"l":1,"s":"r","q":"Why did Anna miss the bus?","opts":["She forgot the route.","The bus was full.","Her alarm did not ring.","She went to the wrong stop."],"answer":2,"x":"Anna arrived late because her alarm did not ring. She missed the 8:10 bus and took the next one at 8:40."},{"l":1,"s":"l","q":"When will the class start?","opts":["10:00","10:15","10:30","11:00"],"answer":2,"x":"We usually begin at ten, but our teacher’s train is delayed. Today we will start half an hour later, at ten thirty."},{"l":1,"s":"u","q":"You need to reschedule a lesson. Which message is best?","opts":["I will not arrive yesterday.","Could we move tomorrow’s lesson to Friday?","My lesson can be moving after.","Tomorrow we are not previous lesson."],"answer":1,"x":""},{"l":2,"s":"g","q":"I wish I ___ more time to study.","opts":["have","had","will have","am having"],"answer":1,"x":""},{"l":2,"s":"v","q":"Which word best describes someone whose promises you can depend on?","opts":["consistent","reliable","predictable","accurate"],"answer":1,"x":""},{"l":2,"s":"r","q":"What is the writer’s main concern?","opts":["The price of buses","The number of shops","The lack of evening services","The quality of roads"],"answer":2,"x":"Public transport has improved during the day, but people who work late still struggle to get home. The last bus leaves before many evening shifts finish."},{"l":2,"s":"l","q":"Why did the workshop finish early?","opts":["The presenter was unwell","A technical issue interrupted the session","Too few people registered","The venue was double-booked"],"answer":1,"x":"We planned to continue until five. Attendance was good and the speaker felt fine, but the sound system stopped working, so we finished early."},{"l":2,"s":"u","q":"You disagree politely in a team meeting. Choose the best response.","opts":["I understand your point, but could we consider another option?","That is not right, and everybody knows it.","You should have thought before speaking.","Whatever, do as you like."],"answer":0,"x":""},{"l":3,"s":"g","q":"Hardly ___ the presentation begun when the alarm rang.","opts":["had","has","did","was"],"answer":0,"x":""},{"l":3,"s":"g","q":"If she had left earlier, she ___ the train.","opts":["will catch","would catch","would have caught","caught"],"answer":2,"x":""},{"l":3,"s":"v","q":"“Mitigate” a risk means to ___.","opts":["ignore it","increase it","reduce its impact","describe it"],"answer":2,"x":""},{"l":3,"s":"v","q":"Which collocation is most natural?","opts":["deeply concern about","deep concern about","strong concerned for","high concerning on"],"answer":1,"x":""},{"l":3,"s":"r","q":"What is the writer’s attitude toward remote work?","opts":["Entirely negative","Unconditionally positive","Cautiously supportive","Completely neutral"],"answer":2,"x":"Remote work can make employment accessible to more people, particularly those with lengthy commutes. Yet managers should not assume it suits every task: mentoring and collaborative design sometimes benefit from being together."},{"l":3,"s":"r","q":"What is the main implication?","opts":["The pilot proved the system useless.","The results require broader testing.","All regions are identical.","The costs have disappeared."],"answer":1,"x":"A pilot programme reduced waste by 18% in one city. However, the organisers warned that local recycling facilities differ considerably, so the outcome should not be extrapolated without further trials."},{"l":3,"s":"l","q":"What was Jack's attitude to nutritional food labels before this project?","opts":["He didn't read everything on them.","He didn't think they were important.","He thought they were too complicated."],"answer":0,"x":"/api/study-plan/monthly/sequence/level/landing/audio/1"},{"l":3,"s":"l","q":"Why didn’t Amy phone her family?","opts":["She didn't have enough credit left on her phone.","She forgot that she had promised to call them.","She didn't want them to hear her sounding unhappy."],"answer":2,"x":"/api/study-plan/monthly/sequence/level/landing/audio/4"},{"l":3,"s":"u","q":"Which sentence expresses a cautious inference?","opts":["He might have misunderstood the instructions.","He had to misunderstand the instructions.","He must not misunderstood the instructions.","He will have misunderstand the instructions."],"answer":0,"x":""},{"l":3,"s":"u","q":"Choose the strongest but fair concession.","opts":["Although the cost is high, the long-term benefits may justify it.","The cost is high, so any benefit is impossible.","The cost is high, and every benefit is certain.","The cost is high because it is high."],"answer":0,"x":""},{"l":4,"s":"g","q":"Rarely ___ such a nuanced analysis in a public debate.","opts":["we encounter","do we encounter","we do encounter","are we encounter"],"answer":1,"x":""},{"l":4,"s":"g","q":"Had the findings been replicated, the claim ___ stronger.","opts":["is","will be","would have been","was"],"answer":2,"x":""},{"l":4,"s":"v","q":"“Equivocal” evidence is ___.","opts":["overwhelming","irrelevant","open to multiple interpretations","deliberately false"],"answer":2,"x":""},{"l":4,"s":"v","q":"“Inadvertently” most nearly means ___.","opts":["unintentionally","confidently","repeatedly","strategically"],"answer":0,"x":""},{"l":4,"s":"r","q":"What rhetorical strategy does the author use?","opts":["A tentative finding followed by a definitive dismissal","A comparison of two mutually exclusive models","Concession followed by qualification","A chronological explanation with no evaluative stance"],"answer":2,"x":"The intervention undeniably improved short-term engagement. Nevertheless, treating engagement as a proxy for sustained learning risks overlooking whether participants retain and transfer the knowledge months later."},{"l":4,"s":"r","q":"Which inference is best supported?","opts":["All groups improved, but at different rates.","The analysis may mask internal differences.","The improvement cannot be attributed to the intervention.","Prior experience was excluded from the analysis."],"answer":1,"x":"Although the aggregate figures suggest modest gains, separating participants by prior experience reveals two sharply contrasting trajectories. The overall average therefore tells only part of the story."},{"l":4,"s":"l","q":"What problem did the woman have with the swan?","opts":["She misunderstood its intentions.","She underestimated the speed of its approach.","She failed to realise the consequences of disturbing it."],"answer":2,"x":"/api/study-plan/monthly/sequence/level/landing/audio/8"},{"l":4,"s":"l","q":"Scott and Liz agree that using Maori terminology in their presentation","opts":["will be of interest to international students.","is required as a component of their research.","would be best avoided."],"answer":2,"x":"/api/study-plan/monthly/sequence/level/landing/audio/10"},{"l":4,"s":"u","q":"Which claim is most carefully qualified?","opts":["The policy is guaranteed to improve outcomes.","The findings suggest an association, although causation remains unproven.","The policy works in every situation.","The evidence has eliminated all uncertainty."],"answer":1,"x":""},{"l":4,"s":"u","q":"Choose the transition that signals a consequence of the policy change.","opts":["Nevertheless","Consequently","By contrast","For example"],"answer":1,"x":""},{"l":5,"s":"g","q":"No sooner ___ the announcement been made than speculation intensified.","opts":["should","has","had","would have"],"answer":2,"x":""},{"l":5,"s":"g","q":"Were it not for the preliminary data, the hypothesis ___ untenable.","opts":["would remain","would have remained","will have remained","had remained"],"answer":0,"x":""},{"l":5,"s":"v","q":"“Perspicacious” most nearly means ___.","opts":["astute and perceptive","analytical but indecisive","precise and methodical","sceptical and dismissive"],"answer":0,"x":""},{"l":5,"s":"v","q":"“Obfuscate” an argument means to ___.","opts":["challenge its assumptions","compress its complexity","qualify its conclusions","make it less clear"],"answer":3,"x":""},{"l":5,"s":"r","q":"Which underlying critique is implied?","opts":["Staff deliberately misreported all completion figures.","The main source of inefficiency was administrative duplication.","The metrics worked poorly because too little information was collected.","A measurement framework can distort the phenomenon it purports to capture."],"answer":3,"x":"Once departments were ranked by the volume of completed cases, staff began prioritising quick resolutions. The reported efficiency gains were real in a narrow sense, but the more complex cases accumulated out of view."},{"l":5,"s":"r","q":"What is the author’s central paradox?","opts":["Uniform rules inevitably erase all socioeconomic differences.","Safeguards designed to improve fairness may introduce new inequities.","The reform failed solely because staff misapplied the scoring rules.","Extracurricular achievements provide no useful admissions evidence."],"answer":1,"x":"The revised admissions rules sought to eliminate subjective judgement. Yet by assigning rigid scores to extracurricular activities, they inadvertently advantaged applicants who could afford extensive private coaching."},{"l":5,"s":"l","q":"What do the students think about research into the impact of nutritional food labelling?","opts":["It did not produce clear results.","It focused on the wrong people.","It made unrealistic recommendations."],"answer":0,"x":"/api/study-plan/monthly/sequence/level/landing/audio/2"},{"l":5,"s":"l","q":"What does Darren now think about the Latin name of the red squirrel?","opts":["It is meaningless.","It is an amusing description.","It is suitable for this species."],"answer":2,"x":"/api/study-plan/monthly/sequence/level/landing/audio/26"},{"l":5,"s":"u","q":"Which version makes a subtle reservation without outright dismissal?","opts":["The thesis is defensible only if its critics abandon their objections.","The thesis has merit, though its underlying assumptions warrant scrutiny","The thesis is persuasive in all essential respects, notwithstanding minor uncertainties.","The thesis warrants dismissal unless every assumption is empirically proven."],"answer":1,"x":""},{"l":5,"s":"u","q":"“The arrangement was a ___ solution, intended to bridge the gap until the full system was ready.”","opts":["piecemeal","stopgap","comprehensive","permanent"],"answer":1,"x":""}];
const $=s=>document.querySelector(s),app=$('#app');
const sh=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=(crypto?.getRandomValues?crypto.getRandomValues(new Uint32Array(1))[0]:Math.floor(Math.random()*0xffffffff))%(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
let S={m:0,i:0,a:[],qs:[],pc:{},t:'6.5',d:'',mn:'60',res:null};
function payload(){
 const r=S.res||score();
 return {version:1,source:'public-level-check',level:LV[r.idx],estimated_ielts:IE[r.idx],
  goal_band:Number(S.t),exam_date:S.d||null,daily_minutes:Number(S.mn),
  correct_answers:r.total,total_questions:S.qs.length,
  skill_results:Object.fromEntries(Object.entries(r.sk).map(([skill,values])=>[skill,{correct:values[0],total:values[1]}])),
  raw_answers:S.qs.map((q,i)=>({id:q.id,answer:q.o[S.a[i]]?.k??-1})),
  created_at:new Date().toISOString()};
}
function setAudioNote(note,message){note.textContent=message;localizeTree(note,{refresh:true});}
const canTTS=()=>'speechSynthesis' in window&&typeof window.SpeechSynthesisUtterance==='function';
const stop=()=>{if(canTTS())speechSynthesis.cancel();if(window.laPublicAudio){window.laPublicAudio.pause();window.laPublicAudio.currentTime=0}};


/* Uzbek/English UI translation. Translating text nodes (not replacing cards or sections)
   preserves animations, visual layout rules, scrolling state and test answers. */
const EN_UI = {"Learners Area — Darajangizni aniqlang, rejangizni oling":"Learners Area — Find your level and get your study plan","Imkoniyatlar":"Features","Natijalar":"Results","Kirish":"Sign in","Testni boshlash":"Start test","Hisob yaratish":"Create account","Birinchi marta keldingizmi?":"New to Learners Area?","Darajangizni aniqlang.":"Find your level.","Keyingi qadam:":"Next step:","17 ta savol, taxminan 10 daqiqa. Natijangiz asosida zaif ko‘nikmangizga qaratilgan shaxsiy 30 kunlik IELTS reja tuzilishiga yordam beramiz.":"17 questions, around 10 minutes. Identify your weaker skills and get ready for a personal 30-day IELTS study plan.","Platforma haqida":"About the platform","Login talab qilinmaydi":"No sign-in required","5 ta yo‘nalish":"5 skill areas","Natija darhol":"Instant results","DARAJA · NAMUNA":"LEVEL · PREVIEW","BUGUNGI REJA · NAMUNA":"TODAY’S PLAN · PREVIEW","Vocabulary: 15 so‘z":"Vocabulary: 15 words","30 KUNLIK REJA":"30-DAY PLAN","PLATFORMA HAQIDA":"ABOUT THE PLATFORM","Ko‘nikmalar bitta joyda. Reja esa":"All skills in one place. A plan","sizga moslangan.":"made for you.","Learners Area — IELTS va ingliz tili ko‘nikmalari uchun darslar, testlar, topshiriqlar va progressni birlashtiruvchi platforma. Har bir ko‘nikma ustida alohida va tizimli ishlaysiz.":"Learners Area brings lessons, tests, assignments and progress tracking together for English and IELTS preparation. Build each skill with focused practice.","QANDAY ISHLAYDI":"HOW IT WORKS","Kamroq chalg‘ish. Ko‘proq":"Fewer distractions. More","mazmunli mashq.":"meaningful practice.","PLATFORMA ICHIDAN":"INSIDE THE PLATFORM","Mashq sahifalaridan":"A few examples of","ba’zi namunalar.":"our practice pages.","Yopish":"Close","YORDAM MARKAZI":"HELP CENTER","Ko‘p beriladigan":"Frequently asked","savollar.":"questions.","BIRINCHI QADAM":"FIRST STEP","Darajangizni biling — keyin":"Find your level — then","reja o‘zi tuziladi.":"build your study plan.","17 savol, taxminan 10 daqiqa. Testni topshirish uchun ro‘yxatdan o‘tish shart emas.":"17 questions, about 10 minutes. You can take the test without signing up.","NARX":"PRICE","Test bepul":"Free test","KIRISH":"ACCESS","Telegram orqali":"Via Telegram","NATIJA":"RESULT","Qurilmangizda saqlanadi":"Saved on your device","KEYINGI QADAM":"NEXT STEP","Qaysi ko‘nikma sizni ortga tortayotganini":"Find out which skill is","aniqlang.":"holding you back.","17 ta savol orqali taxminiy darajangizni biling. Maqsadni belgilang, keyin Learners Area’da 30 kunlik o‘quv rejangizni boshlang.":"Answer 17 questions to estimate your level. Set your goal, then start your 30-day study plan on Learners Area.","Testni boshlash →":"Start test →","Hisob yaratish →":"Create account →","MAQSAD":"GOAL","TEST":"TEST","Bepul":"Free","Natijangiz o‘zingiz bilan.":"Keep your results.","© 2026 Learners Area · Barcha huquqlar himoyalangan.":"© 2026 Learners Area · All rights reserved.","DARAJA ANIQLASH TESTI":"LEVEL ASSESSMENT","17 savol · ≈10 daqiqa":"17 questions · ≈10 minutes","A1 dan C2 gacha, bitta test.":"One test covering A1 to C2.","Savollar osondan qiyinga boradi. Javobni bilmasangiz, “Bilmayman” tugmasini bosing — taxmin qilish natijani buzadi. Listening savollarini audio orqali tinglaysiz.":"Questions range from easier to harder. If you are not sure, select “I don’t know” instead of guessing. You will hear the listening questions as audio.","Boshlash →":"Start →","▶ Tinglash":"▶ Play audio","Matn ko‘rsatilmaydi. 3 martagacha tinglash mumkin.":"Transcript hidden. You can listen up to 3 times.","Javob variantlari":"Answer options","← Ortga":"← Back","Bilmayman":"I don’t know","Natijani ko‘rish":"View result","Keyingi →":"Next →","Maqsadingizni belgilang":"Set your goal","Maqsad (IELTS band)":"Target IELTS band","Imtihon sanasi (ixtiyoriy)":"Exam date (optional)","Kunlik vaqt":"Daily study time","30 daqiqa":"30 minutes","45 daqiqa":"45 minutes","60 daqiqa":"60 minutes","90 daqiqa":"90 minutes","120 daqiqa":"120 minutes","Testni qayta topshirish":"Retake test","Rejani saqlash va boshlash →":"Save plan and get started →","Natijangiz qurilmada saqlanadi. Hisob yaratgach, 30 kunlik rejangizni platformada boshlaysiz.":"Your result is saved on your device. Create an account to start your 30-day plan.","IELTS 4.0 dan past":"Below IELTS 4.0","Starter":"Starter","Elementary":"Elementary","Intermediate":"Intermediate","Upper-intermediate":"Upper-intermediate","Advanced":"Advanced","Proficiency":"Proficiency","Asoslardan boshlaymiz: sodda grammatika va kundalik lug‘at.":"Start with the basics: everyday vocabulary and simple grammar.","Poydevor mustahkamlanadi, so‘ng IELTS formatiga o‘tiladi.":"Build a foundation before moving to the IELTS format.","Poydevor bor — endi IELTS format va strategiyasiga o‘tamiz.":"You have the basics. Focus on IELTS formats and strategies next.","IELTS 6.0–6.5 uchun yaxshi asos. Zaif ko‘nikma ko‘tariladi.":"A good foundation for IELTS 6.0–6.5. Focus on your weakest skill.","Kuchli daraja. Reja nozik xatolar va vaqt boshqaruviga qaratiladi.":"A strong level. Focus on precise answers and time management.","Yuqori daraja. Reja aniqlik va tezlikka qaratiladi.":"An advanced level. Focus on accuracy and speed.","Audio bilan ishlash va savollarga javob berish mashqlari.":"Audio-based listening practice and comprehension questions.","Matn bilan ishlash va savollarga javob berish mashqlari.":"Reading passages with focused comprehension questions.","Yozma topshiriqlar: Task 1 va Task 2 bo‘yicha mashqlar.":"Writing practice for Task 1 and Task 2.","Part 1–3 bo‘yicha gapirish mashqlari.":"Speaking practice for Parts 1–3.","Jonli darslar":"Live classes","Live class va topshiriqlarni haftalik tartibga joylang.":"Organize live classes and assignments into your weekly routine.","Natijalar dinamikasi":"Progress trends","Mock va individual faoliyat ko‘rsatkichlarini oldingi davrlar bilan solishtiring.":"Compare mock results and personal performance over time.","Aniq maqsad":"Clear goals","Har hafta asosiy prioritetlarni belgilang, bo‘shliqlarni aniqlang.":"Set weekly priorities and identify learning gaps.","Faol mashq, feedback va maqsadli takrorlash — tizimli o‘sish uchun.":"Active practice, feedback and targeted repetition for steady progress.","Testni topshiring":"Take the test","17 savol, kirishsiz. Daraja va kuchli/zaif ko‘nikmalar aniqlanadi.":"Answer 17 questions without signing in to identify strengths and weaker areas.","Rejani sozlang":"Set up your plan","Maqsad, imtihon sanasi va kunlik vaqtni tanlang — 30 kunlik reja tuziladi.":"Choose your goal, exam date and daily study time to build a 30-day plan.","Telegram orqali kiring":"Sign in via Telegram","Hozircha platformaga kirish Telegram autentifikatsiyasi orqali.":"The platform currently uses Telegram authentication.","Mashq qiling":"Keep practising","Practice → Feedback → Repeat: har mashg‘ulot aniq natija bilan yakunlanadi.":"Practice → Feedback → Repeat: every session ends with actionable feedback.","Kattalashtirish ↗":"Enlarge ↗","NAMUNA":"PREVIEW","30 kunlik reja":"30-day plan","TED va podkastlar":"TED and podcasts","Sherik bilan gaplashish":"Speak with a partner","Learners Area saytida qanday imkoniyatlar mavjud?":"What features does Learners Area offer?","Bu yerda IELTS va ingliz tili bo‘yicha Listening, Reading, Writing, Speaking, Grammar, Vocabulary, topshiriqlar va natijalar bitta platformada jamlangan.":"The platform brings Listening, Reading, Writing, Speaking, Grammar, Vocabulary, assignments and results together for English and IELTS practice.","Platformaga qanday kiraman?":"How do I sign in?","Saytga Telegram orqali hisob yaratib kirishingiz mumkin.":"Create an account and sign in through Telegram.","Savol yoki taklif bo‘lsa, kimga yozaman?":"Who can I contact with questions or suggestions?","Savol va takliflaringizni administratorga yuboring.":"Send questions or suggestions to the administrator.","Adminga yozish ↗":"Message admin ↗","3 marta tinglab bo‘ldingiz.":"You have used all 3 audio plays.","Audio yuklanmadi. Qayta urinib ko‘ring.":"Audio failed to load. Please try again.","Brauzeringiz ovozni qo‘llamaydi.":"Your browser does not support audio playback.","IELTS 9.0 va boshlash":"IELTS 9.0 and getting started","Mashq skrinshotini ko‘rish":"View a practice screenshot","Rasmni yopish":"Close image","Tilni tanlang":"Choose a language","O‘zbekcha":"Uzbek"};
const sourceText = new WeakMap();
let uiLocale='uz';
function translateText(raw){
 const match=/^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
 if(!match)return raw;
 const value=match[2];
 if(Object.prototype.hasOwnProperty.call(EN_UI,value))return match[1]+EN_UI[value]+match[3];
 const correct=value.match(/^(\d+) \/ 17 to‘g‘ri$/);
 if(correct)return match[1]+correct[1]+' / 17 correct'+match[3];
 if(value.startsWith('Taxminiy daraja: '))return match[1]+value.replace('Taxminiy daraja: ','Estimated level: ')+match[3];
 if(value.includes(' oralig‘iga mos. ')){
  const [band,note]=value.split(' oralig‘iga mos. ');
  return match[1]+(EN_UI[band]||band)+' range. '+(EN_UI[note]||note)+match[3];
 }
 if(/^Tinglash: \d+ \/ 3$/.test(value))return match[1]+value.replace('Tinglash: ','Audio plays: ')+match[3];
 return raw;
}
function localizeTree(root=document,{refresh=false}={}){
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 let node;
 while((node=walker.nextNode())){
  if(node.parentElement?.closest('style,script,noscript'))continue;
  if(refresh||!sourceText.has(node))sourceText.set(node,node.nodeValue);
  const initial=sourceText.get(node);
  const next=uiLocale==='en'?translateText(initial):initial;
  if(node.nodeValue!==next)node.nodeValue=next;
 }
 document.documentElement.lang=uiLocale;
 const modal=document.getElementById('shotModal');
 modal.setAttribute('aria-label',uiLocale==='en'?'View a practice screenshot':'Mashq skrinshotini ko‘rish');
 document.querySelector('[data-close-shot]').setAttribute('aria-label',uiLocale==='en'?'Close image':'Rasmni yopish');
 document.querySelector('.lang-switch').setAttribute('aria-label',uiLocale==='en'?'Choose a language':'Tilni tanlang');
 document.getElementById('bandJourney').setAttribute('aria-label',uiLocale==='en'?'IELTS 9.0 and getting started':'IELTS 9.0 va boshlash');
 const answerGroup=app.querySelector('[aria-label="Javob variantlari"], [aria-label="Answer options"]');
 if(answerGroup)answerGroup.setAttribute('aria-label',uiLocale==='en'?'Answer options':'Javob variantlari');
 document.querySelectorAll('[data-gallery]').forEach(btn=>{
  const shot=SHOTS[Number(btn.dataset.gallery)];
  if(shot){const title=uiLocale==='en'?(EN_UI[shot.t]||shot.t):shot.t;btn.setAttribute('aria-label',title+(uiLocale==='en'?': enlarge screenshot':': rasmni kattalashtirib ko‘rish'));const img=btn.querySelector('img');if(img)img.alt=title;}
 });
 for(const btn of document.querySelectorAll('[data-locale]'))btn.setAttribute('aria-pressed',String(btn.dataset.locale===uiLocale));
 const meta=document.querySelector('meta[name=description]');
 if(meta)meta.content=uiLocale==='en'?'Learners Area: a 17-question English level check, 30-day IELTS plan, platform features and FAQs.':'Learners Area: 17 savollik daraja aniqlash testi, 30 kunlik IELTS reja, platforma imkoniyatlari va FAQ.';
}
function setLocale(locale){
 if(!['uz','en'].includes(locale)||locale===uiLocale)return;
 uiLocale=locale;
 localizeTree();
 // Keep the exact question set, answers, current question, and progress on locale switch.
 localizeTree(app,{refresh:false});
}
document.querySelector('.lang-switch').addEventListener('click',event=>{
 const button=event.target.closest('[data-locale]');
 if(button)setLocale(button.dataset.locale);
});

function intro(){return `<div class="hd"><span>DARAJA ANIQLASH TESTI</span><span>17 savol · ≈10 daqiqa</span></div>
<h2 class="q" style="margin-top:24px">A1 dan C2 gacha, bitta test.</h2>
<p class="lead" style="margin-top:0">Savollar osondan qiyinga boradi. Javobni bilmasangiz, “Bilmayman” tugmasini bosing — taxmin qilish natijani buzadi. Listening savollarini audio orqali tinglaysiz.</p>
<button class="btn" data-a="start">Boshlash →</button>`}

function quiz(){const q=S.qs[S.i],a=S.a[S.i];
return `<div class="hd"><span>${SK[q.s].toUpperCase()} · ${LV[q.l]}</span><span>${S.i+1} / 17</span></div>
<div class="pg">${S.qs.map((_,k)=>`<i class="${k===S.i?'n':S.a[k]!==null?'d':''}"></i>`).join('')}</div>
${q.s==='r'?`<blockquote>${q.x}</blockquote>`:''}
${q.s==='l'?`<div class="au"><button class="btn o" data-a="play">▶ Tinglash</button><small id="an">Matn ko‘rsatilmaydi. 3 martagacha tinglash mumkin.</small></div>`:''}
<h2 class="q">${q.q}</h2>
<div role="group" aria-label="Javob variantlari">${q.o.map((o,k)=>`<button class="opt" aria-pressed="${a===k}" data-a="pick" data-k="${k}"><b>${'ABCD'[k]}</b>${o.t}</button>`).join('')}</div>
<div class="n2"><button class="btn o" data-a="prev" ${S.i?'':'disabled'}>← Ortga</button><button class="lk" data-a="skip">Bilmayman</button><button class="btn" data-a="next" ${a===null?'disabled':''}>${S.i===16?'Natijani ko‘rish':'Keyingi →'}</button></div>`}

function score(){const n=Array(6).fill(0),c=Array(6).fill(0),sk={};let sc=0,mx=0;
S.qs.forEach((q,i)=>{const ok=Number.isInteger(S.a[i])&&S.a[i]>=0&&q.o[S.a[i]].ok;n[q.l]++;mx+=q.l+1;(sk[q.s]=sk[q.s]||[0,0])[1]++;if(ok){c[q.l]++;sc+=q.l+1;sk[q.s][0]++}});
const p=sc/mx;let idx=[.22,.38,.54,.70,.86].filter(t=>p>=t).length,sec=-1;
c.forEach((v,L)=>{if(v>=2)sec=L});idx=Math.min(idx,sec+1); /* tasodifiy topishdan himoya: yuqori daraja kamida 2 ta to‘g‘ri javob talab qiladi */
const rk=Object.entries(sk).map(([k,v])=>[k,v[0]/v[1]]).sort((x,y)=>x[1]-y[1]||ORD.indexOf(x[0])-ORD.indexOf(y[0]));
return{p,idx,sk,rk,total:c.reduce((x,y)=>x+y,0)}}

function result(){const r=S.res=score(),L=r.idx,today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
return `<div class="hd"><span>NATIJA</span><span>${r.total} / 17 to‘g‘ri</span></div>
<div class="rs"><div class="ring" style="--p:${Math.round(r.p*100)}"><div><span><b>${LV[L]}</b><small>${NM[L]}</small></span></div></div>
<div><h2>Taxminiy daraja: ${LV[L]}</h2><p class="lead">${IE[L]} oralig‘iga mos. ${NT[L]}</p></div></div>
${ORD.map(k=>{const v=r.sk[k];return `<div class="sr"><span>${SK[k]}</span><div class="bar"><u style="width:${v[0]/v[1]*100}%"></u></div><b>${v[0]}/${v[1]}</b></div>`}).join('')}
<hr><h3 class="t">Maqsadingizni belgilang</h3>
<div class="fm"><label>Maqsad (IELTS band)<select id="tb">${['5.5','6.0','6.5','7.0','7.5','8.0','8.5','9.0'].map(x=>`<option ${x===S.t?'selected':''}>${x}</option>`).join('')}</select></label>
<label>Imtihon sanasi (ixtiyoriy)<input id="dt" type="date" min="${today}" value="${S.d}"></label>
<label>Kunlik vaqt<select id="mn">${['30','45','60','90','120'].map(x=>`<option value="${x}" ${x===S.mn?'selected':''}>${x} daqiqa</option>`).join('')}</select></label></div>
<div class="n2"><button class="lk" data-a="again">Testni qayta topshirish</button><button class="btn" data-a="save">Rejani saqlash va boshlash →</button></div>
<p class="fine">Natijangiz qurilmada saqlanadi. Hisob yaratgach, 30 kunlik rejangizni platformada boshlaysiz.</p>`}

function draw(){stop();app.innerHTML=S.m===0?intro():S.m===1?quiz():result();localizeTree(app,{refresh:true})}
const go=n=>{S.i=n;if(n>16){S.m=2}draw()};
const act={
start(){
 const counts=[2,3,3,3,3,3];let selected=[];
 for(let tries=0;tries<100;tries++){
  selected=counts.flatMap((need,level)=>sh(Q.filter(q=>q.l===level)).slice(0,need));
  if(['g','v','r','l','u'].every(s=>selected.filter(q=>q.s===s).length>=2))break;
 }
 S.qs=sh(selected).map(q=>({id:LV[q.l]+'-'+({g:'grammar',v:'vocabulary',r:'reading',l:'listening',u:'use'}[q.s])+'-'+Q.slice(0,Q.indexOf(q)+1).filter(x=>x.l===q.l&&x.s===q.s).length,l:q.l,s:q.s,q:q.q,x:q.x,o:sh(q.opts.map((t,k)=>({t,k,ok:k===q.answer})))}));
 S.a=Array(17).fill(null);S.pc={};S.i=0;S.m=1;draw();app.scrollIntoView({block:'start'})},
pick(b){S.a[S.i]=+b.dataset.k;draw()},
skip(){S.a[S.i]=-1;go(S.i+1)},
next(){go(S.i+1)},
prev(){if(S.i)go(S.i-1)},
again(){S.m=0;draw()},
play(){const q=S.qs[S.i],note=$('#an');
if(q.x.startsWith('/api/')){
 const src='https://learnersarea.uz'+q.x;stop();
 let audio=window.laPublicAudio;
 if(audio){audio.pause();audio.removeAttribute('src');}
 if((S.pc[S.i]||0)>=3){setAudioNote(note,'3 marta tinglab bo‘ldingiz.');return}
 S.pc[S.i]=(S.pc[S.i]||0)+1;
 audio=new Audio(src);window.laPublicAudio=audio;
 audio.play().then(()=>{setAudioNote(note,`Tinglash: ${S.pc[S.i]} / 3`)}).catch(()=>{S.pc[S.i]--;setAudioNote(note,'Audio yuklanmadi. Qayta urinib ko‘ring.')});return;
 }
 if(!canTTS()){setAudioNote(note,'Brauzeringiz ovozni qo‘llamaydi.');return}
if((S.pc[S.i]||0)>=3){setAudioNote(note,'3 marta tinglab bo‘ldingiz.');return}
S.pc[S.i]=(S.pc[S.i]||0)+1;stop();const u=new SpeechSynthesisUtterance(q.x);u.lang='en-GB';u.rate=.92;speechSynthesis.speak(u);setAudioNote(note,`Tinglash: ${S.pc[S.i]} / 3`)},
save(){try{localStorage.setItem('la:level-check:v1',JSON.stringify(payload()));sessionStorage.setItem('la:public-plan-intent:v1',String(Date.now()))}catch(e){}void navigate(REGISTER)}
};
app.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b&&act[b.dataset.a])act[b.dataset.a](b)});
app.addEventListener('input',e=>{const id=e.target.id;if(id==='tb')S.t=e.target.value;else if(id==='dt')S.d=e.target.value;else if(id==='mn')S.mn=e.target.value;else return});
onDocument('keydown',e=>{if(S.m!==1||/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName))return;
const k='1234'.indexOf(e.key);if(k>-1){act.pick({dataset:{k}})}else if(e.key==='Enter'&&S.a[S.i]!==null)act.next()});
draw();
if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}}),{threshold:.12});document.querySelectorAll('.rv').forEach(n=>io.observe(n))}else document.querySelectorAll('.rv').forEach(n=>n.classList.add('in'));

const rt=$('#rot'),RW=['Listening','Reading','Writing','Speaking'];let wi=0;
onInterval(()=>{rt.classList.add('o');onTimeout(()=>{wi=(wi+1)%4;rt.textContent=RW[wi];rt.classList.remove('o')},350)},2400);
const hr=$('#hr'),hl=$('#hl'),hi=$('#hi');let li=3;
onInterval(()=>{li=(li+1)%6;hr.style.setProperty('--p',(li+1)/6*100);hl.textContent=LV[li];hi.textContent=IE[li];localizeTree(hi,{refresh:true})},2000);
$('#wv').innerHTML=Array.from({length:28},(_,i)=>`<i style="animation-delay:${(i*83)%900}ms;--h:${25+Math.abs(Math.sin(i*1.3))*70}%"></i>`).join('');
const stg=$('.stage'),sb=$('#sb');
onWindow('pointermove',e=>{stg.style.setProperty('--px',e.clientX/innerWidth-.5);stg.style.setProperty('--py',e.clientY/innerHeight-.5);const c=e.target.closest&&e.target.closest('.bn');if(c){const r=c.getBoundingClientRect();c.style.setProperty('--mx',e.clientX-r.left+'px');c.style.setProperty('--my',e.clientY-r.top+'px')}});
onWindow('scroll',()=>{sb.style.transform=`scaleX(${scrollY/Math.max(1,document.body.scrollHeight-innerHeight)})`},{passive:true});
document.querySelectorAll('[data-n]').forEach(n=>{const o=new IntersectionObserver(([x])=>{if(!x.isIntersecting)return;o.disconnect();const t=+n.dataset.n;let s=null;const f=ts=>{s=s??ts;const p=Math.min((ts-s)/1200,1);n.textContent=Math.round(t*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(f)};requestAnimationFrame(f)});o.observe(n)});

/* === O‘ZGARTIRILADIGAN MA’LUMOTLAR: haqiqiy skrinshot va natijalarni shu yerga yozing === */
const TG_BOT='https://t.me/Learnersareaaccessbot';
const SHOTS=[{"t":"Dashboard","img":"/brand/landing/94ffa7f3e9deaa3b61f5.webp"},{"t":"30 kunlik reja","img":"/brand/landing/a3f27a5ff6d61aa95ac1.webp"},{"t":"TED va podkastlar","img":"/brand/landing/d0ffb7c39fc10da35d30.webp"},{"t":"Listening MCQ","img":"/brand/landing/de4c0ab4edf6a01410bb.webp"},{"t":"Academic Reading","img":"/brand/landing/60468a287e7ddf2b6f7c.webp"},{"t":"Reading Articles","img":"/brand/landing/bf0ff9934dda5646fd61.webp"},{"t":"Retention","img":"/brand/landing/26c573ccdbd9e138320c.webp"},{"t":"Speak or Die","img":"/brand/landing/65dcacf2c6b2bff709cd.webp"},{"t":"Sherik bilan gaplashish","img":"/brand/landing/7aadcdfe26efe89a5570.webp"},{"t":"Writing Typing","img":"/brand/landing/b055a4ca95e966fba45b.webp"}];
const P={L:'M4 14v-2a8 8 0 0 1 16 0v2M4 14.5A1.5 1.5 0 0 1 5.5 13H7v6H5.5A1.5 1.5 0 0 1 4 17.5zM20 14.5a1.5 1.5 0 0 0-1.5-1.5H17v6h1.5a1.5 1.5 0 0 0 1.5-1.5z',R:'M4 5.5C4 4.7 4.7 4 5.5 4H10a2 2 0 0 1 2 2v14a1.8 1.8 0 0 0-1.8-1.8H4zM20 5.5c0-.8-.7-1.5-1.5-1.5H14a2 2 0 0 0-2 2v14a1.8 1.8 0 0 1 1.8-1.8H20z',W:'M5 20h14M7 16.5 16.2 7.3a1.8 1.8 0 0 1 2.5 2.5L9.5 19l-3.5 1z',S:'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',V:'M3 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3zM16 11l5-3v8l-5-3z',C:'M3 20h18M5 15.5l4.5-5 3.5 3L20 6M16 6h4v4',T:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',X:'M4 12a8 8 0 0 1 14-5.3L20 8M20 4v4h-4M20 12a8 8 0 0 1-14 5.3L4 16M4 20v-4h4'};
const ic=(p,n)=>`<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;
const TL=[['Listening','Audio bilan ishlash va savollarga javob berish mashqlari.','#32ded0','L','w7'],['Reading','Matn bilan ishlash va savollarga javob berish mashqlari.','#3970ff','R','w5'],['Writing','Yozma topshiriqlar: Task 1 va Task 2 bo‘yicha mashqlar.','#e6b94f','W','w5'],['Speaking','Part 1–3 bo‘yicha gapirish mashqlari.','#9b7bff','S','w7'],['Jonli darslar','Live class va topshiriqlarni haftalik tartibga joylang.','#32ded0','V','w3'],['Natijalar dinamikasi','Mock va individual faoliyat ko‘rsatkichlarini oldingi davrlar bilan solishtiring.','#3970ff','C','w3'],['Aniq maqsad','Har hafta asosiy prioritetlarni belgilang, bo‘shliqlarni aniqlang.','#e6b94f','T','w3'],['Practice → Feedback → Repeat','Faol mashq, feedback va maqsadli takrorlash — tizimli o‘sish uchun.','#9b7bff','X','w3']];
$('#tg').innerHTML=TL.map(([t,d,c,p,w])=>`<div class="tl ${w}" style="--rg:${c}"><span class="ti">${ic(P[p],28)}</span><h3>${t}</h3><p>${d}</p><span class="bg2">${ic(P[p],170)}</span></div>`).join('');
$('#stp').innerHTML=[['1','Testni topshiring','17 savol, kirishsiz. Daraja va kuchli/zaif ko‘nikmalar aniqlanadi.'],['2','Rejani sozlang','Maqsad, imtihon sanasi va kunlik vaqtni tanlang — 30 kunlik reja tuziladi.'],['3','Telegram orqali kiring','Hozircha platformaga kirish Telegram autentifikatsiyasi orqali.'],['4','Mashq qiling','Practice → Feedback → Repeat: har mashg‘ulot aniq natija bilan yakunlanadi.']].map(([n,t,d])=>`<div class="sp"><i>${n}</i><div><h3>${t}</h3><p>${d}</p></div></div>`).join('');
const shot=x=>x.img?`<button class="sc screenshot" type="button" data-gallery="${SHOTS.indexOf(x)}" aria-label="${x.t}: rasmni kattalashtirib ko‘rish"><img src="${x.img}" alt="${x.t}" loading="lazy"><span class="shot-zoom">Kattalashtirish ↗</span></button>`:`<div class="sc" style="--k:${x.k}"><div class="wb"><i></i><i></i><i></i><b>${x.t}</b></div><div class="sk"><u class="a" style="width:46%"></u><u style="width:92%"></u><u style="width:78%"></u><s class="on"></s><s></s><s></s></div><span class="nt">NAMUNA</span></div>`;
const row=(a,f)=>{const h=a.map(f).join('');return h+h};
$('#r1>div').innerHTML=row(SHOTS.slice(0,5),shot);
$('#r2>div').innerHTML=row(SHOTS.slice(5),shot);
$('#fqs').innerHTML=[
 ['Learners Area saytida qanday imkoniyatlar mavjud?','Bu yerda IELTS va ingliz tili bo‘yicha Listening, Reading, Writing, Speaking, Grammar, Vocabulary, topshiriqlar va natijalar bitta platformada jamlangan.'],
 ['Platformaga qanday kiraman?','Saytga Telegram orqali hisob yaratib kirishingiz mumkin.'],
 ['Savol yoki taklif bo‘lsa, kimga yozaman?','Savol va takliflaringizni administratorga yuboring.']
].map(([q,a],i)=>`<details class="fq"><summary>${q}</summary><div class="faq-answer"><p>${a}</p>${i===2?'<a class="btn" href="https://t.me/learnersareaaccessbot" target="_blank" rel="noopener noreferrer">Adminga yozish ↗</a>':''}</div></details>`).join('');
localizeTree(document,{refresh:true});

const modal=$('#shotModal');const modalImg=$('#shotLarge');const modalCaption=$('#shotCaption');
let modalSource=null;
function closeShot(){if(!modal.open)return;modal.close();modalImg.removeAttribute('src');modalSource?.focus();}
document.querySelector('#r1').addEventListener('click',openShot);
document.querySelector('#r2').addEventListener('click',openShot);
function openShot(e){const trigger=e.target.closest('[data-gallery]');if(!trigger)return;
 const shot=SHOTS[Number(trigger.dataset.gallery)];if(!shot)return;
 modalSource=trigger;modalImg.src=shot.img;modalImg.alt=shot.t;modalCaption.textContent=shot.t;modal.showModal();localizeTree(modal,{refresh:true});}
modal.addEventListener('click',e=>{if(e.target===modal)closeShot()});
modal.querySelector('[data-close-shot]').addEventListener('click',closeShot);
modal.addEventListener('close',()=>modalImg.removeAttribute('src'));

let pointerFrame=0,pointerX=innerWidth/2,pointerY=innerHeight/2;
onWindow('pointermove',e=>{
 if(e.pointerType!=='mouse')return;
 document.documentElement.classList.add('has-mouse');
 pointerX=e.clientX;pointerY=e.clientY;
 if(pointerFrame)return;
 pointerFrame=requestAnimationFrame(()=>{
  document.documentElement.style.setProperty('--mouse-x',pointerX+'px');
  document.documentElement.style.setProperty('--mouse-y',pointerY+'px');pointerFrame=0;
 });
},{passive:true});


const journey=$('#bandJourney');
const bigNumber=$('#bigBandNumber');
const zero=bigNumber.querySelector('.band-zero');
const introReveal=$('#introReveal');
const introHint=$('#introHint');
const hero=$('#openingHero');
const siteNav=document.querySelector('nav');
const panorama=$('#cinematicBackdrop');
const globeFrame=$('#cinematicGlobeFrame');
const globeImage=$('#cinematicEarthImage');
const earthLayer=$('#cinematicEarth');
const skyLayer=$('#cinematicSky');
const skyImage=$('#cinematicSkyImage');
const desertLayer=$('#cinematicDunes');
const desertVideo=$('#cinematicDesertVideo');
const testSection=$('#test');
const featuresSection=$('#imkon');
const clamp01=value=>Math.max(0,Math.min(1,value));
const smoothstep=value=>{const t=clamp01(value);return t*t*(3-2*t)};
const mix=(a,b,t)=>a+(b-a)*t;
const pageTop=node=>node.getBoundingClientRect().top+scrollY;
let journeyFrame=0, videoRequested=false;
let paintState={scroll:0,sky:0,dunes:0,earth:0};
function updateJourney(){
 journeyFrame=0;
 const viewport=Math.max(1,innerHeight);
 const scroll=Math.max(0,scrollY);
 const introStart=pageTop(journey);
 const introTravel=Math.max(1,journey.offsetHeight-viewport);
 const p=clamp01((scroll-introStart)/introTravel);
 const portalZoom=1+7*Math.pow(clamp01((p-.025)/.59),1.45);
 const offset=zero.offsetLeft+zero.offsetWidth/2-bigNumber.offsetWidth/2;
 bigNumber.style.setProperty('--zoom',String(portalZoom));
 bigNumber.style.setProperty('--band-x',String(-offset*portalZoom*clamp01(p/.52))+'px');
 bigNumber.style.opacity=String(1-smoothstep((p-.52)/.17));
 const portal=smoothstep((p-.36)/.32);
 const portalMask='circle('+(portal*160)+'vmax at 50% 50%)';
 panorama.style.clipPath=portalMask;
 panorama.style.webkitClipPath=portalMask;
 panorama.style.opacity=String(smoothstep((p-.34)/.15));
 introReveal.style.opacity=String(smoothstep((p-.52)/.15));
 const navOpacity=smoothstep((p-.68)/.14);
 document.body.style.setProperty('--intro-nav-opacity',String(navOpacity));
 siteNav.inert=navOpacity<=.98;
 siteNav.style.pointerEvents=navOpacity>.98?'auto':'none';
 siteNav.setAttribute('aria-hidden',navOpacity>.98?'false':'true');
 introHint.style.opacity=String(1-smoothstep((p-.06)/.18));

 // One continuous virtual camera. The background stays 100% of the viewport;
 // the Earth tilts/zooms, the sky rises, and then the original dunes rise.
 // No fixed-height image strip, nested scroll, lazy image or hard cut is used.
 const heroStart=pageTop(hero);
 const testStart=pageTop(testSection);
 const featuresStart=pageTop(featuresSection);
 const earthApproach=smoothstep((scroll-(introStart+introTravel*.57))/
   Math.max(1,(heroStart+hero.offsetHeight*.44)-(introStart+introTravel*.57)));
 const skyStart=heroStart+hero.offsetHeight*.35;
 const skyEnd=testStart+viewport*.28;
 const skyProgress=smoothstep((scroll-skyStart)/Math.max(1,skyEnd-skyStart));
 const dunesStart=testStart+viewport*.40;
 const dunesEnd=featuresStart+viewport*.55;
 const duneProgress=smoothstep((scroll-dunesStart)/Math.max(1,dunesEnd-dunesStart));
 const globeScale=1+.92*earthApproach;
 globeFrame.style.transform='perspective(1500px) rotateX('+(-12*earthApproach)+'deg) translate3d(0,'+(-7*earthApproach)+'%,0)';
 globeImage.style.transform='scale('+globeScale+') translate3d(0,'+(-10*earthApproach)+'%,0)';
 earthLayer.style.opacity='1';
 skyLayer.style.opacity=String(smoothstep((skyProgress-.01)/.90));
 skyLayer.style.transform='translate3d(0,'+mix(18,-18,skyProgress)+'vh,0)';
 skyImage.style.transform='scale('+(1.03+.11*skyProgress)+') translate3d(0,'+(-4*skyProgress)+'%,0)';
 desertLayer.style.opacity=String(smoothstep((duneProgress-.01)/.91));
 desertLayer.style.transform='translate3d(0,'+mix(18,-18,duneProgress)+'vh,0)';
 paintState={scroll,sky:skyProgress,dunes:duneProgress,earth:earthApproach};

 // The poster is always present. Download the small muted video only near use.
 const videoNear=duneProgress>.01 && scroll<featuresStart+viewport*4;
 if(videoNear && !videoRequested){
  videoRequested=true;
  if(!desertVideo.src){desertVideo.src=desertVideo.dataset.src;desertVideo.load();}
 }
 if(videoNear && !document.hidden){
  if(desertVideo.paused)desertVideo.play().catch(()=>{});
 }else if(!desertVideo.paused){desertVideo.pause();}
}
function queueJourney(){if(!journeyFrame)journeyFrame=requestAnimationFrame(updateJourney)}
onWindow('scroll',queueJourney,{passive:true});
onWindow('resize',queueJourney,{passive:true});
onWindow('pageshow',queueJourney);
if(window.visualViewport)visualViewport.addEventListener('resize',queueJourney,{passive:true});
if(document.fonts?.ready)document.fonts.ready.then(queueJourney).catch(()=>{});
if(window.ResizeObserver){
 const watch=new ResizeObserver(queueJourney);
 signal.addEventListener('abort',()=>watch.disconnect(),{once:true});
 [journey,hero,testSection,featuresSection].forEach(node=>watch.observe(node));
}
onDocument('visibilitychange',()=>{
 if(document.hidden){desertVideo.pause();}
 else queueJourney();
});
desertVideo.addEventListener('playing',()=>desertLayer.classList.add('cinematic-video-ready'));
desertVideo.addEventListener('pause',()=>desertLayer.classList.remove('cinematic-video-ready'));
desertVideo.addEventListener('error',()=>desertLayer.classList.remove('cinematic-video-ready'));
window.__laCinematicState=()=>({...paintState});
updateJourney();


 const buttons=root.querySelectorAll('nav .nav-actions a.btn, .hero a.hc[href="#test"], .reversed-finale .band-story-actions a.btn');
 const observers=[];
 for(const button of buttons){
  if(button.classList.contains('la-roll-button'))continue;
  const label=Array.from(button.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim()
   ||button.textContent.replace(/[→↗]+/g,'').trim();
  if(!label)continue;
  button.classList.add('la-roll-button');
  button.replaceChildren();
  const clip=document.createElement('span');clip.className='la-roll-clip';
  const track=document.createElement('span');track.className='la-roll-track';
  const a=document.createElement('span');a.className='la-roll-label';a.textContent=label;
  const b=document.createElement('span');b.className='la-roll-label';b.textContent=label;b.setAttribute('aria-hidden','true');
  const arrow=document.createElement('span');arrow.className='la-roll-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
  track.append(a,b);clip.append(track);button.append(clip,arrow);
  const observer=new MutationObserver(()=>{if(b.textContent!==a.textContent)b.textContent=a.textContent});
  observer.observe(a,{childList:true,characterData:true,subtree:true});
  observers.push(observer);
 }
 signal.addEventListener('abort',()=>observers.forEach(observer=>observer.disconnect()),{once:true});
 root.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const anchor=event.target.closest?.('a[href]');
  if(!anchor||!root.contains(anchor)||anchor.hasAttribute('download')||(anchor.target&&anchor.target!=='_self'))return;
  const href=anchor.getAttribute('href');
  if(href==='/login'||href==='/register'){
   event.preventDefault();void navigate(href);return;
  }
  if(!href?.startsWith('#'))return;
  const destination=root.querySelector('#'+CSS.escape(href.slice(1)));
  if(!destination)return;
  event.preventDefault();
  if(href==='#test'){
   const start=destination.querySelector('[data-a="start"]');
   if(start){start.click();return;}
  }
  destination.scrollIntoView({behavior:'smooth',block:'start'});
 },{capture:true,signal});
}
