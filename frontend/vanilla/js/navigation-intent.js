/** Delegate genuine intent so native anchors and tab buttons can prewarm code. */
export function navigationIntent({root,signal}){
 const selector='a[href],[data-navigation-route]';
 function hint(event,action,delay=90){if(signal.aborted||event.defaultPrevented)return;const target=event.target.closest?.(selector);if(!target||!root.contains(target)||target.hasAttribute('download')||target.target&&target.target!=='_self')return;if(['pointerover','pointerout','focusin','focusout'].includes(event.type)&&target.contains(event.relatedTarget))return;target.dispatchEvent(new CustomEvent('learners-area:prefetch-intent',{bubbles:true,detail:{action,delay}}));}
 const handlers={pointerover:event=>hint(event,'prepare'),pointerout:event=>hint(event,'cancel'),focusin:event=>hint(event,'prepare'),focusout:event=>hint(event,'cancel'),pointerdown:event=>{if(event.button===0)hint(event,'prepare',0);}};
 for(const [type,fn]of Object.entries(handlers))root.addEventListener(type,fn);signal.addEventListener('abort',()=>{for(const [type,fn]of Object.entries(handlers))root.removeEventListener(type,fn);},{once:true});
}
