import {el, listen} from '../../js/dom.js';
import {MOCK_EXAM_CSS} from './exam-surface.js';
import {cdSplit} from '../shared/cd-layout.js';

const CSS = `
.mock-native{color:#17212d;background:#fff;border:1px solid #cad3dd;border-radius:10px;overflow:hidden;font:16px/1.55 Arial,sans-serif}
.mock-native *{box-sizing:border-box}.mock-native button,.mock-native input,.mock-native select{font:inherit;color:inherit}
.mock-native-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;background:#f5f7f9;border-bottom:1px solid #cad3dd}
.mock-native-tabs,.mock-native-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mock-native button{background:white;border:1px solid #aab8c7;border-radius:5px;padding:6px 11px;cursor:pointer}
.mock-native button[aria-selected=true]{background:#dfedfb;border-color:#155a9f;color:#124777}.mock-native-grid{display:grid;grid-template-columns:minmax(0,var(--cd-split,50%)) 3px minmax(0,1fr);min-height:430px}
.mock-native-pane{padding:24px;max-height:66vh;overflow:auto}.mock-native-pane:first-child{border-right:0}.mock-native h3{font-size:21px;margin:0 0 18px}.mock-native h4{font-size:18px;margin:0 0 12px}
.mock-native p{margin:0 0 14px;white-space:pre-wrap}.mock-native-group{margin-bottom:30px}.mock-native-question{padding:14px 0;border-bottom:1px solid #e1e7ed;scroll-margin-top:20px}
.mock-native input[type=text],.mock-native select{border:1px solid #8c9eaf;border-radius:4px;background:#fff;min-width:110px;max-width:240px;padding:7px 9px;margin:3px 5px}
.mock-native input:focus,.mock-native select:focus{outline:2px solid #287dbd;outline-offset:1px}.mock-native-choice{display:flex;align-items:flex-start;gap:10px;margin:7px 0;padding:8px;border:1px solid #d9e1ea;border-radius:5px;cursor:pointer}
.mock-native-choice input{margin-top:5px;accent-color:#155a9f}.mock-native-stimulus{white-space:pre-wrap;background:#f7f9fb;border:1px solid #d4dee8;padding:16px;border-radius:6px}
.mock-native-legend{padding:14px 18px;background:#f7f9fb;border:1px solid #d4dee8;border-radius:6px;margin:12px 0;list-style:none}.mock-native-legend li{padding:4px 0}
.mock-native-nav{padding:12px 18px;border-top:1px solid #cad3dd;background:#f8fafc}.mock-native-nav button{padding:3px 7px;font-size:13px}.mock-native-nav button[data-answered=true]{background:#dff0e8;border-color:#63a687}
.mock-review{grid-column:1/-1}.mock-review details{border:1px solid #cbd5e1;border-radius:7px;padding:12px;margin-top:10px}.mock-review summary{cursor:pointer}.mock-review blockquote{white-space:pre-wrap;border-left:3px solid #3278ac;padding:10px 16px;margin:12px 0;background:#f4f8fb}
.mock-native .cd-divider{position:relative;cursor:col-resize;background:#aab8c7;touch-action:none}.mock-native .cd-divider span{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #8c9eaf;padding:3px;color:#17212d}.mock-reading-tools{display:flex;gap:8px}.mock-reading-mobile{display:none}
@media(max-width:760px){.mock-native-grid{grid-template-columns:1fr}.mock-native .cd-divider{display:none}.mock-reading-mobile{display:flex;gap:8px;padding:8px 18px}.mock-native[data-mock-native=reading][data-reading-pane=passage] .mock-native-pane:last-child,.mock-native[data-mock-native=reading][data-reading-pane=questions] .mock-native-pane:first-child{display:none}.mock-native-pane{max-height:55vh;padding:18px}.mock-native-pane:first-child{border-right:0;border-bottom:1px solid #cad3dd}.mock-native-head{align-items:flex-start;flex-direction:column}.mock-native input[type=text]{max-width:180px}}
`;

