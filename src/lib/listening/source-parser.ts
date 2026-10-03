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
    .replace(/\.zip$/i, "")
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
  const html = examHtml(files);
  if (!html) throw new ListeningImportProblem("no_question_source");
  // metadata.json is helpful but no longer mandatory. When it is absent the
  // values are DERIVED (ZIP name, chosen audio, structural section numbers),
  // never invented, and the provenance says so.
  let parsedMeta: { test_id?: string; sections?: string[]; audio_file?: string; map_file?: string; source_identity?: string; internal_provenance?: string } | null = null;
  try { parsedMeta = JSON.parse(textFile(files, "metadata.json") ?? textFile(files, "manifest.json") ?? "null"); } catch { parsedMeta = null; }
  const inferred = !parsedMeta?.test_id || !Array.isArray(parsedMeta.sections) || parsedMeta.sections.length !== 4;
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
  const keys = jsonLiteral(html, "const KEY =") as Record<string, string>;
  const alt = jsonLiteral(html, "const ALT =") as Record<string, string[]>;
  const modern = !/\bPAIR_OF\s*=/.test(html) && /\bPAIRS\s*=/.test(html);
  const pairAnswers = modern ? jsonLiteral(html, "const PAIRS =") as Record<string, string[]> : null;
  const pairs = modern ? Object.fromEntries(Object.keys(pairAnswers!).map(n => [n, [Number(n) % 2 ? Number(n) + 1 : Number(n) - 1]]))
    : jsonLiteral(html, "const PAIR_OF =") as Record<string, number[]>;
  const reviewRows = modern ? jsonLiteral(textFile(files, "02_review_revision.html") ?? "", "const DATA =") as {q: number; at: number; why: string}[] : null;
  const evidence = reviewRows ? Object.fromEntries(reviewRows.map(row => [row.q, row]))
    : jsonLiteral(html, "window.RS_WHY =") as Record<string, { at: number; why: string }>;
  const questions = Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
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
    const e = evidence[n];
    if (!e) throw new Error(`Q${n}: explanation missing`);
    return {
      number: n,
      section: Math.ceil(n / 10),
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
    jsonLiteral(
      textFile(files, "03_keyword_match_1.html") ?? "",
      "const KEYS =",
    ) as ListeningPackage["keyword1"]
  ).map((x) => ({ ...x, text: plain(x.text) }));
  const keyword2Raw = jsonLiteral(textFile(files, "04_keyword_match_2.html") ?? "", "const ITEMS=") as Record<string, unknown>[];
  const keyword2 = modern ? keyword2Raw.map(row => ({ q: row.q, at: row.at, end: row.end,
    heard: plain(String(row.evidence ?? "")), link: plain(String(row.text ?? "")), answer: row.answer })) : keyword2Raw;
  const vocabularyHtml = textFile(files, "05_vocabulary_session.html") ?? "";
  const vocabulary = modern ? (jsonLiteral(vocabularyHtml, "const V =") as Record<string, unknown>[]).map(row => ({
    word: row.word, pos: row.pos, uz: row.uz, def: row.definition, ex: row.example,
    also: String(row.para ?? "").split(";").map(x => x.trim()).filter(Boolean),
    // This source did not author a quiz. Do not fabricate one.
  })) : jsonLiteral(vocabularyHtml, "const ITEMS =");
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
    sections: meta.sections.map((title: string, i: number) => ({
      number: i + 1,
      title,
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
