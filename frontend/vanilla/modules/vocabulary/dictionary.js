import {dictionaryPanel} from '../staff-final30/dictionary-panel.js';
/** Learner and owner share the reviewed native dictionary layout. */
export function mountDictionary(ctx,host){host.append(dictionaryPanel(ctx,{owner:false}));}
