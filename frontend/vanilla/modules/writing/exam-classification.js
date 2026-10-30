/** Writing Exam Mode facets for the verified 29 Oct question bank.
 * Read-only labels: never changes questions, publication, exam API or grading.
 * An unverified visual characteristic is deliberately left untagged.
 */
const set = value => new Set(value.trim().split(/\s+/).filter(Boolean));
const has = (codes, code) => codes.has(code);

export const examFilterGroups = {
 task1: [
  {id:'time',label:{en:'Time-based',uz:'Vaqt bo‘yicha'},options:[
   ['static','Static','O‘zgarmas'],['dynamic','Dynamic','O‘zgaruvchi'],['forecast','Forecast','Prognoz'],['mixed-timeline','Mixed timeline','Aralash davr']]},
  {id:'focus',label:{en:'Analysis focus',uz:'Tahlil yo‘nalishi'},options:[
   ['trend','Trend','Tendensiya'],['comparison','Comparison','Taqqoslash'],['composition','Composition','Tarkib'],['ranking','Ranking','Reyting'],['distribution','Distribution','Taqsimot']]},
  {id:'structure',label:{en:'Chart structure',uz:'Grafik tuzilishi'},options:[
   ['single-chart','Single chart','Bitta grafik'],['multiple-charts','Multiple charts','Bir nechta grafik'],['dual-axis','Dual-axis','Ikki o‘qli'],['combined-visuals','Combined visuals','Aralash vizuallar']]}
 ],
 task2: [
  {id:'essay',label:{en:'Essay type',uz:'Esse turi'},options:[
   ['opinion','Opinion essay','Fikr bildirish'],['discussion','Discussion essay','Muhokama'],['advantages','Advantages / Disadvantages','Afzallik / kamchilik'],['problems','Problem / Solution','Muammo / yechim'],['causes','Causes / Effects','Sabab / oqibat'],['positive-negative','Positive / Negative','Ijobiy / salbiy'],['two-part','Two-part questions','Ikki qismli savol']]},
  {id:'topic',label:{en:'Essay topic',uz:'Esse mavzusi'},options:[
   ['education','Education','Ta’lim'],['technology','Technology','Texnologiya'],['environment','Environment','Atrof-muhit'],['health','Health','Salomatlik'],['work','Work & Employment','Ish va bandlik'],['government','Government & Law','Hukumat va qonun'],['society','Society & Culture','Jamiyat va madaniyat'],['media','Media & Advertising','Media va reklama'],['crime','Crime & Punishment','Jinoyat va jazo'],['transport','Transport & Cities','Transport va shaharlar'],['science','Science','Fan'],['globalisation','Globalisation','Globallashuv']]},
  {id:'requirements',label:{en:'Task requirements',uz:'Savol talablari'},options:[
   ['opinion','Opinion required','Fikr bildirish'],['both-views','Discuss both views','Ikki qarashni muhokama qilish'],['pros-cons','Compare pros & cons','Afzallik-kamchilikni solishtirish'],['causes','Explain causes','Sabablarni tushuntirish'],['effects','Analyse effects','Oqibatlarni tahlil qilish'],['solutions','Suggest solutions','Yechim taklif qilish'],['both-questions','Answer both questions','Ikkala savolga javob']]}
 ]
};

