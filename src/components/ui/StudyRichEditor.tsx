"use client";
import { useEffect, useRef } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import { cleanStudyHtml } from "@/lib/speaking/rich-text";

export function StudyRichEditor({ dict, label, value, onChange }: { dict: Dictionary; label: string; value: string; onChange: (html: string) => void }) {
  const t = dict.speakingStudy;
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  useEffect(() => { if (editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = cleanStudyHtml(value); }, [value]);
  function remember() {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    if (range && editor.current?.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
  }
  function command(name: string, arg?: string) {
    editor.current?.focus();
    if (selection.current) { const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(selection.current); }
    document.execCommand(name, false, arg);
    if (editor.current) onChange(editor.current.innerHTML);
    remember();
  }
  return <div className="space-y-2">
    <div role="toolbar" aria-label={`${label}: ${t.formatting}`} className="flex flex-wrap gap-2">
      {[[t.bold, "bold"], [t.italic, "italic"], [t.underline, "underline"], [t.highlight, "hiliteColor"]].map(([text, name]) => <button key={name} type="button" className="btn-secondary min-h-11" onPointerDown={e => e.preventDefault()} onClick={() => command(name!, name === "hiliteColor" ? "#fff1a8" : undefined)}>{text}</button>)}
      <select aria-label={`${label}: ${t.font}`} className="input w-auto" defaultValue="" onChange={e => command("fontName", e.target.value)}><option value="" disabled>{t.font}</option>{["Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"].map(font => <option key={font}>{font}</option>)}</select>
    </div>
    <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label={label} aria-multiline="true" className="input min-h-40 overflow-auto whitespace-pre-wrap" onKeyUp={remember} onPointerUp={remember} onInput={() => { remember(); if (editor.current) onChange(editor.current.innerHTML); }} onPaste={e => { remember(); e.preventDefault(); const html = e.clipboardData.getData("text/html"); if (html) command("insertHTML", cleanStudyHtml(html)); else command("insertText", e.clipboardData.getData("text/plain")); }} />
  </div>;
}
