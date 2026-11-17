/** Keep all questions from a Part 1 topic together, followed by linked Parts 2–3. */
export function speakingTopicGroups(parts = []) {
  const groups=[];
  for(const question of parts){
    const part=String(question.part||'P1');
    const topic=String(question.topic||'Part 1');
    const key=part==='P1'?`P1:${topic.trim().toLowerCase()}`:part;
    let group=groups.find(item=>item.key===key);
    if(!group){group={key,part,topic,questions:[]};groups.push(group);}
    group.questions.push(question);
  }
  return groups.sort((a,b)=>a.part.localeCompare(b.part));
}
