import {listeningAudio} from './audio-preload.js';
/** The authenticated session owns transfers, including across catalogue navigation. */
export function warmUnlockedAudio(cards,{signal}={}){
 if(!signal?.aborted)listeningAudio.warm(cards);
 return Promise.resolve();
}
