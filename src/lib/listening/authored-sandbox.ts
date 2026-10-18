/** Executable owner content is permitted only in an opaque-origin iframe.
 * No same-origin, forms, popups or top navigation permissions may be added.
 * The parent supplies inert blobs or a media command bridge, never credentials
 * or signed URLs. Network access stays in the trusted parent.
 */
export const AUTHORED_SANDBOX = "allow-scripts";
export const AUTHORED_CSP = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'";
export function isolateAuthoredDocument(html:string, prelude:string) {
  if(html.length>5*1024*1024)throw Error("Authored document too large");
  // This policy is parsed before ALL source markup/scripts. Subsequent CSPs
  // can only tighten it. Source cannot obtain the parent's origin privileges.
  const policy=`<meta http-equiv="Content-Security-Policy" content="${AUTHORED_CSP}">`;
  return `<!doctype html>${policy}<script>${prelude.replace(/<\/script/gi,"<\\/script")}</script>`+html.replace(/<!doctype[^>]*>/gi,"").replace(/<base\b[^>]*>/gi,"");
}
export function validRuntimeMessage(event: {source:unknown;data:unknown}, frameWindow:unknown, token:string) {
  if(event.source!==frameWindow || !event.data || typeof event.data!=="object")return false;
  const data=event.data as Record<string,unknown>;
  // A view message is UI state only; it remains bound to this exact frame/token.
  return data.channel==="learners-area-authored-v1" && data.token===token && ["storage","navigate","word","view","course","hub-ready","hydrated","media"].includes(String(data.op));
}
