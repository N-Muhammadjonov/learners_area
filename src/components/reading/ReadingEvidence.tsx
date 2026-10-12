import type { Dictionary } from '@/lib/i18n/en';

/** Exact authored evidence located ONLY in the question's own passage.
 * No fuzzy search, inferred answer, invented rationale or lexical target. */
export function ReadingEvidence({dict, body, title, quote}:{dict:Dictionary;body:string;title:string;quote:string}) {
  const start = quote.trim() ? body.indexOf(quote) : -1;
  if (start < 0) return <p data-reading-evidence-unlocated>{dict.readingPractice.evidenceMissing}</p>;
  const end = start + quote.length;
  return <details data-reading-evidence-location>
    <summary className="cursor-pointer text-xs">{dict.reading.evidence}: {title}</summary>
    <p className="mt-2 whitespace-pre-line text-sm" data-reading-evidence-context>
      {start > 100 ? '…' : ''}{body.slice(Math.max(0,start-100),start)}
      <mark>{body.slice(start,end)}</mark>
      {body.slice(end,end+100)}{end+100<body.length ? '…' : ''}
    </p>
  </details>;
}
