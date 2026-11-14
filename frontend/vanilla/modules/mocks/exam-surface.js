/** Exam colours are independent of the surrounding dashboard theme. */
export const MOCK_EXAM_CSS = `
.mock-speaking-flow{padding:22px;flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}.mock-speaking-topic-actions{display:flex;justify-content:space-between;gap:12px;margin-top:auto}
.mock-writing{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.mock-writing-instruction{margin:16px 22px;padding:14px 16px;border:1px solid #d0d2d5;border-radius:4px;background:#f1f1ed;flex:none}.mock-writing-instruction strong{font-size:20px}.mock-writing-instruction p{margin:2px 0 0}
.mock-writing .cd-split{display:grid;grid-template-columns:minmax(0,var(--cd-split,50%)) 3px minmax(0,1fr);flex:1;min-height:0;overflow:hidden}
.mock-writing .cd-divider{position:relative;cursor:col-resize;background:#818892;touch-action:none}.mock-writing .cd-divider span{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:white;border:1px solid #818892;padding:3px}
.mock-writing .cd-split>.panel{min-height:0;overflow:auto;border:0;border-radius:0;padding:24px;display:flex;flex-direction:column;gap:16px}
.mock-writing [data-mock-writing-editor]{width:100%;min-height:240px;height:100%;flex:1;resize:none;padding:16px;border:1px solid #111827!important;border-radius:4px;font:18px/1.55 Arial,sans-serif}
.mock-writing [data-mock-writing-prompt] p{font:18px/1.55 Arial,sans-serif;white-space:pre-wrap}.mock-writing img{max-width:100%;height:auto;object-fit:contain}
.mock-writing-tabs{padding:8px 22px;border-top:1px solid #cad3dd}.mock-writing-tabs [aria-selected=true]{outline:2px solid #287dbd;outline-offset:-2px}
[data-mock-runner]{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;gap:0!important;width:100%;height:100dvh;overflow:hidden;padding:0}
[data-mock-runner] *,[data-mock-runner] *::before,[data-mock-runner] *::after{box-sizing:border-box}
.mock-exam-header{display:flex;align-items:center;gap:18px;padding:10px 24px;min-height:70px;border-bottom:1px solid #cad3dd;flex:none}
.mock-exam-brand{display:grid;place-items:center;width:42px;height:42px;background:#155a9f;color:white!important;font-weight:700}
.mock-exam-header>div:first-of-type{flex:1}.mock-exam-header h1{font:700 18px Arial,sans-serif}.mock-exam-header p{display:none}.mock-exam-header [data-mock-back-catalogue]{font-size:12px;padding:2px 6px}
[data-mock-stage]{display:flex;flex-direction:column;gap:0!important;flex:1;min-height:0;overflow:hidden}
[data-mock-section-tabs]{padding:6px 22px;border-bottom:1px solid #cad3dd;flex:none}
.mock-exam-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 22px;border-top:1px solid #cad3dd;flex:none;min-height:54px}
[data-mock-stage]>.mock-native{display:flex;flex-direction:column;flex:1;min-height:0;border:0;border-radius:0}
[data-mock-stage] .mock-native-grid{flex:1;min-height:0;overflow:hidden}
[data-mock-stage] .mock-native-pane{max-height:none;min-height:0;height:100%;overflow:auto}
.mock-native-footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #cad3dd;flex:none;padding:8px 18px;gap:12px}
.mock-native-footer .mock-native-nav{border:0;padding:0}.mock-native-head [data-mock-listening-controls]{display:flex;flex-direction:row;align-items:center;gap:12px}.mock-native-head [data-mock-listening-controls] p{margin:0}
@media(max-width:760px){.mock-exam-header{padding:8px 12px;gap:8px}.mock-native-footer{align-items:flex-start;flex-direction:column}.mock-exam-footer{padding:8px 12px}[data-mock-stage] .mock-native-grid{display:flex;flex-direction:column;overflow:auto}[data-mock-stage] .mock-native-pane{height:auto;flex:none;overflow:visible}}
[data-mock-runner]{--paper:255 255 255;--paper-raised:255 255 255;--paper-sunken:246 247 249;--ink-950:17 24 39;--ink-900:17 24 39;--ink-700:30 41 59;--ink-500:71 85 105;--ink-300:100 116 139;--ink-100:210 215 222;color-scheme:light;color:#111827;background:#fff;font:16px/1.5 Arial,sans-serif}
html[data-theme] #root [data-mock-runner] :is(.panel,.card,.input,.badge,.tab,.chip){background:#fff!important;color:#111827!important;border-color:#cbd5e1!important;box-shadow:none!important}
html[data-theme] #root [data-mock-runner] :is(input,select,textarea){color-scheme:light!important;background:#fff!important;color:#111827!important;border-color:#8c9eaf!important;caret-color:#111827!important;box-shadow:none!important}
html[data-theme] #root [data-mock-runner] :is(input,textarea)::placeholder{color:#64748b!important;opacity:1}
html[data-theme] #root [data-mock-runner] :is(h1,h2,h3,h4,p,span,strong,label,li,div){color:inherit}
html[data-theme] #root [data-mock-runner] :is(.text-ink-900,.text-ink-700,.body-text,.field-label){color:#111827!important}
html[data-theme] #root [data-mock-runner] :is(.text-ink-500,.text-ink-300){color:#475569!important}
html[data-theme] #root [data-mock-runner] :is(.btn-primary,.btn-secondary){background:#fff!important;color:#111827!important;border:1px solid #8c9eaf!important;box-shadow:none!important}
html[data-theme] #root [data-mock-runner] .btn-primary{background:#17212d!important;color:#fff!important}
.mock-native{color-scheme:light}.mock-native :is(input,select,textarea){color-scheme:light!important;background:#fff!important;color:#17212d!important;caret-color:#17212d!important}
`;
