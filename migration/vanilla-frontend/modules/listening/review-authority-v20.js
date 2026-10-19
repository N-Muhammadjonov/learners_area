/** Event-driven authority barrier, not a persistence/media engine. No polling.
 * Hints synchronously conceal the view; only fresh authorized reads can resume it.
 * Two consecutive reads maximum per burst. Further churn fails closed explicitly.
 */
export class ReviewAuthorityBarrier {
 constructor({eligible,suspend,read,accept,reject,signal}){Object.assign(this,{eligible,suspend,read,accept,reject,signal});this.blocked=false;this.closed=false;this.failed=false;this.revision=0;this.stop=()=>this.dispose();signal?.addEventListener('abort',this.stop,{once:true});if(signal?.aborted)this.dispose();}
 invalidate(){if(this.closed||this.failed||this.accepting||!this.eligible())return;this.revision++;if(this.blocked)return;this.blocked=true;this.promise=new Promise(resolve=>this.resolve=resolve);this.suspend();void this.run();}
 async run(){try{for(let round=0;round<2;round++){const revision=this.revision;await this.read();if(this.closed)return;if(revision!==this.revision)continue;this.blocked=false;this.accepting=true;try{this.accept();}finally{this.accepting=false;}this.resolve?.(true);return;}throw Object.assign(Error('Authority changed repeatedly; explicit retry required'),{status:503});}catch(error){if(this.closed)return;this.failed=true;this.blocked=true;this.reject(error);this.resolve?.(false);}}
 wait(){return this.closed||this.failed?Promise.resolve(false):this.blocked?this.promise:Promise.resolve(true);}
 dispose(){if(this.closed)return;this.closed=true;this.blocked=true;this.resolve?.(false);this.signal?.removeEventListener('abort',this.stop);}
}
