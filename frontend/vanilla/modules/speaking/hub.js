import {render} from '../../js/generated/views/speaking.js';
/** Source: src/app/app/(shell)/speaking/page.tsx.
 * The original's DOM was already converted; do not fork it or the existing microphone test. */
export function mount(context) {
  const {root,dict,session,signal}=context;
  if (signal.aborted) return;
  const page=render({context,dict,user:session.user,locale:context.locale});
  root.append(page);
}
