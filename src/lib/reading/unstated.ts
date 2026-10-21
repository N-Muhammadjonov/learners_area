/** Not Given is absence of a stated fact, not an exact supporting sentence. */
export const isUnstatedAnswer=(answer:string)=>/^(?:not[ _]given|[A-Z]\s*[\u2014-]\s*Not mentioned in the passage\.)$/i.test(answer.trim());
