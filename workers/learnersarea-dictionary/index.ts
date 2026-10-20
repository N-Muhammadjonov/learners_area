import {serveDictionary,type DictionaryEnvironment} from './handler';
const worker={fetch(request:Request,env:DictionaryEnvironment){const cache=(globalThis as unknown as {caches?:{default:Parameters<typeof serveDictionary>[2]}}).caches?.default;return serveDictionary(request,env,cache);}};
export default worker;
