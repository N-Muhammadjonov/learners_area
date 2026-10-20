type ReadingOccurrence = {startChar: number; endChar: number; surfaceForm: string; sentenceText: string | null};
const allStarts = (text: string, part: string) => {
  const found: number[] = [];
  if (!part) return found;
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) found.push(at);
  return found;
};
const wordChar = /[\p{L}\p{N}'’ʼʻ-]/u;
const wholeSurface = (text:string,start:number,end:number) => (!start || !wordChar.test(text[start-1]!)) && (end===text.length || !wordChar.test(text[end]!));

/** Recover a legacy paragraph-relative span only from its unchanged authored
 * sentence. Repeated/absent contexts never authorize choosing a meaning. */
export function recoverReadingOffset(body: string, occurrence: ReadingOccurrence) {
  const {startChar, endChar, surfaceForm} = occurrence;
  const sentence = occurrence.sentenceText?.trim();
  if (startChar >= 0 && endChar > startChar && body.slice(startChar, endChar).toLowerCase() === surfaceForm.toLowerCase()) return {startChar, endChar, proof: "already_absolute" as const};
  if (!sentence || !surfaceForm) return null;
  const sentenceStarts = allStarts(body, sentence);
  const surfaces = allStarts(sentence.toLowerCase(), surfaceForm.toLowerCase()).filter(at=>wholeSurface(sentence,at,at+surfaceForm.length));
  if (sentenceStarts.length === 1 && surfaces.length === 1) {
    const start = sentenceStarts[0]! + surfaces[0]!;
    return {startChar: start, endChar: start + surfaceForm.length, proof: "unique_authored_sentence" as const};
  }
  const candidates: {startChar: number; endChar: number; proof: "authored_paragraph_offset"}[] = [];
  let base = 0;
  for (const paragraph of body.split("\n\n")) {
    const contexts = allStarts(paragraph, sentence);
    if (paragraph.slice(startChar, endChar).toLowerCase() === surfaceForm.toLowerCase()
      && wholeSurface(paragraph,startChar,endChar)
      && contexts.some(at => startChar >= at && endChar <= at + sentence.length)) {
      candidates.push({startChar: base + startChar, endChar: base + endChar, proof: "authored_paragraph_offset"});
    }
    base += paragraph.length + 2;
  }
  return candidates.length === 1 ? candidates[0]! : null;
}
