/**
 * Error labelling that is safe to write into a production log.
 *
 * Kept free of any Next.js request imports on purpose: `src/instrumentation.ts`
 * uses it too, and that module is loaded by the framework outside any request.
 *
 * A message can carry a query string, a file path or a value; a class name and a
 * system code cannot. So the label is the class plus, when the driver provides
 * one, its code — `Error/ECONNRESET`, `Error/57P01`, `ZodError` — and the one
 * place a message is allowed is the single truncated line
 * `instrumentation.ts` writes per failed request, where it is the whole point.
 */
export function safeErrorLabel(error: unknown): string {
  if (typeof error !== "object" || error === null) return typeof error;
  const name = (error as { name?: string }).name ?? "Error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? `${name}/${code}` : name;
}

/** File, line and column of the first stack frame — never its arguments. */
export function firstStackFrame(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const stack = (error as { stack?: unknown }).stack;
  if (typeof stack !== "string") return "";
  const frame = stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.startsWith("at "));
  if (!frame) return "";
  const match = /\(?([^()\s]+?):(\d+):(\d+)\)?$/.exec(frame.replace(/^at\s+/, ""));
  return match ? `${match[1]}:${match[2]}` : "";
}

/** `Error/ECONNRESET ← Error/"Connection terminated unexpectedly"` — causes included. */
export function causalChain(error: unknown, depth = 4): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let level = 0; level < depth && current; level += 1) {
    parts.push(safeErrorLabel(current));
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      parts.push(`"${message.replace(/\s+/g, " ").slice(0, 160)}"`);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" ← ");
}
