/** Current-main authoring workspace compatibility: labels are UI only, transport stays canonical. */
export const OWNER_TYPES=Object.freeze({reading_passage:'reading',general_reading_set:'reading-set',listening_test:'listening',video_lesson:'video',writing_prompt:'writing',writing_lesson:'writing-lesson',writing_model_text:'writing-model-text',writing_pattern:'writing-pattern',writing_translation_set:'writing-translation',speaking_prompt:'speaking-prompt',speaking_material:'speaking'});
export const deletionType=type=>Object.hasOwn(OWNER_TYPES,type)?OWNER_TYPES[type]:null;
export const trackLabel=(module,value,academicLabel)=>module==='listening'&&value==='academic'?academicLabel:value;
export const trackValue=(module,input,academicLabel)=>module==='listening'&&typeof input==='string'&&input.toLocaleLowerCase()===academicLabel.toLocaleLowerCase()?'academic':input;