export function renderObjectiveMaterial({material, skill, answers, onAnswer, signal, audioWidget=null}) {
  const questions = Array.isArray(material.questions) ? material.questions : [];
  const groups = Array.isArray(material.groups) && material.groups.length ? material.groups
    : questions.map(q=>({id:`question-${q.id}`,part:q.part||1,title:'',questionIds:[String(q.id)]}));
  const passages = Array.isArray(material.passages) ? material.passages : [];
  const parts = [...new Set(questions.map(q => Number(q.part || 1)))].sort((a,b) => a-b);
  const left = el('section', {class:'mock-native-pane', 'aria-label':skill==='reading'?'Reading passage':'Listening questions'});
  const right = el('section', {class:'mock-native-pane', 'aria-label':'Questions'});
  const tabs = el('div', {class:'mock-native-tabs', role:'tablist', 'aria-label':'Exam parts'});
  const navigation = el('nav', {class:'mock-native-nav', 'aria-label':'Question navigation'});
  const split=cdSplit(left,right,signal);
  split.classList.add('mock-native-grid');
  const readingTools=el('div',{class:'mock-reading-tools'});
  if(skill==='reading'){
    let fontSize=16;
    for(const [label,delta] of [['Decrease font size',-1],['Increase font size',1]]){
      const button=el('button',{type:'button','aria-label':label},delta<0?'A−':'A+');
      listen(button,'click',()=>{fontSize=Math.max(14,Math.min(22,fontSize+delta));left.style.fontSize=fontSize+'px';right.style.fontSize=fontSize+'px';},signal);
      readingTools.append(button);
    }
  }
  const mobileTabs=el('div',{class:'mock-reading-mobile',role:'tablist','aria-label':'Reading panes'});
  const root = el('section', {class:'mock-native', 'data-mock-native':skill,'data-reading-pane':'passage'},
    el('style',{},MOCK_EXAM_CSS + CSS),
    el('header',{class:'mock-native-head'},el('strong',{},`Learners Area · ${skill==='reading'?'Reading':'Listening'}`),skill==='listening'?audioWidget:readingTools),
    skill==='reading'?mobileTabs:null,split,el('footer',{class:'mock-native-footer'},tabs,navigation));
  for(const [key,label] of [['passage','Passage'],['questions','Questions']]){
    const button=el('button',{type:'button',role:'tab','aria-selected':String(key==='passage')},label);
    listen(button,'click',()=>{root.dataset.readingPane=key;for(const b of mobileTabs.children)b.setAttribute('aria-selected',String(b===button));},signal);
    mobileTabs.append(button);
  }
  const panels=[];
  const buttons=[];
  const navButtons=new Map();
  const save=(qid,value)=>{
    answers[qid]=value;
    navButtons.get(qid)?.setAttribute('data-answered',String(Boolean(value.trim())));
    onAnswer(qid,value);
  };
  const inputFor=(qid)=>{
    const input=el('input',{type:'text',value:answers[qid]||'',placeholder:qid,
      'aria-label':`Question ${qid}`,'data-native-question':qid,'data-mock-question-input':qid,
      'data-focus-key':`${skill}-q-${qid}`,autocomplete:'off',spellcheck:'false'});
    listen(input,'input',()=>save(qid,input.value),signal);
    return input;
  };
  const tokens=(text,host)=>{
    const seen=new Set();
    for(const piece of String(text).split(/(\{\{\d+\}\})/g)){
      const hit=piece.match(/^\{\{(\d+)\}\}$/);
      if(hit&&!seen.has(hit[1])){
        seen.add(hit[1]);host.append(el('label',{},el('strong',{},hit[1]),inputFor(hit[1])));
      }else host.append(document.createTextNode(hit?`[Question ${hit[1]}]`:piece));
    }
    return host;
  };
  const questionNode=(q,group)=>{
    const qid=String(q.id);const row=el('div',{class:'mock-native-question','data-native-row':qid});
    const text=String(q.questionText||q.question_text||'');
    if(text.includes(`{{${qid}}}`))return tokens(text,row);
    row.append(el('p',{},el('strong',{},`${q.order||qid}. `),text));
    const options=q.options||group.sharedChoices||[];
    const type=q.type_code||q.type||'completion';
    if(['multiple_choice','true_false_not_given','yes_no_not_given'].includes(type)&&options.length){
      for(const option of options){
        const label=String(option.label??option.value??'');
        const input=el('input',{type:'radio',name:`${skill}-q${qid}`,value:label,
          'aria-label':`Question ${qid}: ${label}`,'data-mock-question-input':qid,'data-native-question':qid,
          'data-focus-key':`${skill}-q-${qid}-${label}`});
        input.checked=answers[qid]===label;
        listen(input,'change',()=>{if(input.checked)save(qid,label);},signal);
        const title=String(option.text||label);
        row.append(el('label',{class:'mock-native-choice'},input,el('span',{},title===label?label:`${label}. ${title}`)));
      }
    }else if(type==='matching'&&options.length){
      const select=el('select',{'aria-label':`Question ${qid}`,'data-mock-question-input':qid,
        'data-native-question':qid,'data-focus-key':`${skill}-q-${qid}`},
        el('option',{value:''},'Select…'),...options.map(o=>el('option',{value:String(o.label??o.value)},String(o.label??o.value))));
      select.value=answers[qid]||'';
      listen(select,'change',()=>save(qid,select.value),signal);row.append(select);
    }else row.append(inputFor(qid));
    return row;
  };
  const activate=(part)=>{
    for(const item of panels)item.node.hidden=item.part!==part;
    for(const item of buttons)item.node.setAttribute('aria-selected',String(item.part===part));
  };
  for(const part of parts){
    const tab=el('button',{type:'button',role:'tab','aria-selected':String(part===parts[0])},`${skill==='reading'?'Passage':'Part'} ${part}`);
    listen(tab,'click',()=>activate(part),signal);tabs.append(tab);buttons.push({part,node:tab});
    if(skill==='reading'){
      const passage=passages.find(p=>Number(p.passageNo||String(p.id).replace(/\D/g,''))===part);
      const pane=el('article',{},el('h3',{},passage?.title||`Passage ${part}`),el('p',{},passage?.bodyText||''));
      left.append(pane);panels.push({part,node:pane});
    }
    const pane=el('div',{'data-native-part':part});
    const leftQuestions=skill==='listening'?el('div',{'data-native-left-part':part}):null;
    const partGroups=groups.filter(g=>Number(g.part||1)===part);
    for(const [groupIndex,group] of partGroups.entries()){
      const section=el('section',{class:'mock-native-group'},el('h4',{},group.title||'Questions'),
        group.instructions?el('p',{},group.instructions):null);
      if(group.sharedChoices?.length)section.append(el('ul',{class:'mock-native-legend'},...group.sharedChoices.map(o=>el('li',{},el('strong',{},`${o.label} `),o.text))));
      const groupQuestions=(group.questionIds||[]).map(id=>questions.find(q=>String(q.id)===String(id))).filter(Boolean);
      if(group.type==='multiple_choice_multi'){
        const selected=new Set(groupQuestions.map(q=>answers[String(q.id)]).filter(Boolean));
        const counter=el('p',{'aria-live':'polite'},`${selected.size} / ${group.selectionCount} selected`);
        for(const option of group.options||[]){
          const value=String(option.label??option.value);const input=el('input',{type:'checkbox',value,
            'aria-label':`${group.title}: ${value}`,'data-native-question':String(groupQuestions[0]?.id||''),
            'data-focus-key':`${skill}-${group.id}-${value}`});
          input.checked=selected.has(value);
          listen(input,'change',()=>{
            if(input.checked&&selected.size>=group.selectionCount){input.checked=false;return;}
            if(input.checked)selected.add(value);else selected.delete(value);
            const values=[...selected];groupQuestions.forEach((q,index)=>save(String(q.id),values[index]||''));
            counter.textContent=`${selected.size} / ${group.selectionCount} selected`;
          },signal);
          section.append(el('label',{class:'mock-native-choice'},input,`${value}. ${option.text||value}`));
        }
        section.append(counter);
      }else if(group.stimulusText)section.append(tokens(group.stimulusText,el('div',{class:'mock-native-stimulus'})));
      else groupQuestions.forEach(q=>section.append(questionNode(q,group)));
      (leftQuestions && groupIndex < Math.ceil(partGroups.length / 2) ? leftQuestions : pane).append(section);
    }
    if(leftQuestions){left.append(leftQuestions);panels.push({part,node:leftQuestions});}
    right.append(pane);panels.push({part,node:pane});
  }
  for(const q of questions){
    const qid=String(q.id);const button=el('button',{type:'button','data-answered':String(Boolean(answers[qid])),'aria-label':`Go to question ${qid}`},q.order||qid);
    navButtons.set(qid,button);
    listen(button,'click',()=>{
      activate(Number(q.part||1));
      if(skill==='reading')mobileTabs.lastElementChild.click();
      const targetId=String(q.pair?.[0]||qid);
      const target=[...root.querySelectorAll('[data-native-question]')].find(n=>n.getAttribute('data-native-question')===targetId);
      target?.scrollIntoView({block:'center'});target?.focus();
    },signal);navigation.append(button);
  }

  activate(parts[0]);return root;
}

