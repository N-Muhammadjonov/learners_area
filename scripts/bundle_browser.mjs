/** Build-only feature bundling; application sources and public asset paths stay intact. */
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve, sep, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {rollup} from 'rollup';

const sha = value => createHash('sha256').update(value).digest('hex');
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function scripts(root) {
  return readdirSync(root, {withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink() || entry.name === 'build' || entry.name === 'node_modules') return [];
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? scripts(path) : /\.m?js$/.test(entry.name) ? [path] : [];
  });
}

/** Enumerate finite conditional strings and bounded template paths, without eval. */
function patterns(node, bindings, seen = new Set()) {
  if (!node) return null;
  if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : [];
  if (node.type === 'ConditionalExpression') {
    const a = patterns(node.consequent, bindings, seen), b = patterns(node.alternate, bindings, seen);
    return a && b ? [...new Set([...a, ...b])] : null;
  }
  if (node.type === 'Identifier' && bindings.has(node.name) && !seen.has(node.name)) {
    return patterns(bindings.get(node.name), bindings, new Set([...seen, node.name]));
  }
  if (node.type === 'ObjectExpression') {
    const values=node.properties.map(property=>patterns(property.value,bindings,seen));
    return values.every(Boolean) ? [...new Set(values.flat())] : null;
  }
  if (node.type === 'MemberExpression' && node.computed) {
    return patterns(node.object,bindings,seen);
  }
  if (node.type === 'TemplateLiteral') {
    let values = [''];
    for (let i=0; i<node.quasis.length; i++) {
      values = values.map(value => value + node.quasis[i].value.cooked);
      if (i < node.expressions.length) {
        const parts = patterns(node.expressions[i], bindings, seen) ?? ['*'];
        values = values.flatMap(value => parts.map(part => value + part));
      }
    }
    return values;
  }
  return null;
}

function group(id, project) {
  const name = relative(project,id).split(sep).join('/');
  if (name.startsWith('modules/staff-final30/')) return 'management';
  if (name.startsWith('modules/')) {
    const part = name.split('/')[1];
    return part.endsWith('.js') ? part.replace(/\.js$/,'') : part;
  }
  if (name.startsWith('js/i18n/')) return 'locale-' + name.split('/').at(-1).replace(/\.js$/,'');
  if (/diagnostics/.test(name)) return 'diagnostics';
  if (name === 'js/workspace.js') return 'shell';
  return 'runtime';
}

function dynamicGroup(source,target,project) {
  const path=relative(project,target).split(sep).join('/');
  if(path.startsWith('js/generated/')) {
    if(/diagnostics/.test(path)) return 'diagnostics';
    if(source.startsWith(resolve(project,'modules')+sep)) {
      const owner=group(source,project);
      if(owner!=='shared') return owner;
      const view=path.split('/').at(-1).replace(/\.js$/,'');
      return /^(listening|reading|speaking|writing|vocabulary|grammar)-/.test(view)?view.split('-')[0]:'route-view';
    }
  }
  return group(target,project);
}

