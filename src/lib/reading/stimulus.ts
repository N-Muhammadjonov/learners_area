/**
 * Shared question stimuli: notes, summaries and flow-charts.
 *
 * 191 of the imported questions do not carry their own sentence. Their prompt is
 * a *window* cut around their own blank out of one longer stimulus that the whole
 * group shares — a set of notes, a summary or a flow-chart. The window also
 * contains the *sibling* blanks of the group, printed as "2 ______" or cut off at
 * "3" when the window ends right after the number. Rendering those rows one by
 * one would show the same notes four times over, and rendering them raw would put
 * a literal "______" on screen with nothing to type into.
 *
 * So the group's stimulus is rebuilt once, by normalising every window's blanks
 * into `{{qN}}` tokens and stitching the windows together along their overlap.
 * On the imported library that reconstruction is clean for all 41 shared-stimulus
 * groups: every question of the group is reachable in the rebuilt text and no
 * span is duplicated.
 *
 * Pure module: no database, no React — the exam component only renders the
 * segments this returns, and the unit tests below feed it hand-built windows.
 */

export type StimulusRow = {
  /** The question this window belongs to. */
  questionNo: number | null;
  /** The window text, with this question's own blank and its siblings'. */
  questionText: string;
};

export type StimulusSegment = { kind: "text"; text: string } | { kind: "slot"; questionNo: number };

export type SharedStimulus = {
  /** The rebuilt stimulus; `{{qN}}` marks every blank. */
  text: string;
  /** Question numbers whose blank is present in `text`, in question order. */
  numbers: number[];
  /** Questions of the group whose blank could not be located — render them on their own. */
  missing: number[];
};

/** "2 ______" / "12 ____" — a sibling blank that still carries its printed number. */
const PRINTED_NUMBER_BLANK = /(\d{1,2})\s*_{2,}/g;
/** A bare blank is always the window's own question. */
const ANY_BLANK = /_{2,}/g;
/** A window can be cut right after a printed number, before its underscores. */
const TRAILING_NUMBER = /(\d{1,2})(\s*)$/;
const TOKEN = /\{\{q(\d+)\}\}/;

/** The smallest overlap that still counts as "these two windows are the same text". */
const MIN_OVERLAP = 20;

/**
 * Turn one raw window into token form.
 *
 * A printed number in front of a blank belongs to a sibling question; a bare
 * blank belongs to this row. The trailing-number rule covers the window that was
 * cut — "…help to develop the urban 4" is question 4's blank with its underscores
 * lost, which is exactly where a naive stitch would duplicate a paragraph.
 */
export function normaliseStimulusRow(
  text: string,
  ownNo: number,
  siblingNumbers: ReadonlySet<number>
): string {
  const withPrinted = text.replace(PRINTED_NUMBER_BLANK, (_match, n: string) => `{{q${n}}}`);
  const withOwn = withPrinted.replace(ANY_BLANK, `{{q${ownNo}}}`);
  return withOwn.replace(TRAILING_NUMBER, (match, n: string, whitespace: string) =>
    siblingNumbers.has(Number(n)) ? `{{q${n}}}${whitespace}` : match
  );
}

/**
 * Stitch two windows: the longest suffix of `left` that is also a prefix of
 * `right` is the shared text. When nothing overlaps (a gap the source does not
 * contain) the windows are kept as separate paragraphs rather than merged into a
 * sentence that was never written.
 */
export function mergeStimulusWindows(left: string, right: string): string {
  const longest = Math.min(left.length, right.length);
  for (let size = longest; size >= MIN_OVERLAP; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) return left + right.slice(size);
  }
  return `${left}\n\n${right}`;
}

export function buildSharedStimulus(rows: StimulusRow[]): SharedStimulus {
  const ordered = rows
    .filter(
      (row): row is { questionNo: number; questionText: string } =>
        typeof row.questionNo === "number" && row.questionText.trim() !== ""
    )
    .sort((a, b) => a.questionNo - b.questionNo);

  const siblingNumbers = new Set(ordered.map((row) => row.questionNo));
  let text: string | null = null;
  for (const row of ordered) {
    const window = normaliseStimulusRow(row.questionText, row.questionNo, siblingNumbers);
    text = text === null ? window : mergeStimulusWindows(text, window);
  }

  const rebuilt = text ?? "";
  const numbers = ordered.filter((row) => rebuilt.includes(`{{q${row.questionNo}}}`)).map((row) => row.questionNo);
  const missing = ordered.filter((row) => !rebuilt.includes(`{{q${row.questionNo}}}`)).map((row) => row.questionNo);
  return { text: rebuilt, numbers, missing };
}

/** Split token form into text runs and blanks; used to place one input per blank. */
export function parseStimulus(text: string): StimulusSegment[] {
  const segments: StimulusSegment[] = [];
  let rest = text;
  for (;;) {
    const match = TOKEN.exec(rest);
    if (!match || match.index === undefined) break;
    const before = rest.slice(0, match.index);
    if (before) segments.push({ kind: "text", text: before });
    segments.push({ kind: "slot", questionNo: Number(match[1]) });
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) segments.push({ kind: "text", text: rest });
  return segments;
}

/**
 * Does this text already carry a blank this renderer can place an input into?
 *
 * Kept on non-global patterns on purpose: a `g`-flagged regex carries `lastIndex`
 * between calls, so reusing the module-level ones here would answer "no" every
 * other time.
 */
export function hasBlank(text: string): boolean {
  return /\{\{q\d+\}\}/.test(text) || /_{2,}/.test(text) || /\d{1,2}\s*_{2,}/.test(text);
}

/**
 * Is this row part of a shared stimulus rather than a question of its own?
 *
 * `render_mode` is what the importer recorded; the text is checked as well so a
 * row that lost its mode but still shows a sibling's printed blank is not left
 * without an input.
 */
export function isSharedStimulusRow(row: { renderMode: string | null; questionText: string }): boolean {
  if (row.renderMode === "shared_stimulus_slot") return true;
  if (row.renderMode && row.renderMode !== "question_row") return false;
  const printed = row.questionText.match(PRINTED_NUMBER_BLANK);
  // A bare blank is the row's own and QuestionCard already renders it inline.
  return Boolean(printed && printed.length > 0);
}
