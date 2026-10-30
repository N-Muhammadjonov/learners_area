/** Preference refresh waits for an existing account acknowledgement. Never retry
 * a mutation, persist its body, or cancel an account operation just to localize. */
export function accountMutation(state){let resolve;const promise=new Promise(r=>resolve=r),set=state?(state.accountMutations??=new Set()):new Set();set.add(promise);return ()=>{set.delete(promise);resolve();};}
export async function awaitAccountMutations(state,signal){
 const work=[...(state?.accountMutations??[])];if(!work.length||signal.aborted)return;
 await new Promise(resolve=>{const finish=()=>{signal.removeEventListener('abort',finish);resolve();};signal.addEventListener('abort',finish,{once:true});Promise.allSettled(work).then(finish);});
}
