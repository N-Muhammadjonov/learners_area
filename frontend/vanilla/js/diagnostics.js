/** Explicit server-approved preview flag only; never URL/storage enabled. */
const lifetimes=new WeakMap();let actionMeasurement=()=>()=>{};
export const beginActionMeasurement=(category,signal)=>actionMeasurement(category,signal);
export async function enableDiagnostics(signal,{shell=false}={}){if(signal.aborted)return;let installed=lifetimes.get(signal);if(!installed){installed=new Set();lifetimes.set(signal,installed);}const name=shell?'performance':'global';if(installed.has(name))return;installed.add(name);
 try{const [module,controls]=await Promise.all([import(shell?'./generated/performance-diagnostics.js':'./generated/global-diagnostics.js'),shell?import('./generated/global-diagnostics.js'):null]);if(signal.aborted)return;const dispose=module.setup(),stopControls=controls?.setup({insideShell:true});if(controls)actionMeasurement=controls.beginActionMeasurement;signal.addEventListener('abort',()=>{dispose();stopControls?.();},{once:true});}catch{ /* Optional QA instrumentation must never block the real user workflow. */ }
}
export const rootDiagnosticsEnabled=()=>document.documentElement.dataset.performanceDiagnostics==='on';