export function renderObjectiveReview(items,locale='en'){
  const uz=locale==='uz';
  return el('section',{class:'mock-review','data-mock-objective-review':''},el('style',{},CSS),
    el('h3',{class:'font-display text-lg'},uz?'Javoblar va izohlar':'Answers and explanations'),
    ...items.map(item=>el('details',{'data-mock-review-question':item.questionId},
      el('summary',{},`${item.number}. ${typeof item.isCorrect==='boolean'?(item.isCorrect?(uz?'To‘g‘ri':'Correct'):(uz?'Noto‘g‘ri':'Incorrect'))+' · ':''}${item.correctAnswer}`),
      el('p',{class:'mt-3 whitespace-pre-wrap'},item.questionText),
      el('p',{},`${uz?'Sizning javobingiz':'Your answer'}: ${item.studentAnswer||'—'}`),
      el('p',{},`${uz?'To‘g‘ri javob':'Correct answer'}: ${item.correctAnswer}`),
      item.explanation?el('p',{class:'mt-2 whitespace-pre-wrap'},item.explanation):null,
      item.evidenceQuote?el('blockquote',{},item.evidenceQuote):null,
      item.evidence?.passageNo?el('p',{class:'text-xs text-ink-500'},`Passage ${item.evidence.passageNo} · ${uz?'Paragraf':'Paragraph'} ${item.evidence.paragraph||''}`):null)));
}

