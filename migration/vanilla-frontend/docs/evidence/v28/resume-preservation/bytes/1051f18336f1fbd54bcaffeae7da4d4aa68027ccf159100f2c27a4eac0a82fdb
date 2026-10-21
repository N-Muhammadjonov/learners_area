import {h} from '../../js/native.js';
export const Label=props=>h('label',{...props,className:`mb-1.5 block text-sm font-medium text-ink-700 ${props.className??''}`});
export const Input=({className='',...props})=>h('input',{className:`input ${className}`,...props});
export const FieldError=({children})=>{const text=(children??[]).flat().join('');return text?h('p',{className:'mt-1 text-xs text-band-bad',role:'alert'},text):null;};
