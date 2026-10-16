import test from "node:test";
import assert from "node:assert/strict";
import {AUTHORED_CSP,AUTHORED_SANDBOX,isolateAuthoredDocument,validRuntimeMessage} from "../src/lib/listening/authored-sandbox";
test("authored runtime cannot acquire parent origin or network privileges",()=>{
 assert.equal(AUTHORED_SANDBOX,"allow-scripts");
 assert.ok(!AUTHORED_SANDBOX.includes("allow-same-origin"));
 for(const rule of ["default-src 'none'","connect-src 'none'","form-action 'none'","base-uri 'none'","object-src 'none'","frame-src 'none'"])assert.ok(AUTHORED_CSP.includes(rule));
 const doc=isolateAuthoredDocument('<html><head><base href="https://evil.invalid"></head><body><script>parent.document.cookie</script></body></html>','const text="</script><script>bad()</script>";');
 assert.ok(doc.indexOf('Content-Security-Policy')<doc.indexOf('parent.document.cookie'));
 assert.ok(!doc.includes('<base'));
 assert.ok(doc.includes('<\\/script'));
 assert.throws(()=>isolateAuthoredDocument('x'.repeat(5*1024*1024+1),''));
});
test("iframe messages bind to the exact source window and a per-mount channel",()=>{
 const frame={},data={channel:"learners-area-authored-v1",token:"random-per-mount",op:"word"};
 assert.equal(validRuntimeMessage({source:frame,data},frame,'random-per-mount'),true);
 assert.equal(validRuntimeMessage({source:{},data},frame,'random-per-mount'),false);
 assert.equal(validRuntimeMessage({source:frame,data},frame,'other'),false);
 assert.equal(validRuntimeMessage({source:frame,data:{...data,op:'fetch'}},frame,'random-per-mount'),false);
 assert.equal(validRuntimeMessage({source:frame,data:{...data,op:'view',hub:false}},frame,'random-per-mount'),true);
 assert.equal(validRuntimeMessage({source:{},data:{...data,op:'view',hub:false}},frame,'random-per-mount'),false);
});
