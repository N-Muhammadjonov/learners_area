/** Combine route/request lifetimes across windows without weakening cancellation.
 * Native AbortSignal.any rejects signals from other realms (including iframes).
 */
export function anySignal(signals){
 const Controller=globalThis.window?.AbortController??globalThis.AbortController;
 const controller=new Controller(),subscriptions=[];
 const cleanup=()=>{for(const [signal,abort] of subscriptions)signal.removeEventListener('abort',abort);subscriptions.length=0;};
 for(const signal of signals){
  if(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function')throw new TypeError('Expected AbortSignal');
  if(signal.aborted){controller.abort(signal.reason);cleanup();break;}
  const abort=()=>{controller.abort(signal.reason);cleanup();};
  signal.addEventListener('abort',abort,{once:true});subscriptions.push([signal,abort]);
 }
 return controller.signal;
}
