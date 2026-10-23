/* Validated routes and browser history for the static explorer. */
function createExplorerNavigation({
  architecture: A, measurements: M, sourceIndex: I,
  getState, setState, render, focus = () => {}, env = window
}) {
  const defaults = Object.freeze({
    view:'architecture', component:null, focus:null, symbol:null, commit:null,
    tab:'details', measure:'scaling', deck:'tuned', precision:'Mixed',
    hardware:'b200', unit:'nsPerDay'
  });
  const allowed = {
    view:['architecture','movement','measurements'], tab:['details','code','evidence'],
    measure:['scaling','stock','validation'], deck:['tuned','g92','cellulose'],
    precision:['Mixed','FP64'], hardware:M.hardware.map(h=>h.id), unit:['nsPerDay','msPerStep']
  };
  const components = new Map(A.components.map(c=>[c.id,c]));
  const commits = new Set(M.history.map(c=>c.sha));
  const key = s => JSON.stringify([s.path,s.line,s.name]);
  const symbols = new Map(I.symbols.map(s=>[key(s),s]));
  const owners = new Map();
  for (const component of A.components) for (const symbol of component.functions) {
    const k=key(symbol);
    symbols.set(k,symbol); // Prefer curated snippets over bare lexical entries.
    owners.set(k,[...(owners.get(k)||[]),component.id]);
  }
  let started=false, lastURL=null, lastRoute=null;

  function resolveSymbol(candidate) {
    if(!candidate || typeof candidate.path!=='string' || typeof candidate.name!=='string'
      || !Number.isSafeInteger(candidate.line) || candidate.line<1)return null;
    return symbols.get(key(candidate))||null;
  }
  function ownerOf(symbol, requested) {
    const known=owners.get(key(symbol));
    // Indexed routines in a component's listed source files can also use its
    // parts navigator. When a file belongs to several components, honor a valid
    // requested owner; otherwise use the first curated component deterministically.
    const candidates=known||A.components.filter(c=>c.paths.includes(symbol.path)).map(c=>c.id);
    return candidates.includes(requested)?requested:candidates[0]||null;
  }
  function normalize(candidate={}) {
    const next={...defaults};
    for(const [field,values] of Object.entries(allowed))
      if(values.includes(candidate[field]))next[field]=candidate[field];
    if(next.view==='architecture') {
      next.component=components.has(candidate.component)?candidate.component:null;
      next.focus=next.component && candidate.focus===next.component?next.component:null;
      next.symbol=resolveSymbol(candidate.symbol);
      if(next.symbol) {
        next.component=ownerOf(next.symbol,next.component);
        next.focus=next.component; // Source readers always retain a parts navigator.
      }
    } else if(next.view==='movement') {
      next.commit=commits.has(candidate.commit)?candidate.commit:null;
    }
    return next;
  }
  function decode(hash) {
    const params=new URLSearchParams(String(hash||'').replace(/^#/,''));
    const candidate={};
    for(const field of Object.keys(allowed))candidate[field]=params.get(field);
    candidate.component=params.get('component');
    candidate.focus=params.get('detail')==='steps'?candidate.component:null;
    candidate.commit=params.get('commit');
    // Support a terse curated function link as well as full source coordinates.
    const component=components.get(candidate.component);
    const curated=component?.functions.find(s=>s.id===params.get('function'));
    const line=params.get('line')||'';
    candidate.symbol=curated||(/^[1-9]\d{0,8}$/.test(line)?resolveSymbol({
      path:params.get('file'), line:Number(line), name:params.get('symbol')
    }):null);
    if(candidate.symbol&&!params.has('tab'))candidate.tab='code';
    if(!params.has('view')&&commits.has(candidate.commit)&&!candidate.symbol)
      candidate.view='movement';
    return normalize(candidate);
  }
  function encode(candidate) {
    const route=normalize(candidate), params=new URLSearchParams();
    if(route.view!=='architecture')params.set('view',route.view);
    if(route.component)params.set('component',route.component);
    if(route.focus)params.set('detail','steps');
    if(route.symbol) {
      params.set('file',route.symbol.path);
      params.set('line',String(route.symbol.line));
      params.set('symbol',route.symbol.name);
    }
    if(route.commit)params.set('commit',route.commit);
    if(route.tab!=='details')params.set('tab',route.tab);
    // Keep non-default experiment preferences across other views, so the route
    // represents the entire meaningful state rather than an accidental merge.
    for(const field of ['measure','deck','precision','hardware','unit'])
      if(route.view==='measurements'||route[field]!==defaults[field])params.set(field,route[field]);
    const query=params.toString();
    return query?'#'+query:'';
  }
  function writeLocation(hash,mode) {
    const url=new URL(env.location.href);
    url.hash=hash;
    if(url.href===env.location.href)return true;
    try {
      env.history[mode==='replace'?'replaceState':'pushState']({genesisExplorer:1},'',url.href);
    } catch(_) {
      // Same-document fragment navigation works in file:// previews where
      // pushState may be unavailable. Never navigate to a user-supplied URL.
      try {
        if(mode==='replace')env.location.replace(url.href);
        else env.location.hash=hash;
      } catch(_) { return false; }
    }
    lastURL=env.location.href; // Suppress our own asynchronous hashchange echo.
    return true;
  }
  function commit({mode='push',focus:moveFocus=false}={}) {
    setState(normalize(getState()));
    render();
    // renderMeasurements currently normalizes unsupported combinations. Record
    // its final visible state, preserving its existing explanatory notices.
    const route=normalize(getState());
    setState(route);
    const hash=encode(route), changed=hash!==lastRoute;
    let written=true;
    if(changed)written=writeLocation(hash,mode);
    lastRoute=hash;
    if(moveFocus)focus(route,{restoring:false});
    return {changed,written};
  }
  function navigate(patch,options={}) {
    const current=getState();
    setState(typeof patch==='function'?patch({...current}):{...current,...patch});
    return commit(options);
  }
  function parentRoute(candidate=getState()) {
    const route=normalize(candidate);
    if(route.view==='architecture') {
      if(route.symbol)return {...route,symbol:null,focus:route.component,
        tab:route.component?'details':'code'};
      if(route.focus)return {...route,focus:null,tab:'details'};
      if(route.component)return {...route,component:null,tab:'details'};
      if(route.tab!=='details')return {...route,tab:'details'};
      return null;
    }
    if(route.view==='movement'&&route.commit)return {...route,commit:null,tab:'details'};
    return {...route,view:'architecture',component:null,focus:null,symbol:null,commit:null,tab:'details'};
  }
  function goUp() {
    const parent=parentRoute();
    if(!parent)return false;
    navigate(parent,{focus:true});
    return true;
  }
  function backLabel() {
    const route=normalize(getState());
    if(route.symbol)return route.component?'Back to component parts':'Back to source index';
    if(route.focus)return 'Back to component on map';
    if(route.view==='movement'&&route.commit)return 'Back to all changes';
    return 'Back to overview';
  }
  function restore() {
    // Traversing a fragment entry can emit BOTH popstate and hashchange.
    if(env.location.href===lastURL)return;
    lastURL=env.location.href;
    setState(decode(env.location.hash));
    render();
    lastRoute=encode(getState());
    focus(getState(),{restoring:true});
  }
  function start() {
    if(started)return;
    started=true;
    setState(decode(env.location.hash));
    render();
    lastRoute=encode(getState());
    lastURL=env.location.href;
    env.addEventListener('popstate',restore);
    env.addEventListener('hashchange',restore);
    if(getState().symbol&&getState().tab==='code')focus(getState(),{restoring:false});
  }
  function dispose() {
    env.removeEventListener('popstate',restore);
    env.removeEventListener('hashchange',restore);
    started=false;
  }
  return {start,dispose,commit,navigate,goUp,backLabel,normalize,decode,encode,
    resolveSymbol,parentRoute,canGoUp:()=>parentRoute()!==null};
}

// Node-only export allows meaningful model/history tests without a browser.
if(typeof module!=='undefined'&&module.exports)module.exports={createExplorerNavigation};

