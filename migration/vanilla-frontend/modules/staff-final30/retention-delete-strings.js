/** Bilingual keys from current main; Arena's older extracted dictionaries do not yet include them. */
const COPY={
 en:{
  confirmPermanentDelete:"Permanently delete {label} and all its authored versions? Learners' completed answers, scores and results remain, but the source cannot be restored.",
  confirmDeleteLabel:'Type {label} to confirm permanent deletion:',
  deleteFailed:'Could not permanently delete the text. Learner history was not intentionally changed.',
  deleteBlocked:'A learner is still using this text. Finish the active session before permanent deletion.'
 },
 uz:{
  confirmPermanentDelete:"{label} va uning barcha matn versiyalari butunlay o'chirilsinmi? O'quvchilarning tugallangan javoblari, ballari va natijalari saqlanadi, lekin matnni tiklab bo'lmaydi.",
  confirmDeleteLabel:"Butunlay o'chirishni tasdiqlash uchun {label} ni kiriting:",
  deleteFailed:"Matnni butunlay o'chirib bo'lmadi. O'quvchi natijalarini o'chirishga urinilmadi.",
  deleteBlocked:"O'quvchi shu matn bilan ishlayapti. Uning mashg'uloti tugamaguncha matnni butunlay o'chirib bo'lmaydi."
 }
};
export const retentionDeleteText=(dict,locale)=>({...(COPY[locale==='uz'?'uz':'en']),...Object.fromEntries(Object.entries(dict.retentionMemory?.admin??{}).filter(([key,value])=>key in COPY.en&&typeof value==='string'))});