const t1Static = set('ZIP-09-T1 ZIP-13-T1 ZIP-16-T1 ZIP-17-T1 ZIP-08-T1 W24-T44 A09 A13 A14 A21 A24 A29 A30 A31 A33 A35 A37 A38 A39 D06 D08 D12 W24-T42');
const t1Dynamic = set('ZIP-01-T1 ZIP-07-T1 ZIP-15-T1 ZIP-18-T1 ZIP-20-T1 ZIP-21-T1 ZIP-03-T1 W24-T43 A06 A08 A10 A11 A15 A16 A18 A19 A22 A23 A25 A28 A32 A34 A36 A40 D01 D02 D04 D05 D07 D10 D13 D14 W24-T47');
const t1Forecast = set('D11');
const t1Mixed = set('ZIP-10-T1 ZIP-19-T1 D09 A20');
const t1Multiple = set('ZIP-05-T1 ZIP-06-T1 ZIP-10-T1 ZIP-17-T1 A09 A11 A14 A24 A32 A33 A40 D02 D08');
const t1Composition = set('ZIP-07-T1 ZIP-17-T1 A09 A11 A15 A37 A40 D08 D10');
const t1Ranking = set('ZIP-13-T1 ZIP-16-T1 A13 A21 A23 A28 A31 A35 D12');
const t1Distribution = set('ZIP-01-T1 ZIP-08-T1 W24-T44 A08 A09 A11 A14 A21 A22 A29 A30 A38 A39 A40 D08 D14 W24-T42 W24-T47');
const t1NoTime = set('ZIP-05-T1 ZIP-06-T1');
const t2TopicCodes = {
 education:'A06 A13 A15 A16 A20 A23 A27 A40 D02 D08 D12 W24-T48',
 technology:'ZIP-06-T2 A10 A12 A36 A39 D07',
 environment:'ZIP-04-T2 A25 A26 A29 A33 D01 D10 W24-T42',
 health:'ZIP-11-T2 ZIP-20-T2 ZIP-02-T2 D05 W24-T43 W24-T46',
 work:'ZIP-09-T2 ZIP-12-T2 ZIP-16-T2 A11 A18 A24 D06 D09 W24-T45',
 government:'ZIP-05-T2 ZIP-14-T2 ZIP-18-T2 A17',
 society:'ZIP-10-T2 ZIP-13-T2 ZIP-15-T2 ZIP-19-T2 ZIP-21-T2 ZIP-03-T2 A07 A19 A22 A32 A34 D11 D14 W24-T47',
 media:'ZIP-01-T2 A05 A28',
 crime:'ZIP-07-T2 A37 D15',
 transport:'A08 A14 A30 A31 D04 W24-T42',
 science:'ZIP-17-T2 A38 D03 W24-T44',
 globalisation:'A09 A21 A35 W24-T41'
};
const t2Topics = Object.entries(t2TopicCodes).map(([topic,codes])=>[topic,set(codes)]);

const essayType = {
 opinion:'opinion',discussion:'discussion',outweigh:'advantages',
 'advantages-disadvantages':'advantages','problem-solution':'problems',
 'cause-solution':'problems','effect-solution':'problems',
 'cause-effect':'causes','positive-negative':'positive-negative',
 'two-part':'two-part','multi-part-opinion':'two-part'
};

function task2Requirements(p) {
 const category = p.category;
 if(category==='opinion'||category==='positive-negative')return ['opinion'];
 if(category==='discussion')return ['both-views','opinion'];
 if(category==='outweigh')return ['pros-cons','opinion'];
 if(category==='advantages-disadvantages')return ['pros-cons'];
 if(category==='problem-solution')return ['effects','solutions'];
 if(category==='cause-solution')return ['causes','solutions'];
 if(category==='effect-solution')return ['effects','solutions'];
 if(category==='cause-effect')return ['causes','effects'];
 if(category==='multi-part-opinion'){
  const extra = p.code==='A21'?['causes','pros-cons']:p.code==='ZIP-03-T2'?['effects']:p.code==='A10'?['causes']:[];
  return ['both-questions','opinion',...extra];
 }
 return category==='two-part'?['both-questions']:[];
}

/** Returns independently selectable facet tags; absence means unverified/not applicable. */
export function classifyExamQuestion(p) {
 const code = p.code ?? '';
 if(p.taskType==='task2')return {
  essay:essayType[p.category]?[essayType[p.category]]:[],
  topic:t2Topics.filter(([,codes])=>has(codes,code)).map(([topic])=>topic),
  requirements:task2Requirements(p)
 };
 if(p.taskType!=='task1')return {};
 if(p.category==='process'||p.category==='development')return {time:[],focus:[],structure:[]};
 const chart=p.category!=='maps-plans';
 const time = has(t1Static,code)?['static']:
  has(t1Dynamic,code)?['dynamic']:
  has(t1Forecast,code)?['forecast']:
  has(t1Mixed,code)?['mixed-timeline']:[];
 const focus=[];
 if(chart&&(has(t1Dynamic,code)||has(t1Mixed,code)||has(t1Forecast,code)))focus.push('trend');
 // Spatial changes belong to comparison, not chart composition or trend analysis.
 focus.push('comparison');
 if(chart&&has(t1Composition,code))focus.push('composition');
 if(chart&&has(t1Ranking,code))focus.push('ranking');
 if(chart&&has(t1Distribution,code))focus.push('distribution');
 const structure = !chart?[]:
  p.category==='mixed-charts'?['multiple-charts','combined-visuals']:
  has(t1Multiple,code)?['multiple-charts']:['single-chart'];
 return {time,focus,structure};
}

/** Only show filters that have meaning for the currently selected question type. */
export function applicableExamFilters(mode,category) {
 if(mode==='task2'||category==='all')return examFilterGroups[mode]??[];
 if(category==='process'||category==='development')return [];
 return examFilterGroups.task1.filter(group=>category!=='maps-plans'||group.id!=='structure');
}
