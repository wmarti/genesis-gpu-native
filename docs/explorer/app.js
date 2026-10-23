/* A static, source-linked explorer. No server, account or build step required. */
(() => {
  'use strict';
  const A = window.GENESIS_ARCHITECTURE;
  const M = window.GENESIS_MEASUREMENTS;
  const I = window.GENESIS_SOURCE_INDEX;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const external = (url, label, cls = '') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noreferrer">${label}</a>`;
  const sourceURL = (path, line, sha = A.sha) => `https://github.com/${A.repository}/blob/${sha}/${path}${line ? '#L' + line : ''}`;
  const byId = id => A.components.find(c => c.id === id);
  const labels = {
    bridge: { title:'Start a simulation', text:'Read the input, check what is supported, and start the native GPU path.', icon:'↳', badge:'Host · Fortran' },
    state: { title:'Keep atoms on the GPU', text:'Hold coordinates, velocities and forces in device memory between outputs.', icon:'▦', badge:'GPU · persistent state' },
    integrator: { title:'Advance the motion', text:'Take the next timestep, apply constraints, and control temperature.', icon:'◷', badge:'GPU · integration' },
    neighbors: { title:'Find nearby atoms', text:'Group atoms into cells and rebuild the list of pairs that can interact.', icon:'⌗', badge:'GPU · neighbor lists' },
    forces: { title:'Calculate local forces', text:'Evaluate nearby interactions, bonds and restraints. Combine the forces.', icon:'ƒ', badge:'GPU · FP64 / Mixed' },
    pme: { title:'Solve long-range forces', text:'Use a charge mesh and Fourier transforms to compute long-range electrostatic forces.', icon:'∿', badge:'GPU · PME / cuFFT' },
    domains: { title:'Share the boundaries', text:'Exchange edge atoms and their forces as work is divided across GPUs.', icon:'⇄', badge:'GPU · domains & halos' },
    transport: { title:'Connect the GPUs', text:'Move data by peer copy or MPI using one shared communication layer.', icon:'⌘', badge:'Peer copy · MPI' }
  };
  const defaults = {bridge:[30,80],state:[30,365],integrator:[340,80],domains:[340,365],neighbors:[650,25],forces:[650,335],pme:[960,80],transport:[960,365]};
  let positions = structuredClone(defaults);
  let state = {view:'architecture', component:null, focus:null, tab:'details', symbol:null, commit:null, measure:'scaling', deck:'tuned', precision:'Mixed', hardware:'b200', unit:'nsPerDay'};
  let camera = {x:0,y:0,scale:1}, drag = null, suppressClick = false, toastTimer, lastNodeClick = {id:null,time:0};
  const titleOf = c => labels[c.id]?.title || c.title;
  const fmt = n => Number(n).toLocaleString('en-US', {maximumFractionDigits:3});
  const row = (name,value) => `<div class="info-row"><span>${esc(name)}</span><strong>${value}</strong></div>`;
  const intro = (eyebrow,title,text) => `<p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>`;
  const selectedComponent = () => byId(state.component);
  function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2300); }
  function syncHash() {
    const p = new URLSearchParams();
    if (state.view !== 'architecture') p.set('view',state.view);
    if (state.component) p.set('component',state.component);
    if (state.focus) p.set('detail','steps');
    if (state.commit) p.set('commit',state.commit);
    if (state.view==='measurements') { p.set('deck',state.deck);p.set('precision',state.precision);p.set('hardware',state.hardware);p.set('measure',state.measure); }
    const h = p.toString();
    try { history.replaceState(null,'',location.pathname+location.search+(h?'#'+h:'')); } catch (_) { /* file previews can restrict history */ }
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (['architecture','movement','measurements'].includes(p.get('view'))) state.view=p.get('view');
    if (byId(p.get('component'))) {state.component=p.get('component');state.view='architecture';}
    if (p.get('detail')==='steps' && state.component) state.focus=state.component;
    if (M.history.some(c=>c.sha===p.get('commit'))) state.commit=p.get('commit');
    for (const key of ['deck','precision','hardware','measure']) {
      const values={deck:['tuned','g92','cellulose'],precision:['Mixed','FP64'],hardware:M.hardware.map(h=>h.id),measure:['scaling','stock','validation']}[key];
      if(values.includes(p.get(key)))state[key]=p.get(key);
    }
  }
  function changeView(view) {
    state.view=view;state.component=null;state.focus=null;state.symbol=null;state.tab='details';
    if(view!=='movement')state.commit=null;
    render();
    if(innerWidth<=1100)window.scrollTo({top:0,behavior:'smooth'});
  }
  function selectComponent(id, drill = false) {
    if (!byId(id)) return;
    state.view='architecture';state.component=id;state.focus=drill?id:null;state.tab='details';state.symbol=null;state.commit=null;
    render();
    if(innerWidth<=1100)$(drill?'#main-panel':'#inspector').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function selectCommit(sha) { state.view='movement';state.commit=sha;state.component=null;state.focus=null;state.symbol=null;state.tab='details';render();if(innerWidth<=1100)$('#inspector').scrollIntoView({behavior:'smooth',block:'start'}); }
  function selectSymbol(symbol, componentId) {
    state.symbol=symbol;state.view='architecture';state.commit=null;state.tab='code';
    state.component=componentId || A.components.find(c=>c.functions.some(f=>f.path===symbol.path && f.line===symbol.line))?.id || null;
    if(state.focus&&state.focus!==state.component)state.focus=null;
    render();
    if(innerWidth<=1100)$('#inspector').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function render() {
    $$('.main-nav button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===state.view));
    $$('.inspector-tabs button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tab===state.tab));
    $('#back').disabled=!state.component && state.view==='architecture' && !state.symbol;
    $('#breadcrumb-detail').textContent=state.component?titleOf(selectedComponent()):state.view==='movement'?'Code movement':state.view==='measurements'?'Measurements':'';
    $('#neighbor-control').hidden=state.view!=='architecture'||!!state.focus;
    $('#context-label').textContent=state.view==='measurements'?'Published release evidence':'GPU-resident SPDYN';
    $('#main-panel').setAttribute('aria-label',state.view==='architecture'?'Architecture explorer':state.view==='movement'?'Code movement history':'Published measurements');
    const graph=state.view==='architecture'&&!state.focus;
    $('#graph-viewport').hidden=!graph;$('#graph-bottom').hidden=!graph;$('#alternate-view').hidden=graph;
    $('#main-panel').classList.toggle('alternate',!graph);
    if(state.view==='architecture') {
      const c=byId(state.focus);
      $('#view-eyebrow').textContent=c?'INSIDE THE COMPONENT':'MOLECULAR DYNAMICS · ON THE GPU';
      $('#view-title').textContent=c?titleOf(c):'A whole simulation. One connected system.';
      $('#view-subtitle').textContent=c?'Each part links to its actual definition. Select one to read the source.':'Follow a step from input to motion. Select a component to see how it works.';
      $('#scope-chip').textContent=c?`${c.functions.length} source definitions`:'8 components';
      if(c)renderSteps(c);else renderGraph();
    } else if(state.view==='movement') {
      $('#view-eyebrow').textContent='THE NATIVE PORT · SOURCE HISTORY';$('#view-title').textContent='The work moved. The science stayed.';
      $('#view-subtitle').textContent='See what changed as the molecular dynamics step became GPU-resident.';$('#scope-chip').textContent='8 commits';renderMovement();
    } else {
      $('#view-eyebrow').textContent='PUBLISHED RESULTS · GPU-RESIDENT-V1';$('#view-title').textContent='Performance you can trace to its source.';
      $('#view-subtitle').textContent='Explore the recorded results. Every number links back to the release evidence.';$('#scope-chip').textContent='October 2026';renderMeasurements();
    }
    renderInspector();renderTimeline();syncHash();
  }
  function renderGraph() {
    $('#nodes').innerHTML=A.components.map(c=>{
      const l=labels[c.id],p=positions[c.id];
      return `<button class="node ${c.category==='host'?'host':''} ${state.component===c.id?'selected':''}" data-node="${c.id}" style="left:${p[0]}px;top:${p[1]}px" aria-pressed="${state.component===c.id}" aria-label="${esc(l.title)}. ${esc(l.text)}"><span class="port"></span><span class="port right"></span><div class="node-main"><div class="node-heading"><span class="node-icon" aria-hidden="true">${l.icon}</span><h3>${esc(l.title)}</h3><span class="node-open" aria-hidden="true">↗</span></div><p>${esc(l.text)}</p></div><div class="node-footer"><span class="badge">• ${esc(l.badge)}</span><span>${c.functions.length} parts</span></div></button>`;
    }).join('');
    updateConnections();
    requestAnimationFrame(()=>{ updateConnections();if(!camera.initialized)fit();else applyCamera(); });
  }
  function updateConnections() {
    const show=$('#neighbors').checked, selected=state.component;
    const connected=new Set([selected]);
    A.edges.forEach(e=>{if(e.source===selected||e.target===selected){connected.add(e.source);connected.add(e.target);}});
    $$('.node').forEach(n=>n.classList.toggle('faded',!!selected&&show&&!connected.has(n.dataset.node)));
    let svg='<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill="#68747b"/></marker><marker id="arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill="var(--accent)"/></marker></defs>';
    if(show) A.edges.forEach((e,i)=>{
      const a=positions[e.source],b=positions[e.target],an=$(`[data-node="${e.source}"]`),bn=$(`[data-node="${e.target}"]`);
      const ah=an?.offsetHeight||185,bh=bn?.offsetHeight||185;
      let x1=a[0]+231,y1=a[1]+ah/2,x2=b[0],y2=b[1]+bh/2, path,lx,ly;
      if(Math.abs(a[0]-b[0])<20){
        const down=b[1]>a[1];x1=a[0]+116;y1=a[1]+(down?ah:0);x2=b[0]+116;y2=b[1]+(down?0:bh);
        path=`M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`;lx=x1+8;ly=(y1+y2)/2;
      }else if(b[0]<a[0]){
        x1=a[0]+90;y1=a[1]+ah;x2=b[0]+145;y2=b[1]+bh;
        const bend=Math.max(y1,y2)+32+(i%3)*10;
        path=`M${x1},${y1} C${x1},${bend} ${x2},${bend} ${x2},${y2}`;lx=(x1+x2)/2;ly=bend-6;
      }else{
        const dx=Math.max(35,(x2-x1)*.45);path=`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`;lx=(x1+x2)/2;ly=(y1+y2)/2-9;
      }
      const active=selected&&(e.source===selected||e.target===selected), faded=selected&&!active;
      svg+=`<path class="edge ${e.kind==='data'?'data':''} ${active?'highlight':''} ${faded?'faded':''}" d="${path}" marker-end="url(#${active?'arrow-active':'arrow'})"/>`;
      if(active)svg+=`<text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">${esc(e.label)}</text>`;
    });
    $('#connections').innerHTML=svg;
  }
  function applyCamera(){ $('#graph-world').style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;$('#zoom-label').textContent=Math.round(camera.scale*100)+'%'; }
  function fit(){
    const el=$('#graph-viewport');if(el.hidden)return;
    const maxX=Math.max(...Object.values(positions).map(p=>p[0]))+245, maxY=Math.max(...A.components.map(c=>positions[c.id][1]+($(`[data-node="${c.id}"]`)?.offsetHeight||190)))+28;
    const minX=Math.min(...Object.values(positions).map(p=>p[0]))-15,minY=Math.min(...Object.values(positions).map(p=>p[1]))-15;
    camera.scale=Math.min((el.clientWidth-32)/(maxX-minX),(el.clientHeight-25)/(maxY-minY),1.15);
    camera.scale=Math.max(.2,camera.scale);camera.x=(el.clientWidth-(maxX-minX)*camera.scale)/2-minX*camera.scale;camera.y=(el.clientHeight-(maxY-minY)*camera.scale)/2-minY*camera.scale;camera.initialized=true;applyCamera();
  }
  function zoom(factor,x,y){const v=$('#graph-viewport');x??=v.clientWidth/2;y??=v.clientHeight/2;const s=Math.max(.2,Math.min(2,camera.scale*factor));const r=s/camera.scale;camera.x=x-(x-camera.x)*r;camera.y=y-(y-camera.y)*r;camera.scale=s;applyCamera();}
  function renderSteps(c){
    $('#alternate-view').innerHTML=`<div class="step-grid">${c.functions.map((f,i)=>`<button class="step-card ${state.symbol?.id===f.id?'active':''}" data-function="${esc(f.id)}" data-component="${c.id}"><span>${String(i+1).padStart(2,'0')} &nbsp; ${esc(f.language)}</span><h3>${esc(f.title)}</h3><p>${esc(f.description)}</p><small>${esc(f.name)} ↗</small></button>`).join('')}</div><p class="graph-caption">Selected responsibilities, grouped for readability. These cards are not a complete execution trace.</p>`;
  }
  function renderTimeline(){
    $('#timeline').innerHTML=M.history.map(c=>`<button title="${esc(c.subject)}" data-commit="${c.sha}" data-short="${c.shortSha.slice(0,5)}" class="${state.commit===c.sha?'active':''}">${esc(c.label)}</button>`).join('');
  }
  function renderMovement(){
    $('#alternate-view').innerHTML=`<div class="movement-intro"><div class="movement-lane"><p class="eyebrow">HOST · FORTRAN</p><h3>Set up. Schedule. Write out.</h3><p>GENESIS owns input, eligibility, scalar control and output boundaries.</p></div><div class="movement-arrow" aria-hidden="true">→</div><div class="movement-lane"><p class="eyebrow">DEVICE · C++ / CUDA</p><h3>Keep the MD step resident.</h3><p>Atoms, pair lists, forces, PME and integration stay on the GPU between outputs.</p></div></div><div class="commit-cards">${M.history.map((c,i)=>`<button class="commit-card ${state.commit===c.sha?'active':''}" data-commit="${c.sha}"><span class="commit-number">${String(i+1).padStart(2,'0')} &nbsp; / &nbsp; ${c.shortSha}</span><h3>${esc(c.label)}</h3><p>${esc(c.subject.replace(/^\[[^\]]+\]\s*/,''))}</p><div class="commit-stats"><span>${c.filesChanged} files changed</span><span class="added">+${fmt(c.additions)}</span><span class="deleted">−${fmt(c.deletions)}</span></div></button>`).join('')}</div><p class="graph-caption">The eight native-port commits on this source branch. Select a change to inspect its files.</p>`;
  }
  function selection(label,id,options,value){return `<label class="select-label">${label}<select id="${id}" aria-label="${label}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;}
  function measureSwitch(){return `<div class="measurement-switch"><button data-measure="scaling" class="${state.measure==='scaling'?'active':''}">GPU scaling</button><button data-measure="stock" class="${state.measure==='stock'?'active':''}">Versus stock</button><button data-measure="validation" class="${state.measure==='validation'?'active':''}">Correctness</button></div>`;}
  function renderMeasurements(){
    let html=measureSwitch();
    if(state.measure==='validation'){
      html+=`<div class="validation-grid">${M.validation.map(v=>`<article class="validation-card"><h3>${esc(v.label)}</h3><strong>${esc(v.id==='mixed-accuracy'?'1.8 × 10⁻⁶ max relative energy deviation':v.headline)}</strong><p>${esc(v.details)}</p>${v.caveat?`<p style="margin-top:10px">${esc(v.caveat)}</p>`:''}${external(v.source.url,'Read the evidence ↗')}</article>`).join('')}</div><div class="callout"><strong>What the release has not established</strong>${M.validationGaps.items.map(x=>`<p style="margin-top:8px">${esc(x)}</p>`).join('')}</div>`;
    }else if(state.measure==='stock'){
      const system=state.deck==='cellulose'?'Cellulose':'STMV';
      const rows=M.stockComparison.rows.filter(r=>r.system===system&&r.precision===state.precision);
      html+=`<div class="metric-controls">${selection('System','metric-system',[['STMV','STMV'],['Cellulose','Cellulose']],system)}${selection('Precision','metric-precision',[['Mixed','Mixed'],['FP64','FP64']],state.precision)}</div>`;
      const best=Math.max(...rows.map(r=>r.speedup));
      html+=`<div class="metric-summary"><strong>${fmt(best)}×</strong><span>peak speedup over stock GENESIS 2.1.6</span></div><p class="chart-description">RTX PRO 6000 Blackwell · same input and GPUs · ${esc(state.precision)}</p>`;
      html+=barChart(rows.map(r=>({label:`${r.gpus} GPU${r.gpus>1?'s':''}`,value:r.speedup,display:fmt(r.speedup)+'×'})),'Speedup versus stock GENESIS (higher is better)','×');
      html+=`<table class="measure-table"><thead><tr><th>GPUs</th><th>Stock · ms/step</th><th>Native · ms/step</th><th>Speedup</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.gpus}</td><td>${fmt(r.stockMsPerStep)}</td><td>${fmt(r.nativeMsPerStep)}</td><td>${external(r.source.url,fmt(r.speedup)+'× ↗')}</td></tr>`).join('')}</tbody></table><p class="chart-footnote">${esc(M.stockComparison.method)} ${esc(M.stockComparison.caveat)}</p>`;
    }else{
      if(state.precision==='FP64'&&state.deck==='tuned')state.deck='g92';
      const available=M.hardware.filter(h=>M.benchmarks.some(r=>r.hardware===h.id&&r.deck===state.deck&&r.precision===state.precision));
      if(!available.some(h=>h.id===state.hardware))state.hardware=available[0]?.id||'blackwell';
      const rows=M.benchmarks.filter(r=>r.deck===state.deck&&r.precision===state.precision&&r.hardware===state.hardware).sort((a,b)=>a.gpus-b.gpus);
      const deckOpts=state.precision==='FP64'?[['g92','STMV · g92'],['cellulose','Cellulose']]:[['tuned','STMV · tuned'],['g92','STMV · g92'],['cellulose','Cellulose']];
      html+=`<div class="metric-controls">${selection('Simulation','metric-deck',deckOpts,state.deck)}${selection('Precision','metric-precision',[['Mixed','Mixed'],['FP64','FP64']],state.precision)}${selection('GPU','metric-hardware',available.map(h=>[h.id,h.label]),state.hardware)}${selection('Measure','metric-unit',[['nsPerDay','Throughput · ns/day'],['msPerStep','Step time · ms']],state.unit)}</div>`;
      const peak=state.unit==='nsPerDay'?Math.max(...rows.map(r=>r[state.unit])):Math.min(...rows.map(r=>r[state.unit]));
      html+=`<div class="metric-summary"><strong>${fmt(peak)}</strong><span>${state.unit==='nsPerDay'?'ns/day · best recorded throughput':'ms/step · best recorded step time'}</span></div><p class="chart-description">${esc(M.hardware.find(h=>h.id===state.hardware)?.fullLabel)} · ${esc(state.precision)} · ${state.unit==='nsPerDay'?'Higher is better':'Lower is better'}</p>`;
      html+=barChart(rows.map(r=>({label:`${r.gpus} GPU${r.gpus>1?'s':''}`,value:r[state.unit],display:fmt(r[state.unit])})),state.unit==='nsPerDay'?'Throughput in nanoseconds per day (higher is better)':'Time in milliseconds per step (lower is better)',state.unit==='nsPerDay'?'ns/day':'ms');
      html+=`<table class="measure-table"><thead><tr><th>GPUs</th><th>Time · ms/step</th><th>Throughput · ns/day</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.gpus}</td><td>${fmt(r.msPerStep)}</td><td>${external(r.source.url,fmt(r.nsPerDay)+' ↗')}</td></tr>`).join('')}</tbody></table><p class="chart-footnote">Recorded release measurements, not a live benchmark. One MPI rank per GPU. Values are transcribed from the published tables.</p>`;
    }
    $('#alternate-view').innerHTML=html;
  }
  function barChart(data,label,unit){
    if(!data.length)return '<p class="empty">This configuration has no published measurements.</p>';
    const max=Math.max(...data.map(d=>d.value))*1.18,w=710,h=260,left=45,bottom=225,top=20,usable=bottom-top;
    let s=`<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`;
    for(let j=0;j<=4;j++){const y=bottom-j*usable/4; s+=`<line class="chart-grid" x1="${left}" y1="${y}" x2="690" y2="${y}"/><text x="${left-12}" y="${y+4}" text-anchor="end">${(max*j/4).toLocaleString('en-US',{maximumFractionDigits:max<2?2:max<20?1:0})}</text>`;}
    data.forEach((d,i)=>{const cx=left+(i+.5)*(645/data.length),bh=d.value/max*usable,y=bottom-bh;s+=`<rect class="chart-bar" x="${cx-43}" y="${y}" width="86" height="${bh}" rx="5"><title>${esc(d.label)}: ${esc(d.display)} ${esc(unit)}</title></rect><text class="chart-value" x="${cx}" y="${y-12}" text-anchor="middle">${esc(d.display)}</text><text x="${cx}" y="250" text-anchor="middle">${esc(d.label)}</text>`;});
    return s+'</svg></div>';
  }
  function renderInspector(){
    let html='';
    if(state.view==='measurements')html=measureInspector();
    else if(state.view==='movement')html=movementInspector();
    else if(state.tab==='code')html=codeInspector();
    else if(state.tab==='evidence')html=evidenceInspector();
    else if(state.component)html=componentInspector(selectedComponent());
    else html=overviewInspector();
    $('#inspector-content').innerHTML=html;$('#inspector-content').scrollTop=0;
  }
  function overviewInspector(){
    return intro('GENESIS · NATIVE SPDYN','A simulation, in context.','Move atoms forward in time, without moving the whole calculation back to the CPU.')+
      '<p>The host prepares the run. The GPU keeps the atoms, calculates their forces, and advances the next step. Multiple GPUs share the work through a common exchange layer.</p>'+
      '<div class="inspector-actions"><button class="button primary" data-select="bridge">Start exploring <span aria-hidden="true">→</span></button><button class="button" data-view="measurements">See the results</button></div>'+
      '<h3>Inside this explorer</h3><div class="info-rows">'+row('Architecture','8 connected responsibilities')+row('Source',`${fmt(I.stats.files)} SPDYN files indexed`)+row('Definitions',`${fmt(I.stats.symbols)} searchable symbols`)+row('The native port','8 individual commits')+'</div>'+
      '<h3>Make the map yours</h3><p>Select any card to understand its role. Explore its parts for a closer look, or open Source to see the code.</p><div class="callout"><strong>A map with a clear scope</strong><p>Connections are curated from the source. They describe responsibilities and selected calls, not a complete execution trace.</p></div>'+external(A.sourceGuide,'Read the native GPU guide ↗','subtle-link');
  }
  function componentInspector(c){
    const l=labels[c.id], edges=A.edges.filter(e=>e.source===c.id||e.target===c.id);
    return intro(l.badge,l.title,c.description)+
      `<div class="inspector-actions"><button class="button primary" data-drill="${c.id}">Explore ${c.functions.length} parts →</button><button class="button" data-tab="code">View source ↗</button></div>`+
      '<h3>What happens here</h3>'+c.details.map((d,i)=>`<div class="detail-item"><span>${String(i+1).padStart(2,'0')}</span><p>${esc(d)}</p></div>`).join('')+
      '<h3>Connected to</h3><div class="component-list">'+[...new Set(edges.map(e=>e.source===c.id?e.target:e.source))].map(id=>`<button class="component-link" data-select="${id}"><span>${esc(labels[id].title)}</span><span>→</span></button>`).join('')+'</div>'+
      `<h3>Source files · ${c.paths.length}</h3>`+c.paths.map(p=>external(sourceURL(p),esc(p.replace('src/spdyn/',''))+' ↗','file-link')).join('');
  }
  function highlightSnippet(snippet,start){
    return snippet.split('\n').map((l,i)=>`<span class="line-number">${start+i}</span>${esc(l).replace(/\b(subroutine|function|end|type|integer|logical|real|double|void|int|float|return|if|else|const|struct|static|extern|call|intent|__global__|__device__)\b/gi,'<span class="code-keyword">$1</span>')}`).join('\n');
  }
  function codeInspector(){
    const c=selectedComponent(),f=state.symbol;
    if(f){
      const curated=A.components.flatMap(c=>c.functions).find(x=>x.path===f.path&&x.line===f.line);
      const actual=curated||f;
      return intro(actual.language||actual.kind||'SOURCE DEFINITION',actual.title||actual.name,actual.description||'An indexed definition in the SPDYN source.')+
        external(sourceURL(actual.path,actual.line),esc(actual.path)+`:${actual.line} ↗`,'file-link')+
        (actual.snippet?`<pre><code>${highlightSnippet(actual.snippet,actual.line)}</code></pre><p class="chart-footnote">Excerpt from ${A.sha.slice(0,7)}. Open GitHub for the complete definition.</p>`:'<div class="callout"><strong>Open the full definition</strong><p>The searchable index records definitions and their exact source locations. Full source is available at the link below.</p></div>')+
        `<div class="inspector-actions">${external(sourceURL(actual.path,actual.line),'Open on GitHub ↗','button primary')}${c?'<button class="button" data-clear-symbol>All component source</button>':''}</div>`;
    }
    if(!c)return intro('SOURCE INDEX','Find your way into the code.',`${fmt(I.stats.symbols)} symbols across ${I.stats.files} SPDYN files. Search by name or path.`)+'<div class="inspector-actions"><button class="button primary" data-search>Search source ⌘ K</button></div><p>The index includes Fortran, C, C++ and CUDA definitions, plus Fortran interface declarations. It is a lexical index, not compiler analysis.</p><h3>Start with a component</h3>'+A.components.map(c=>`<button class="component-link" data-source-component="${c.id}"><span>${esc(titleOf(c))}</span><span>${c.functions.length} ↗</span></button>`).join('');
    return intro('SOURCE · '+A.sha.slice(0,7),titleOf(c),`${c.functions.length} selected definitions. Select one for an excerpt and its exact source location.`)+c.functions.map(f=>`<button class="component-link" data-function="${esc(f.id)}" data-component="${c.id}"><span><strong style="font-weight:500">${esc(f.title)}</strong><small style="display:block;margin-top:6px;color:var(--faint);font-family:monospace;font-size:9px;overflow-wrap:anywhere">${esc(f.name)}</small></span><span>↗</span></button>`).join('');
  }
  function evidenceInspector(){
    const c=selectedComponent();const edges=c?A.edges.filter(e=>e.source===c.id||e.target===c.id):A.edges;
    return intro('SOURCE EVIDENCE',c?'Follow the connections.':'A source-grounded map.',c?'Each relationship below links to the call or data boundary that supports it.':'Eight responsibilities, 48 selected definitions, and 13 hand-curated relationships.')+
      '<p>Solid lines show selected calls. Dashed lines show state or data dependencies. Function and file counts come from a lexical source index.</p><h3>Connection evidence</h3>'+edges.map(e=>`<div class="code-function"><h3>${esc(labels[e.source].title)} → ${esc(labels[e.target].title)}</h3><p>${esc(e.description)}</p>${e.evidence.map(ev=>external(ev.url,`<strong>${esc(e.label)}</strong><span>${esc(ev.path.replace('src/spdyn/',''))}:${ev.line} ↗</span>`,'evidence-link')).join('')}</div>`).join('');
  }
  function movementInspector(){
    const c=M.history.find(c=>c.sha===state.commit);
    if(!c)return intro('FROM THE ACTUAL GIT HISTORY','Eight changes. One native core.','Follow the port from initial fixes through kernels, distributed communication, dispatch and regression coverage.')+'<p>Select a change to see exactly which files moved the implementation forward. Every entry links to the original commit.</p><h3>The boundary matters</h3><p>The host still owns setup, scheduling and output. GPU-resident does not mean host-free: scalar decisions and data exports still have explicit boundaries.</p><div class="callout"><strong>Source snapshot</strong><p>This explorer describes '+A.sha.slice(0,7)+'. Published benchmarks identify their own measured source revision separately.</p></div>'+external(`https://github.com/${A.repository}/compare/${M.repository.baseCommit}...${A.sha}`,'View the complete port diff ↗','button');
    if(state.tab==='evidence')return intro('COMMIT EVIDENCE',c.label,c.subject)+`<div class="info-rows">${row('Revision',c.shortSha)}${row('Date',c.date)}${row('Files changed',c.filesChanged)}${row('Added lines',fmt(c.additions))}${row('Removed lines',fmt(c.deletions))}</div><div class="inspector-actions">${external(c.url,'Open the original diff ↗','button primary')}</div><p>${esc(M.historyNote)}</p>`;
    return intro('CHANGE '+String(M.history.indexOf(c)+1).padStart(2,'0')+' · '+c.shortSha,c.label,c.subject.replace(/^\[[^\]]+\]\s*/,''))+
      `<div class="inspector-actions">${external(c.url,'View commit ↗','button primary')}</div><div class="info-rows">${row('Changed files',c.filesChanged)}${row('Lines',`<span class="added">+${fmt(c.additions)}</span> &nbsp; <span class="deleted">−${fmt(c.deletions)}</span>`)}</div><h3>Files in this change</h3>`+
      c.files.map(f=>external(f.url,`${esc(f.path)}<span><span class="added">+${fmt(f.added)}</span> &nbsp; <span class="deleted">−${fmt(f.deleted)}</span></span>`,'commit-file')).join('');
  }
  function measureInspector(){
    if(state.tab==='code')return intro('RECORDED SOURCE','Read the original results.','The explorer displays release evidence committed to the repository.')+
      external(M.provenance.source.url,'<strong>Release scope and revisions</strong><span>README.md ↗</span>','evidence-link')+
      external(M.provenance.methodSource.url,'<strong>Benchmark setup and methodology</strong><span>README.md ↗</span>','evidence-link')+
      external(sourceURL('doc/examples/gpu-native-b200-stmv-mixed.txt'),'<strong>B200 · raw timing samples</strong><span>Recorded output ↗</span>','evidence-link')+
      external(sourceURL('doc/examples/gpu-native-blackwell-fp64-nve.txt'),'<strong>Blackwell · FP64 NVE output</strong><span>Recorded output ↗</span>','evidence-link');
    if(state.tab==='evidence')return intro('MEASUREMENT PROVENANCE','Known conditions. Clear limits.','Published release results, recorded in October 2026.')+
      '<div class="info-rows">'+row('Release',esc(M.provenance.release))+row('Measured source',esc(M.provenance.measuredSourceRef))+row('Documentation tip',esc(M.provenance.publishedReleaseTip))+'</div><h3>Method</h3><p>'+esc(M.provenance.method)+'</p><h3>Scope and limitations</h3>'+M.provenance.limitations.map(x=>`<div class="detail-item"><span>•</span><p>${esc(x)}</p></div>`).join('')+external(M.provenance.methodSource.url,'Read the measurement method ↗','subtle-link');
    if(state.measure==='validation')return intro('CORRECTNESS','Fast needs to be faithful.','The release reports regression, repeatability and physical checks with distinct scopes.')+'<p>FP64 repeatability is assessed at a fixed rank count. A passing regression suite also includes standard-path fallbacks; it does not mean every input ran on the native GPU core.</p><div class="callout"><strong>Recorded, not re-run</strong><p>These cards describe the published validation record. Building this explorer did not run a new GPU qualification.</p></div>'+external(M.validationGaps.source.url,'Read the qualification gaps ↗','button');
    if(state.measure==='stock')return intro('SAME INPUTS · SAME GPUS','A direct stock comparison.','The native core is compared with the upstream GENESIS 2.1.6 GPU build on RTX PRO 6000 Blackwell.')+'<p>'+esc(M.stockComparison.method)+'</p><div class="callout"><strong>Compare within this experiment</strong><p>'+esc(M.stockComparison.caveat)+'</p></div>'+external(M.stockComparison.source.url,'Open the benchmark table ↗','button primary');
    const hw=M.hardware.find(h=>h.id===state.hardware),deck=M.decks.find(d=>d.id===state.deck),system=M.systems.find(s=>s.id===(state.deck==='cellulose'?'Cellulose':'STMV'));
    return intro('GPU SCALING',system.label,'More GPUs share the same simulation. Compare one, two and four devices under the documented setup.')+
      '<div class="info-rows">'+row('Atoms',fmt(system.atoms))+row('Timestep',system.timestepFs+' fs')+row('Ensemble',esc(system.ensemble))+row('GPU',esc(hw.fullLabel))+row('Interconnect',esc(hw.transport))+row('Precision',esc(state.precision))+'</div><h3>The simulation setup</h3><p>'+esc(deck.details)+'</p><div class="callout"><strong>Read the units</strong><p>ns/day is simulated time per wall-clock day. ms/step is time spent on one integration step. Different timesteps mean different work per simulated nanosecond.</p></div>'+external(deck.source.url,'Read the test conditions ↗','subtle-link');
  }
  function openSearch(){ $('#search-dialog').showModal();$('#search-input').value='';renderSearch('');$('#search-input').focus(); }
  let searchItems=[];
  function renderSearch(query){
    const q=query.trim().toLowerCase();searchItems=[];
    const components=A.components.filter(c=>!q||[titleOf(c),c.title,c.description,c.id].join(' ').toLowerCase().includes(q)).map(c=>({type:'component',component:c}));
    const symbols=q?I.symbols.filter(s=>s.name.toLowerCase().includes(q)||s.path.toLowerCase().includes(q)).sort((a,b)=>(a.name.toLowerCase()===q?-1:0)-(b.name.toLowerCase()===q?-1:0)).slice(0,70).map(s=>({type:'symbol',symbol:s})):[];
    searchItems=[...components,...symbols].slice(0,70);
    $('#search-caption').textContent=q?`${searchItems.length}${symbols.length===70?'+':''} matches · search the name or file path`:'Start with a component, or search the SPDYN source.';
    $('#search-results').innerHTML=searchItems.length?searchItems.map((r,i)=>r.type==='component'?`<button class="search-result" data-result="${i}"><span><strong>${esc(titleOf(r.component))}</strong><small>${esc(r.component.description)}</small></span><span>Component →</span></button>`:`<button class="search-result" data-result="${i}"><span><strong>${esc(r.symbol.name)}</strong><small>${esc(r.symbol.path)}:${r.symbol.line}</small></span><span>${esc(r.symbol.kind)} ↗</span></button>`).join(''):'<p class="empty">No matches. Try “PME”, “gpu_core”, or a source filename.</p>';
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.node){if(!suppressClick)selectComponent(b.dataset.node);return;}
    if(b.dataset.view){changeView(b.dataset.view);return;}
    if(b.dataset.select){selectComponent(b.dataset.select);return;}
    if(b.dataset.drill){selectComponent(b.dataset.drill,true);return;}
    if(b.dataset.tab){state.tab=b.dataset.tab;$$('.inspector-tabs button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.tab===state.tab));renderInspector();return;}
    if(b.dataset.commit){selectCommit(b.dataset.commit);return;}
    if(b.dataset.function){const c=byId(b.dataset.component),f=c.functions.find(f=>f.id===b.dataset.function);selectSymbol(f,c.id);return;}
    if(b.dataset.sourceComponent){selectComponent(b.dataset.sourceComponent);state.tab='code';render();return;}
    if(b.hasAttribute('data-clear-symbol')){state.symbol=null;renderInspector();return;}
    if(b.hasAttribute('data-search')){openSearch();return;}
    if(b.dataset.measure){state.measure=b.dataset.measure;state.tab='details';render();return;}
    if(b.hasAttribute('data-result')){const r=searchItems[Number(b.dataset.result)];$('#search-dialog').close();if(r.type==='component')selectComponent(r.component.id);else selectSymbol(r.symbol);return;}
  });
  $('#home').onclick=$('#overview').onclick=()=>changeView('architecture');
  $('#back').onclick=()=>{if(state.focus){state.focus=null;state.symbol=null;state.tab='details';render();}else changeView('architecture');};
  $('#history-open').onclick=()=>changeView('movement');
  $('#neighbors').onchange=updateConnections;
  $('#zoom-in').onclick=()=>zoom(1.2);$('#zoom-out').onclick=()=>zoom(1/1.2);$('#fit').onclick=fit;
  $('#arrange').onclick=()=>{positions=structuredClone(defaults);renderGraph();requestAnimationFrame(fit);toast('Original layout restored');};
  $('#search-open').onclick=openSearch;$('#search-input').oninput=e=>renderSearch(e.target.value);
  $('#search-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#search-results button')?.click();}});
  $('#search-dialog form').addEventListener('submit',e=>{if(e.submitter)return;e.preventDefault();$('#search-results button')?.click();});
  $('#search-dialog').addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=$$('.search-result');const i=buttons.indexOf(document.activeElement);const n=e.key==='ArrowDown'?Math.min(i+1,buttons.length-1):Math.max(i-1,0);buttons[n]?.focus();}});
  $('#help-open').onclick=()=>$('#help-dialog').showModal();
  $$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  function setTheme(light){document.body.classList.toggle('light',light);$('#theme').setAttribute('aria-label',light?'Switch to dark appearance':'Switch to light appearance');try{localStorage.setItem('genesis-appearance',light?'light':'dark');}catch(_){} }
  try{setTheme(localStorage.getItem('genesis-appearance')==='light');}catch(_){}
  $('#theme').onclick=()=>setTheme(!document.body.classList.contains('light'));
  $('#alternate-view').addEventListener('change',e=>{
    const ids={'metric-deck':'deck','metric-hardware':'hardware','metric-precision':'precision','metric-unit':'unit'};
    if(ids[e.target.id]){state[ids[e.target.id]]=e.target.value;render();}
    if(e.target.id==='metric-system'){state.deck=e.target.value==='Cellulose'?'cellulose':'tuned';render();}
  });
  const viewport=$('#graph-viewport');
  viewport.addEventListener('pointerdown',e=>{
    if(e.button!==0||innerWidth<=1100)return;const n=e.target.closest('[data-node]');
    drag={id:e.pointerId,node:n?.dataset.node,startX:e.clientX,startY:e.clientY,origin:n?[...positions[n.dataset.node]]:[camera.x,camera.y],moved:false};
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;
    if(!drag.moved)return;
    if(drag.node){positions[drag.node]=[drag.origin[0]+dx/camera.scale,drag.origin[1]+dy/camera.scale];const n=$(`[data-node="${drag.node}"]`);n.style.left=positions[drag.node][0]+'px';n.style.top=positions[drag.node][1]+'px';updateConnections();}
    else{camera.x=drag.origin[0]+dx;camera.y=drag.origin[1]+dy;applyCamera();}
  });
  function endDrag(e){if(!drag)return;const d=drag;drag=null;suppressClick=d.moved;if(!d.moved&&d.node){const now=performance.now();const double=lastNodeClick.id===d.node&&now-lastNodeClick.time<400;lastNodeClick={id:d.node,time:now};selectComponent(d.node,double);suppressClick=true;}if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);setTimeout(()=>suppressClick=false,0);}
  viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',()=>{drag=null;});
  viewport.addEventListener('wheel',e=>{if(innerWidth<=1100)return;e.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0012),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  viewport.addEventListener('dblclick',e=>{const n=e.target.closest('[data-node]');if(n)selectComponent(n.dataset.node,true);});
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!$('#search-dialog').open)openSearch();return;}
    if(e.key==='Escape'&&!$('dialog[open]')){if(state.focus){state.focus=null;state.symbol=null;state.tab='details';render();}else if(state.component||state.symbol)changeView('architecture');}
    if(e.target.matches('input,select,textarea'))return;
    if(state.view==='architecture'&&!state.focus&&!$('dialog[open]')){if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(1/1.2);if(e.key.toLowerCase()==='f')fit();}
  });
  $('#revision').textContent=A.sha.slice(0,7);$('#revision').href=`https://github.com/${A.repository}/commit/${A.sha}`;$('#revision').title='Inspected source revision';
  new ResizeObserver(()=>{if(!viewport.hidden)fit();}).observe(viewport);
  readHash();render();
})();
