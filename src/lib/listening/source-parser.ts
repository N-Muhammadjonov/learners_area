import { listeningPackageSchema, type ListeningPackage } from "./package";

/** Only JSON literals are read. No eval, Function, imported scripts, event handlers or HTML rendering. */
export function jsonLiteral(html: string, marker: string): unknown {
  const index = html.indexOf(marker);
  if (index < 0) throw new Error(`Missing source data: ${marker}`);
  const start = html.indexOf("=", index) + 1;
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
export function convertLegacyPackage(
  files: Record<string, string>,
  durationSec: number,
  read: HtmlDocumentReader,
): ListeningPackage {
  const html = files["01_full_exam.html"];
  if (!html) throw new Error("01_full_exam.html missing");
  const meta = JSON.parse(files["metadata.json"] ?? "null");
  if (!meta?.test_id || !Array.isArray(meta.sections))
    throw new Error("metadata.json missing or invalid");
  const plain = (s: string) =>
    read(s).body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const doc = read(
    html.replace(/\s(?:src|href|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
  );
  const keys = jsonLiteral(html, "const KEY =") as Record<string, string>;
  const alt = jsonLiteral(html, "const ALT =") as Record<string, string[]>;
  const pairs = jsonLiteral(html, "const PAIR_OF =") as Record<
    string,
    number[]
  >;
  const evidence = jsonLiteral(html, "window.RS_WHY =") as Record<
    string,
    { at: number; why: string }
  >;
  const questions = Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    const input =
      doc.getElementById(`l${n}`) ?? doc.querySelector(`[name="l${n}"]`);
    if (!input) throw new Error(`Q${n}: source control missing`);
    const section = input.closest(".lp");
    const host =
      input.closest(".question") ?? input.closest(".notes-row,tr,li,p");
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
      host.querySelector(".qtext")?.textContent?.trim() ?? plain(segment);
    if (meta.map_file && input.tagName === "SELECT" && n >= 18 && n <= 20)
      text = `Label ${n} on the supplied map (A–G)`;
    const options = host.querySelectorAll(".q-opt,.q-choice");
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
                input.closest(".notes-block")?.querySelectorAll(":scope > div > div") ??
                  [],
              )
                .map((node) => plain(node.textContent ?? ""))
                .find((value) => value.startsWith(`${letter} `));
              return legend ?? o.textContent ?? "";
            })
        : [];
    const instruction =
      Array.from(section.querySelectorAll(".q-instructions"))
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
      alternatives: alt[n] ?? [],
      pair: pairs[n] ?? [],
      evidence: { at: e.at, why: plain(e.why) },
    };
  });
  const keyword1 = (
    jsonLiteral(
      files["03_keyword_match_1.html"] ?? "",
      "const KEYS =",
    ) as ListeningPackage["keyword1"]
  ).map((x) => ({ ...x, text: plain(x.text) }));
  const keyword2 = jsonLiteral(
    files["04_keyword_match_2.html"] ?? "",
    "const ITEMS=",
  );
  const vocabulary = jsonLiteral(
    files["05_vocabulary_session.html"] ?? "",
    "const ITEMS =",
  );
  const transcripts = files["data/transcript.json"]
    ? (JSON.parse(files["data/transcript.json"]) as {
        number: number;
        text: string;
        reviewRequired?: boolean;
      }[])
    : [];
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
