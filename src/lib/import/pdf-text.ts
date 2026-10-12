/** PDF text is inert source data. No page rendering, annotations, forms, scripts,
 * external fonts, AI-generated questions or OCR are part of this workflow. */
export async function readPdfTextLayer(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("source_too_large");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  // Next emits the worker as a same-origin build asset. CPU-heavy PDF parsing is
  // kept off the browser's UI thread; Node tests use PDF.js's isolated fallback.
  const port = typeof window !== "undefined" && typeof Worker !== "undefined"
    ? new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), {type: "module"}) : undefined;
  const worker = port ? pdf.PDFWorker.create({port}) : undefined;
  const task = pdf.getDocument({data: bytes, worker, disableFontFace: true, useSystemFonts: false,
    useWorkerFetch: false, useWasm: false,
    stopAtErrors: true, disableAutoFetch: true, disableStream: true, maxImageSize: 1});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (error: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {rejectCancelled = reject;});
  const abort = () => {rejectCancelled(new DOMException("Aborted", "AbortError")); void task.destroy().catch(() => {}); port?.terminate();};
  signal?.addEventListener("abort", abort, {once: true});
  timer = setTimeout(() => {rejectCancelled(new Error("pdf_source_timeout")); void task.destroy().catch(() => {}); port?.terminate();}, 25_000);
  try {
    const document = await Promise.race([task.promise, cancelled]);
    if (document.numPages > 100) throw new Error("source_too_large");
    let text = "";
    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      const page = await Promise.race([document.getPage(pageNo), cancelled]);
      const content = await Promise.race([page.getTextContent(), cancelled]);
      text += content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n";
      page.cleanup();
      if (text.length > 5 * 1024 * 1024) throw new Error("source_too_large");
    }
    return text.trim();
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    void task.destroy().catch(() => {});
    worker?.destroy(); port?.terminate();
  }
}
