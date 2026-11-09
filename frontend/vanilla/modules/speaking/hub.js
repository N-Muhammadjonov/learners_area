import {render} from '../../js/generated/views/speaking.js';
import {speakingMascot} from '../shared/mascot.js';
/** Source: src/app/app/(shell)/speaking/page.tsx.
 * The original's DOM was already converted; do not fork it or the existing microphone test. */
export function mount(context) {
  const {root,dict,session,signal}=context;
  if (signal.aborted) return;
  const page=render({context,dict,user:session.user,locale:context.locale});
  const intro=page.firstElementChild;intro.classList.add('la-speaking-intro');
  const copy=document.createElement('div');copy.append(...intro.childNodes);intro.append(copy,speakingMascot());
  root.append(page);
}