export async function buildBrowser({project=resolve('frontend/vanilla'), outDir=resolve('bundle-output')}={}) {
  project=resolve(project); outDir=resolve(outDir);
  if (outDir === project || project.startsWith(outDir+sep)) throw new Error('Unsafe bundle output directory');
  const input=resolve(project,'js/main.js'), files=scripts(project);
  const dynamic=[], resources=[], info=new Map();
  const bundle=await rollup({
    input, preserveEntrySignatures:false,
    treeshake:{moduleSideEffects:true},
    external:id => /^(https?:|data:|blob:)/.test(id),
    plugins:[{
      name:'bounded-source-imports',
      buildEnd(error) {
        if(!error) for(const id of this.getModuleIds()) {
          const module=this.getModuleInfo(id);
          if(!module.isExternal) info.set(id,module);
        }
      },
      transform(source,id) {
        if (!id.startsWith(project+sep)) return null;
        const ast=this.parse(source), bindings=new Map(), expressions=[];
        walk(ast,node=>{
          if(node.type==='VariableDeclarator' && node.id.type==='Identifier') bindings.set(node.id.name,node.init);
          if(node.type==='ImportExpression' && node.source.type!=='Literal') expressions.push(node);
        });
        const edits=[];
        for(const expression of expressions) {
          const choices=patterns(expression.source,bindings);
          if (!choices) {
            // Native URL imports retain their source anchor via resolveImportMeta.
            if (expression.source.type==='MemberExpression' && expression.source.property.name==='href') continue;
            throw new Error('Unbounded dynamic import in '+relative(project,id));
          }
          if(choices.some(value=>!value.startsWith('./')&&!value.startsWith('../'))) throw new Error('Unbounded import path in '+id);
          const candidates=new Set();
          for(const pattern of choices) {
            const escaped=pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]+');
            const matcher=new RegExp('^'+escaped+'$');
            for(const file of files) {
              let specifier=relative(dirname(id),file).split(sep).join('/');
              if(!specifier.startsWith('.')) specifier='./'+specifier;
              if(matcher.test(specifier)) candidates.add(specifier);
            }
            if(!pattern.includes('*')&&!candidates.has(pattern)) throw new Error('Missing dynamic import '+pattern+' in '+id);
          }
          if(!candidates.size) throw new Error('Empty dynamic import in '+id);
          const argument=source.slice(expression.source.start,expression.source.end);
          const cases=[...candidates].sort().map(value=>`case ${JSON.stringify(value)}:return import(${JSON.stringify(value)});`).join('');
          edits.push({start:expression.start,end:expression.end,code:`((specifier)=>{switch(specifier){${cases}default:return Promise.reject(new TypeError('Unknown local module: '+specifier));}})(${argument})`});
          dynamic.push({source:relative(project,id).split(sep).join('/'),candidates:[...candidates].sort()});
        }
        for(const edit of edits.sort((a,b)=>b.start-a.start)) source=source.slice(0,edit.start)+edit.code+source.slice(edit.end);
        return edits.length ? {code:source,map:null} : null;
      },
      resolveImportMeta(property,{moduleId}) {
        if(property!=='url' || !moduleId.startsWith(project+sep)) return null;
        const path='/'+relative(project,moduleId).split(sep).join('/');
        resources.push(path);
        return `new URL(${JSON.stringify(path)},globalThis.location.href).href`;
      }
    }],
    onwarn(warning) { throw new Error(warning.code+': '+warning.message); }
  });
  try {
    // Static reachability is monotone along every import edge. Shared dependencies
    // cannot point back into a single feature, so merging them cannot create the
    // artificial chunk cycle that previously evaluated return-policy before routes.
    const reach=new Map();
    function visit(id,label) {
      if(!info.has(id)) return;
      const labels=reach.get(id)??new Set(); if(labels.has(label)) return;
      labels.add(label); reach.set(id,labels);
      for(const dependency of info.get(id).importedIds) visit(dependency,label);
    }
    visit(input,'startup');
    for(const module of info.values()) for(const target of module.dynamicallyImportedIds) visit(target,dynamicGroup(module.id,target,project));
    rmSync(outDir,{recursive:true,force:true}); mkdirSync(outDir,{recursive:true});
    const result=await bundle.write({
      dir:outDir,format:'es',compact:true,sourcemap:false,
      entryFileNames:'js/main.js',chunkFileNames:'js/bundles/[name]-[hash:12].js',
      onlyExplicitManualChunks:true,
      manualChunks(id) {
        if(id===input) return undefined;
        const labels=reach.get(id);
        if(!labels?.size) throw new Error('Unclassified browser module: '+id);
        // Preserve the startup -> public auth -> private shell loading tiers.
        // An import's consumer set is a superset of its importer, so these tiers
        // cannot create a static back-edge. Later shared code stays off login.
        for(const tier of ['startup','auth','shell']) if(labels.has(tier)) return tier;
        if(labels.has('dashboard')) return labels.size>1?'shared-dashboard':'dashboard';
        return labels.size>1?'shared':[...labels][0];
      }
    });
    const chunks=result.output.filter(output=>output.type==='chunk');
    const byName=new Map(chunks.map(chunk=>[chunk.fileName,chunk]));
    const visiting=new Set(),done=new Set();
    function check(name) {
      if(visiting.has(name)) throw new Error('Circular static chunk graph: '+name);
      if(done.has(name)) return;
      const chunk=byName.get(name); if(!chunk) throw new Error('Missing browser chunk: '+name);
      visiting.add(name); for(const imported of chunk.imports) check(imported);
      visiting.delete(name); done.add(name);
      for(const imported of chunk.dynamicImports) if(!byName.has(imported)) throw new Error('Missing lazy chunk: '+imported);
    }
    for(const chunk of chunks) check(chunk.fileName);
    const entry=byName.get('js/main.js'), startup=new Set();
    function eager(name) {if(startup.has(name))return;startup.add(name);byName.get(name).imports.forEach(eager);}
    eager(entry.fileName);
    const features=['listening','reading','speaking','writing','vocabulary','grammar','management'];
    for(const name of startup) if(features.some(feature=>name.startsWith('js/bundles/'+feature+'-'))) throw new Error('Eager feature chunk: '+name);
    const sourceFiles=Object.fromEntries([...info.keys()].sort().map(id=>[relative(project,id).split(sep).join('/'),sha(readFileSync(id))]));
    const report={version:2,entry:entry.fileName,chunkCount:chunks.length,sourceFiles,
      startup:[...startup].sort(),dynamicImports:dynamic,resourceAnchors:[...new Set(resources)].sort(),
      chunks:chunks.map(chunk=>({path:chunk.fileName,bytes:Buffer.byteLength(chunk.code),sha256:sha(chunk.code),imports:chunk.imports,dynamicImports:chunk.dynamicImports,modules:Object.keys(chunk.modules).map(id=>relative(project,id).split(sep).join('/')).sort()}))};
    writeFileSync(resolve(outDir,'bundle-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({chunkCount:chunks.length,codeBytes:report.chunks.reduce((sum,row)=>sum+row.bytes,0),startup:report.startup}));
    return report;
  } finally { await bundle.close(); }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{project:{type:'string'},out:{type:'string'}}});
  await buildBrowser({project:values.project,outDir:values.out});
}
