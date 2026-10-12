/** Synthetic, isolated parser/UI fixture. Never imported into a content database. */
export const mapSvg = '<svg class="la-map" viewBox="0 0 100 100" aria-label="Authored park plan" onload="globalThis.sourceExecuted=true"><script>globalThis.sourceExecuted=true</script><rect x="1" y="2" width="90" height="80" stroke="#333"/><text x="10" y="20">Park entrance</text></svg>';
export function structuredSource(label = "Map / Plan", visual = mapSvg) {
  const source = {
    test_id: "structured-qa-only", title: "Structured QA only", sections: ["One", "Two", "Three", "Four"],
    transcript: Object.fromEntries([1,2,3,4].map(n => [n, `Authored transcript for part ${n}.`])),
    questions: Object.fromEntries(Array.from({length:40}, (_, i) => {
      const q = i+1;
      return [q, {q, part: q >= 11 && q <= 14 ? 3 : Math.ceil(q/10), prompt: `Authored question ${q}`, answer: "A", timeStart:q*10, timeEnd:q*10+5, why:"Authored evidence", options:[{code:"A",text:"Entrance"},{code:"B",text:"Library"}]}];
    })),
    alternatives: {}, question_types: {"1-10":"Note Completion", "11-14":label, "15-25":"MCQ", "26-30":"Matching", "31-40":"Sentence Completion"},
    part_audio_boundaries: {"1":{start:0,end:100},"2":{start:100,end:200},"3":{start:200,end:300},"4":{start:300,end:500}},
    script_completion: [], vocabulary: [], activities:["Map / Plan", "Unknown invented activity"],
  };
  const parts = {"1":"", "2":"", "3":visual, "4":""};
  return `<script>globalThis.sourceExecuted=true; const DATA = ${JSON.stringify(source)}; const PARTS = ${JSON.stringify(parts)};</script>`;
}
