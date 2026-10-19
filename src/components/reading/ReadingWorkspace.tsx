"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Viewport-owned practice chrome. Content, answers and permissions stay in the
 * existing Academic/General controllers; neither pane can scroll the app shell. */
export function ReadingWorkspace({ brand, title, tools, passage, questions, navigation, action, pane, setPane, labels }: {
  brand: string; title: string; tools?: ReactNode; passage: ReactNode; questions: ReactNode;
  navigation: ReactNode; action: ReactNode; pane: "passage" | "questions";
  setPane: (pane: "passage" | "questions") => void;
  labels: { passage: string; questions: string; resize: string; smaller: string; larger: string };
}) {
  const [split, setSplit] = useState(58);
  const [fontSize, setFontSize] = useState(16);
  const panels = useRef<HTMLDivElement>(null);
  const constrain = (n: number) => Math.max(35, Math.min(70, n));
  return <div className="reading-workspace" data-reading-workspace style={{ "--reading-split": `${split}%`, "--reading-font-size": `${fontSize}px` } as CSSProperties}>
    <header className="reading-workspace-header">
      <div className="reading-workspace-identity"><span className="reading-workspace-brand">{brand}</span><h1>{title}</h1></div>
      <div className="reading-workspace-tools">{tools}<div className="reading-font-controls">
        <button type="button" aria-label={labels.smaller} disabled={fontSize <= 14} onClick={() => setFontSize(n => Math.max(14, n - 1))}>A−</button>
        <button type="button" aria-label={labels.larger} disabled={fontSize >= 22} onClick={() => setFontSize(n => Math.min(22, n + 1))}>A+</button>
      </div></div>
    </header>
    <div className="reading-mobile-tabs" role="tablist" aria-label={title}>
      {(["passage", "questions"] as const).map(key => <button key={key} type="button" role="tab" aria-selected={pane === key} aria-controls={`reading-${key}-pane`} onClick={() => setPane(key)}>{labels[key]}</button>)}
    </div>
    <div ref={panels} className="reading-workspace-panels" data-reading-pane={pane}>
      <section id="reading-passage-pane" className="reading-workspace-passage" aria-label={labels.passage}>{passage}</section>
      <div role="separator" aria-orientation="vertical" aria-label={labels.resize} aria-valuemin={35} aria-valuemax={70} aria-valuenow={Math.round(split)} tabIndex={0} className="reading-workspace-divider"
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const box = panels.current?.getBoundingClientRect(); if (box) setSplit(constrain((event.clientX - box.left) / box.width * 100)); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSplit(n => constrain(n + (event.key === "ArrowLeft" ? -2 : 2))); } }}><span /></div>
      <section id="reading-questions-pane" className="reading-workspace-questions" aria-label={labels.questions}>{questions}</section>
    </div>
    <footer className="reading-workspace-footer"><nav className="reading-question-navigation" aria-label={labels.questions}>{navigation}</nav><div className="reading-workspace-action">{action}</div></footer>
  </div>;
}

export function focusReadingQuestion(questionId: string) {
  const input = document.getElementById(`answer-${questionId}`);
  const target = input ?? Array.from(document.querySelectorAll<HTMLElement>("[data-question]")).find(node => node.dataset.question === questionId);
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (input instanceof HTMLElement) input.focus({ preventScroll: true });
}
