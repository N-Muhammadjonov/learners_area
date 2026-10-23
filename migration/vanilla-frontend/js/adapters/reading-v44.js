import {ApiError} from '../api-client.js';
import {lessonDTO} from './listening-lessons-v10.js';
/** Reading read-projections. These are PROPOSED view adapters (same contract family as viewData): no backend
 * route is created here. Writes use the existing POST/PATCH endpoints. A disconnected server returns 503, and
 * nothing is synthesised. Validation mirrors the listening lesson DTO; the area label is the only difference. */
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),bad=code=>{throw new ApiError(502,code);};
/** Reading lesson detail. The listening validator checks shape, blocks, quiz answers and media URLs; it is run on
 * an area-normalised copy so the original listening code is untouched. */
export function readingLessonDTO(d,id){
 if(!obj(d)||!obj(d.lesson)||d.lesson.learningArea!=='reading')bad('invalid_reading_lesson');
 if(!obj(d.progress)||typeof d.progress.state!=='string'||(d.progress.completedAt!==null&&d.progress.completedAt!==undefined&&typeof d.progress.completedAt!=='string'))bad('invalid_reading_lesson');
 lessonDTO({...d,lesson:{...d.lesson,learningArea:'listening'}},id);
 return d;
}
