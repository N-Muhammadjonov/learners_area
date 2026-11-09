/** Accent is for active navigation and keyboard focus, not universal frames. */
export function workspaceAccent(url){return {listening:'#087c83',reading:'#315fd6',writing:'#167544',speaking:'#7551ca'}[url?.pathname.split('/')[2]]??'#3b6cff';}
