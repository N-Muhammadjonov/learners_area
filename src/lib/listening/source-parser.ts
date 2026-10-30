import { canonicalListeningTypeId, listeningKindOfType } from "./question-identity";
import { extractMapDiagram } from "./map-diagram";
import { listeningPackageSchema, type ListeningPackage } from "./package";
import { discoverTranscripts, ListeningImportProblem, textFile } from "./discover";

/** Only JSON literals are read. No eval, Function, imported scripts, event handlers or HTML rendering. */
export function jsonLiteral(html: string, marker: string): unknown {
  // Formatting and comma-separated declarations may vary; only JSON values
  // are accepted after the exact identifier. No JavaScript is evaluated.
  const name = marker.replace(/^(?:const|let|var)\s+|^window\./, "").replace(/\s*=\s*$/, "").trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error("Invalid source marker");
  const match = new RegExp(`(?:\\b(?:const|let|var)\\s+|[,;]\\s*|\\bwindow\\.)${name}\\s*=`).exec(html);
  if (!match) throw new Error(`Missing source data: ${marker}`);
  const start = match.index + match[0].length;
  let pos = start;
  while (/\s/.test(html[pos] ?? "")) pos++;
  const opening = html[pos];
  if (opening !== "[" && opening !== "{")
    throw new Error("Source is not a JSON literal");
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = pos; i < html.length; i++) {
    const c = html[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (!depth) return JSON.parse(html.slice(pos, i + 1));
    }
  }
  throw new Error("Incomplete source JSON");
}
export type HtmlDocumentReader = (html: string) => Document;
export type LegacyOptions = {
  /** Audio chosen by discovery (or by staff) when metadata does not name one. */
  audioPath?: string;
  /** Used only when metadata.json is absent: derived from the ZIP filename. */
  fallbackTestId?: string;
};
/** The exam page: the canonical name, otherwise the one HTML file that holds the Q1 answer control. */
function examHtml(files: Record<string, string>): string | undefined {
  const named = textFile(files, "01_full_exam.html");
  if (named) return named;
  const candidates = Object.entries(files)
    .filter(([p, v]) => /\.html?$/i.test(p) && /(id|name)\s*=\s*["']l1["']/.test(v))
    .sort(([a], [b]) => a.localeCompare(b));
  return candidates.length === 1 ? candidates[0]![1] : undefined;
}
export function slugTestId(value: string): string {
  return value
    .replace(/\.(?:zip|html?)$/i, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "listening-import";
}
export function convertLegacyPackage(
  files: Record<string, string>,
  durationSec: number,
  read: HtmlDocumentReader,
  options: LegacyOptions = {},
): ListeningPackage {
  const structuredSource = Object.values(files).find(source => /\b(?:const|let|var)\s+DATA\s*=\s*\{/.test(source) && /part_audio_boundaries/.test(source));
  if (structuredSource) return convertStructuredPractice(structuredSource, durationSec, options, read);
  const modernSource = Object.values(files).find(source => /\bconst\s+D\s*=\s*\{/.test(source));
  if (modernSource) return convertResearchPractice(modernSource, durationSec, options, read);
  const html = examHtml(files);
  if (!html) throw new ListeningImportProblem("no_question_source");
  // metadata.json is helpful but no longer mandatory. When it is absent the
  // values are DERIVED (ZIP name, chosen audio, structural section numbers),
  // never invented, and the provenance says so.
  let parsedMeta: { test_id?: string; sections?: string[]; audio_file?: string; map_file?: string; source_identity?: string; internal_provenance?: string } | null = null;
  try { parsedMeta = JSON.parse(textFile(files, "metadata.json") ?? textFile(files, "manifest.json") ?? "null"); } catch { parsedMeta = null; }
  const inferred = !parsedMeta?.test_id || !/^[a-z0-9-]{1,80}$/.test(parsedMeta.test_id) || !Array.isArray(parsedMeta.sections) || parsedMeta.sections.length === 0;
  const meta = {
    test_id: parsedMeta?.test_id && /^[a-z0-9-]{1,80}$/.test(parsedMeta.test_id) ? parsedMeta.test_id : slugTestId(parsedMeta?.test_id ?? options.fallbackTestId ?? "listening-import"),
    sections: !inferred ? parsedMeta!.sections! : [1, 2, 3, 4].map((n) => `Section ${n}`),
    audio_file: options.audioPath ?? parsedMeta?.audio_file,
    map_file: parsedMeta?.map_file,
    source_identity: parsedMeta?.source_identity,
    // When metadata is missing or incomplete the provenance always says so,
    // even if the file carried its own provenance text.
    internal_provenance: [parsedMeta?.internal_provenance, inferred ? "metadata inferred from package contents" : undefined].filter(Boolean).join("; ") || undefined,
  };
  if (!meta.audio_file) throw new ListeningImportProblem("no_audio");
  const plain = (s: string) =>
    read(s).body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const doc = read(
    html.replace(/\s(?:src|href|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
  );
  const optionalJson = <T,>(source: string, marker: string, fallback: T): T => {
    const name = marker.replace(/^(?:const|let|var)\s+|^window\./, "").replace(/\s*=\s*$/, "").trim();
    return new RegExp(`\\b${name}\\s*=`).test(source) ? jsonLiteral(source, marker) as T : fallback;
  };
  const keys = jsonLiteral(html, "const KEY =") as Record<string, string>;
  const alt = optionalJson(html, "const ALT =", {}) as Record<string, string[]>;
  const modern = !/\bPAIR_OF\s*=/.test(html) && /\bPAIRS\s*=/.test(html);
  const pairAnswers = modern ? jsonLiteral(html, "const PAIRS =") as Record<string, string[]> : null;
  const pairs = modern ? Object.fromEntries(Object.keys(pairAnswers!).map(n => [n, [Number(n) % 2 ? Number(n) + 1 : Number(n) - 1]]))
    : optionalJson(html, "const PAIR_OF =", {}) as Record<string, number[]>;
  const reviewRows = modern ? optionalJson(textFile(files, "02_review_revision.html") ?? "", "const DATA =", []) as {q: number; at: number; why: string}[] : null;
  const evidence = reviewRows ? Object.fromEntries(reviewRows.map(row => [row.q, row]))
    : optionalJson(html, "window.RS_WHY =", {}) as Record<string, { at: number; why: string }>;
  const numbers = [...new Set(Array.from(doc.querySelectorAll("input,select,textarea")).map(input => Number(/^[l](\d+)$/.exec(input.id || input.getAttribute("name") || "")?.[1])).filter(n => n >= 1 && n <= 40))].sort((a, b) => a - b);
  const sectionElements = Array.from(doc.querySelectorAll(".lp,.exam-part"));
  const questions = numbers.map((n) => {
    const input =
      doc.getElementById(`l${n}`) ?? doc.querySelector(`[name="l${n}"]`);
    if (!input) throw new Error(`Q${n}: source control missing`);
    const section = input.closest(".lp,.exam-part");
    const host =
      input.closest(".question,.exam-question") ?? input.closest(".notes-row,.exam-notes-row,tr,li,p");
    if (!host || !section) throw new Error(`Q${n}: source context missing`);
    // A paragraph can hold two questions: split at BR, rather than merge unrelated prompts.
    const cloned = host.cloneNode(true) as Element;
    cloned
      .querySelectorAll("input,select")
      .forEach((x) =>
        x.replaceWith(doc.createTextNode(` [Q${x.id.replace("l", "") || n}] `)),
      );
    const segments = cloned.innerHTML.split(/<br\s*\/?\s*>/i);
    const segment =
      segments.find((s) => s.includes(`[Q${n}]`)) ?? cloned.innerHTML;
    let text =
      host.querySelector(".qtext,.exam-qtext")?.textContent?.trim() ?? plain(segment);
    if ((meta.map_file || doc.querySelector("svg.la-map")) && input.tagName === "SELECT" && n >= 18 && n <= 20)
      text = `Label ${n} on the supplied map (A–G)`;
    const options = host.querySelectorAll(".q-opt,.q-choice,.exam-qopt,.exam-qchoice");
    const optionTexts = Array.from(options).map((o) =>
      plain(o.textContent ?? ""),
    );
    const selectOptions =
      input.tagName === "SELECT"
        ? Array.from(input.querySelectorAll("option"))
            .filter((o) => o.getAttribute("value"))
            .map((o) => {
              const letter = o.getAttribute("value");
              const legend = Array.from(
                input.closest(".notes-block,.exam-notes")?.querySelectorAll(":scope > div > div") ??
                  [],
              )
                .map((node) => plain(node.textContent ?? ""))
                .find((value) => value.startsWith(`${letter} `));
              return legend ?? o.textContent ?? "";
            })
        : [];
    const instruction =
      Array.from(section.querySelectorAll(".q-instructions,.exam-instructions"))
        .filter((node) => Boolean(node.compareDocumentPosition(input) & 4))
        .at(-1)
        ?.textContent?.replace(/\s+/g, " ")
        .trim() ?? "";
    const e = evidence[n] ?? { at: 0, why: "" };
    return {
      number: n,
      section: sectionElements.indexOf(section) + 1,
      text,
      instruction,
      options: optionTexts.length ? optionTexts : selectOptions,
      key: keys[n],
      alternatives: pairAnswers?.[n] ?? alt[n] ?? [],
      pair: pairs[n] ?? [],
      evidence: { at: e.at, why: plain(e.why) },
    };
  });
  const keyword1 = (
    optionalJson(
      textFile(files, "03_keyword_match_1.html") ?? "",
      "const KEYS =", [],
    ) as ListeningPackage["keyword1"]
  ).map((x) => ({ ...x, text: plain(x.text) }));
  const keyword2Raw = optionalJson(textFile(files, "04_keyword_match_2.html") ?? "", "const ITEMS=", []) as Record<string, unknown>[];
  const keyword2 = modern ? keyword2Raw.map(row => ({ q: row.q, at: row.at, end: row.end,
    heard: plain(String(row.evidence ?? "")), link: plain(String(row.text ?? "")), answer: row.answer })) : keyword2Raw;
  const vocabularyHtml = textFile(files, "05_vocabulary_session.html") ?? "";
  const vocabulary = modern ? (optionalJson(vocabularyHtml, "const V =", []) as Record<string, unknown>[]).map(row => ({
    word: row.word, pos: row.pos, uz: row.uz, def: row.definition, ex: row.example,
    also: String(row.para ?? "").split(";").map(x => x.trim()).filter(Boolean),
    // This source did not author a quiz. Do not fabricate one.
  })) : optionalJson(vocabularyHtml, "const ITEMS =", []);
  // Real transcript text only: canonical data/transcript.json first, then any
  // transcript-looking txt/md/html/xml/json/vtt/srt file that can be tied to a
  // section. Scripts are stripped before text extraction and never executed.
  const canonical = textFile(files, "data/transcript.json");
  const transcripts: { number: number; text: string; reviewRequired?: boolean }[] = canonical
    ? (JSON.parse(canonical) as { number: number; text: string; reviewRequired?: boolean }[])
    : Object.entries(
        discoverTranscripts(files, (h) => plain(h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "$&\n"))).bySection,
      ).map(([n, text]) => ({ number: Number(n), text }));
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    testId: meta.test_id,
    title: meta.test_id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase()),
    category: "full",
    provenance: `${meta.source_identity ?? "User supplied source"}; ${meta.internal_provenance ?? "User supplied HTML package"}`,
    audio: { path: meta.audio_file, durationSec },
    imagePath: meta.map_file ?? null,
    ...(doc.querySelector("svg.la-map") ? {mapDiagram: extractMapDiagram(doc.querySelector("svg.la-map")!)} : {}),
    sections: Array.from({ length: Math.max(sectionElements.length, parsedMeta?.sections?.length ?? 0) }, (_, i) => ({
      number: i + 1,
      title: parsedMeta?.sections?.[i] ?? sectionElements[i]?.querySelector("h1,h2,h3")?.textContent?.trim() ?? `Section ${i + 1}`,
      transcript: transcripts.find((s) => s.number === i + 1)?.text ?? "",
      reviewRequired:
        transcripts.find((s) => s.number === i + 1)?.reviewRequired ?? false,
    })),
    questions,
    keyword1,
    keyword2,
    vocabulary,
  });
}

/** Owner-authored monolithic research-practice HTML: JSON data only. */
function convertResearchPractice(html: string, durationSec: number, options: LegacyOptions, read: HtmlDocumentReader): ListeningPackage {
  const source = jsonLiteral(html, "const D =") as { questions?: unknown; sections?: unknown; vocab?: { word: string; type: string; uz: string; def: string; source: string; also: string[] }[]; scriptCompletion?: { q: number; at: number; end: number; before: string; answer: string; after: string }[]; partRanges?: Record<string, [number, number]>; focus?: { part: number; title: string; points: string[] }[] };
  return listeningPackageSchema.parse({
    schemaVersion: 1, testId: slugTestId(options.fallbackTestId ?? "listening-research-practice"), title: read(html).querySelector("h1")?.textContent?.trim() || options.fallbackTestId || "Listening", category: "full", collection: "academic", provenance: "Owner-provided research-practice HTML; parsed JSON without executing uploaded scripts", audio: { path: options.audioPath, durationSec }, imagePath: /\[embedded:embedded-listening-map.png\]/.test(html) ? "embedded-listening-map.png" : null,
    questions: source.questions, sections: source.sections,
    keyword1: source.scriptCompletion?.map((row, index) => ({ q: index + 1, sourceQuestion: row.q, at: row.at, end: row.end, text: `${row.before}_____ ${row.after}`, heard: `${row.before}${row.answer}${row.after}`, link: row.answer })) ?? [], keyword2: [],
    vocabulary: source.vocab?.map(row => ({ word: row.word, pos: row.type, uz: row.uz, def: row.def, ex: row.source, also: row.also })) ?? [],
    studyPack: { kind: "research-practice", activities: ["exam", "review", "script", "mcq", "recall", "vocab"], partRanges: source.partRanges, recall: source.focus },
  });
}

/** Authored semantics only: options and question numbers never establish a type. */
export function structuredQuestionType(label: string) {
  const normalized = label.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  // These prove the family, but NOT which canonical map/plan subtype the owner meant.
  if (/^(?:map|plan|map\s*\/\s*plan)$/.test(normalized)) return { kind: "map" as const };
  if (normalized === "completion") return { kind: "completion" as const };
  if (normalized === "single answer mcq") return { kind: "mcq" as const, typeCode: "mcq_single" };
  const stated = normalized.replace(/labelling/g, "labeling").replace(/ /g, "_");
  const typeCode = canonicalListeningTypeId(stated) ?? canonicalListeningTypeId(normalized);
  const kind = typeCode ? listeningKindOfType(typeCode) : null;
  if (!kind || !typeCode) return null;
  return { kind, typeCode };
}

/** A second authored HTML family. Inputs are JSON and inert DOM; executable HTML is never trusted. */
function convertStructuredPractice(html: string, durationSec: number, options: LegacyOptions, read: HtmlDocumentReader): ListeningPackage {
  const source = jsonLiteral(html, "const DATA =") as {
    test_id: string; title: string; sections: string[]; transcript: Record<string, string>;
    questions: Record<string, { q: number; part: number; prompt: string; answer: string; timeStart: number; timeEnd: number; why: string; trap?: string; options?: { code: string; text: string }[] }>;
    alternatives: Record<string, string[]>; question_types: Record<string, string>;
    part_audio_boundaries: Record<string, { start: number; end: number }>;
    script_completion: { q: number; part: number; n?:number; match?:string; prompt?: string; answer: string; start?: number; end?: number }[];
    vocabulary: { headword: string; type: string; definition: string; uzbek: string; context: string; paraphrases?: string[] }[];
    activities: string[];
  };
  const parts = jsonLiteral(html, "const PARTS =") as Record<string, string>;
  const typeOf = (n: number) => {
    const labels = Object.entries(source.question_types).filter(([range]) => { const [a,b] = range.split("-").map(Number); return n >= a! && n <= (b ?? a!); });
    const identity = labels.length === 1 ? structuredQuestionType(labels[0]![1]) : null;
    if (!identity) throw new ListeningImportProblem("package_invalid", {
      info: `Q${n}: source type not canonically proven (${labels.map(([, label]) => label).join(", ") || "missing"}); staff review required`,
    });
    return identity;
  };
  const documents = Object.fromEntries(Object.entries(parts).map(([part, html]) => [part, read(html)]));
  const questions = Object.values(source.questions).sort((a,b) => a.q-b.q).map(row => {
    const document = documents[String(row.part)] ?? read("");
    const control = document.getElementById(`q${row.q}`);
    const instruction = control?.closest(".task-card")?.querySelector(".instructions-block")?.textContent?.replace(/\s+/g," ").trim() ?? "";
    return { number: row.q, section: row.part, text: row.prompt, instruction, ...typeOf(row.q), options: row.options?.map(o => o.text.match(new RegExp(`^${o.code}[).\\s]`)) ? o.text : `${o.code}) ${o.text}`) ?? [], key: row.answer, alternatives: source.alternatives[String(row.q)] ?? [], pair: [], evidence: { at: row.timeStart, end: row.timeEnd, why: [row.why, row.trap].filter(Boolean).join("\n") } };
  });
  // Only source SVGs in map-question parts or explicitly marked map/plan SVGs are stimuli.
  // The inert reader and extractor retain coordinates/text, never scripts or event handlers.
  const mapParts = new Set(questions.filter(q => q.kind === "map").map(q => q.section));
  const diagrams = Object.entries(documents).flatMap(([part, document]) =>
    [...document.querySelectorAll("svg")].filter(svg => mapParts.has(Number(part)) ||
      svg.matches(".la-map, [data-map], [data-plan]") || /\b(map|plan)\b/i.test(svg.getAttribute("aria-label") ?? ""))
      .map(svg => extractMapDiagram(svg)));
  const distinct = new Map(diagrams.map(diagram => [JSON.stringify([diagram.viewBox, diagram.shapes]), diagram]));
  if (distinct.size > 1) throw new ListeningImportProblem("package_invalid", {
    info: "Multiple different map/plan visuals cannot be represented by this package; staff review required",
  });
  const mapDiagram = distinct.values().next().value;
  if (mapParts.size && !mapDiagram) throw new ListeningImportProblem("map_missing", {
    info: "Map/Plan questions require an authored visual; no supported source SVG was found",
  });
  const activities: ("exam"|"review"|"script"|"mcq"|"matching"|"completion"|"map"|"vocab"|"retry")[] = ["exam", "review"];
  if (source.script_completion?.length) activities.push("script");
  if (questions.some(q => q.kind === "mcq")) activities.push("mcq");
  if (questions.some(q => q.kind === "map") && mapDiagram) activities.push("map");
  if (questions.some(q => q.kind === "matching")) activities.push("matching");
  if (questions.some(q => q.kind === "completion")) activities.push("completion");
  if (source.vocabulary?.length) activities.push("vocab");
  if (source.activities?.some(name => /retry/i.test(name))) activities.push("retry");
  const cursors:Record<number,number>={};
  const gaps = source.script_completion.map(row=>{
    const transcript=source.transcript[String(row.part)] ?? "";
    const boundary=source.part_audio_boundaries[String(row.part)];
    if(!boundary)throw new Error("Script part missing");
    let snippet=row.prompt;
    if(row.match){const at=transcript.indexOf(row.match,cursors[row.part]??0);if(at<0)throw new Error(`Script gap ${row.q} absent from transcript`);cursors[row.part]=at+row.match.length;snippet=transcript.slice(Math.max(0,at-90),at)+"_____"+transcript.slice(at+row.match.length,at+row.match.length+90);}
    if(!snippet)throw new Error("Script gap has no source text");
    return {q:row.q,part:row.part,at:row.start ?? boundary.start,end:row.end ?? boundary.end,text:snippet,heard:snippet.replace(/_{2,}/,row.answer),link:row.answer};
  });
  const scriptParts = source.script_completion.every(row=>row.match) ? source.sections.map((_,index)=>({part:index+1,transcript:source.transcript[String(index+1)],gaps:source.script_completion.filter(row=>row.part===index+1).map(row=>({q:row.q,match:row.match!,answer:row.answer}))})) : undefined;
  return listeningPackageSchema.parse({
    schemaVersion: 1, testId: slugTestId(source.test_id || options.fallbackTestId || source.title), title: source.title,
    category: "full", collection: "academic", provenance: "Owner-provided structured practice HTML; authored transcript, question types, evidence and activities; no scripts executed",
    audio: { path: options.audioPath, durationSec }, imagePath: null, mapDiagram,
    sections: source.sections.map((title, index) => ({ number: index+1, title, transcript: source.transcript[String(index+1)] ?? "", reviewRequired: false })), questions,
    keyword1: gaps, keyword2: [],
    vocabulary: source.vocabulary.map(row => ({ word: row.headword, pos: /collocation/i.test(row.type) ? "collocation" : row.type.split("·")[0]!.trim(), def: row.definition, uz: row.uzbek, ex: row.context, also: row.paraphrases ?? [] })),
    studyPack: { kind: "research-practice", activities, scriptParts, recall: [], partRanges: Object.fromEntries(Object.entries(source.part_audio_boundaries).map(([part,range]) => [part, [range.start, range.end]])) },
  });
}
