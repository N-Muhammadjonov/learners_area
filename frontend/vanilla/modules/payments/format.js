/** Explicit numeric formats: Chromium's root ICU fallback prints Uzbek months as M11. */
export function paymentMoney(value,locale){
 if(!Number.isSafeInteger(value))throw new RangeError('invalid_money_projection');
 const formatted=new Intl.NumberFormat('en-GB',{maximumFractionDigits:0}).format(value);
 return (locale==='uz'?formatted.replaceAll(',',' '):formatted)+' UZS';
}
export function paymentDate(value,locale,empty){
 if(!value)return empty;
 const instant=new Date(value.includes('T')?value:value+'T00:00:00+05:00');
 if(!Number.isFinite(instant.getTime()))return empty;
 const hasTime=value.includes('T');
 if(locale!=='uz')return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tashkent',dateStyle:'medium',...(hasTime?{timeStyle:'short'}:{})}).format(instant);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tashkent',day:'2-digit',month:'2-digit',year:'numeric',...(hasTime?{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:{})}).formatToParts(instant).map(p=>[p.type,p.value]));
 return `${parts.day}.${parts.month}.${parts.year}`+(hasTime?`, ${parts.hour}:${parts.minute}`:'');
}
export function validatePaymentSummary(value){
 if(!value?.position||!Array.isArray(value.history)||!Array.isArray(value.providers)||!value.pagination)throw new TypeError('invalid_money_projection');
 for(const [key,amount] of Object.entries(value.position))if(key.endsWith('Minor')&&!Number.isSafeInteger(amount))throw new RangeError('invalid_money_projection');
 for(const row of value.history)for(const key of ['amountMinor','allocatedMinor','advanceMinor','refundedMinor'])if(!Number.isSafeInteger(row[key]))throw new RangeError('invalid_money_projection');
 return value;
}
