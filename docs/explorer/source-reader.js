/* Complete, pinned source files. Load only the file the reader opens. */
function createFullSourceReader({index, manifest, esc, onLine, sourceURL}) {
  const files = new Map(index.files.map(file=>[file.path,file]));
  const pending = new Map();
  let activePath=null, activeLine=null, sourceText='', lines=[], filter='';
  let matches=[], matchPosition=-1;
  const $=selector=>document.querySelector(selector);

  function load(path) {
    if(!files.has(path)||!manifest.files[path])return Promise.reject(new Error('Unknown source file'));
    if(typeof window.GENESIS_SOURCE_FILES?.[path]==='string')return Promise.resolve(window.GENESIS_SOURCE_FILES[path]);
    if(pending.has(path))return pending.get(path);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const url=new URL(manifest.files[path].asset,document.baseURI);
      if(url.protocol==='http:'||url.protocol==='https:')url.searchParams.set('v',manifest.files[path].sha256);
      script.src=url.href;
      script.onload=()=>{
        script.remove();
        const text=window.GENESIS_SOURCE_FILES?.[path];
        if(typeof text==='string')resolve(text);else reject(new Error('Source file is unavailable'));
      };
      script.onerror=()=>{script.remove();reject(new Error('Source file could not be loaded'));};
      document.head.append(script);
    });
    pending.set(path,promise);
    promise.catch(()=>pending.delete(path));
    return promise;
  }

  function fileRows(current) {
    const selected=[...files.values()].filter(file=>file.path.toLowerCase().includes(filter.toLowerCase()));
    return selected.length?selected.map(file=>`<button class="source-file-row ${file.path===current?'active':''}" data-open-file="${esc(file.path)}" aria-current="${file.path===current?'true':'false'}"><span>${esc(file.name)}</span><small>${esc(file.language)} · ${file.lines.toLocaleString('en-US')} lines</small></button>`).join(''):'<p class="empty">No matching files.</p>';
  }
  function browserHTML(path) {
    return `<details class="source-browser" ${innerWidth>1100?'open':''}><summary>Browse ${files.size} source files <span aria-hidden="true">⌄</span></summary><div class="source-browser-title"><h2>Source files</h2><p>${files.size} files · src/spdyn</p></div><label class="sr-only" for="source-file-filter">Find a source file</label><input id="source-file-filter" type="search" placeholder="Find a file…" value="${esc(filter)}" autocomplete="off"><nav id="source-file-list" aria-label="Source files">${fileRows(path)}</nav></details>`;
  }
  function moveToLine(line) {
    if(!activePath)return;
    const pane=$('#full-source-scroll'), target=$('#source-L'+line);
    if(!pane||!target)return;
    $('.full-code-line.selected-line')?.classList.remove('selected-line');
    target.classList.add('selected-line');
    const top=target.getBoundingClientRect().top-pane.getBoundingClientRect().top+pane.scrollTop-pane.clientHeight*.3;
    pane.scrollTo({top:Math.max(0,top),behavior:'instant'});
    $('#source-line-input').value=line;
    $('#source-current-line').textContent='Line '+line.toLocaleString('en-US');
    $('.full-source-footer a').href=sourceURL(activePath,line);
  }
  function mount(container,path,line,backLabel) {
    if(activePath===path&&container.querySelector('.file-reader')) {
      $('.file-back').textContent='← '+backLabel;
      if(activeLine!==line){activeLine=line;moveToLine(line);}
      return;
    }
    activePath=path;activeLine=line;sourceText='';lines=[];matches=[];matchPosition=-1;
    const file=files.get(path);
    container.innerHTML=`<section class="file-reader" aria-label="Complete source file"><div class="file-reader-heading"><div><button class="file-back" data-close-file>← ${esc(backLabel)}</button><h2 tabindex="-1">${esc(file.name)}</h2><p>${esc(path)} <span>· ${esc(file.language)} · ${file.lines.toLocaleString('en-US')} lines</span></p></div><button class="button source-download" data-download-source disabled>Download</button></div><div class="file-reader-tools"><div class="file-find"><label class="sr-only" for="source-find-input">Find in this file</label><input id="source-find-input" type="search" placeholder="Find in this file…" autocomplete="off"><button data-find-direction="-1" aria-label="Previous matching line" disabled>↑</button><button data-find-direction="1" aria-label="Next matching line" disabled>↓</button><span id="source-find-status" role="status"></span></div><form id="source-line-form"><label for="source-line-input">Line</label><input id="source-line-input" type="number" min="1" max="${file.lines}" value="${line}" required><button type="submit">Go</button></form><button id="full-source-wrap" data-full-wrap aria-pressed="false">Wrap lines</button></div><div id="full-source-scroll" class="full-source-scroll" tabindex="0" aria-label="${esc(file.name)} full source"><p class="source-loading" role="status">Loading complete source…</p></div><div class="full-source-footer"><span id="source-current-line">Line ${line.toLocaleString('en-US')}</span><span>Complete file · ${manifest.sourceCommit.slice(0,7)}</span><a href="${esc(sourceURL(path,line))}" target="_blank" rel="noreferrer">View on GitHub ↗</a></div></section>`;
    $('#source-find-input').addEventListener('input',find);
    $('#source-find-input').addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();nextMatch(event.shiftKey?-1:1);}
    });
    $('#source-line-form').addEventListener('submit',event=>{event.preventDefault();onLine(Number($('#source-line-input').value));});
    load(path).then(text=>{
      if(activePath!==path||!container.querySelector('.file-reader'))return;
      sourceText=text;
      lines=text.split(/\r\n|\n|\r/);
      if(lines.at(-1)==='')lines.pop();
      const code=lines.map((value,i)=>`<span class="full-code-line" id="source-L${i+1}"><span class="full-line-number" aria-hidden="true">${i+1}</span><span class="full-line-text">${esc(value)||' '}</span></span>`).join('');
      $('#full-source-scroll').innerHTML=`<pre class="full-source-code"><code>${code}</code></pre>`;
      $('[data-download-source]').disabled=false;
      if($('#source-find-input').value)find();else moveToLine(activeLine);
    }).catch(()=>{
      if(activePath!==path||!container.querySelector('.file-reader'))return;
      $('#full-source-scroll').innerHTML='<div class="source-load-error"><h3>This source file could not load.</h3><p>Keep the source-files folder alongside the explorer, or try loading it again.</p><button class="button" data-retry-source>Try again</button></div>';
    });
  }
  function find() {
    const query=$('#source-find-input').value.toLocaleLowerCase();
    document.querySelectorAll('.matching-line').forEach(node=>node.classList.remove('matching-line'));
    matches=query?lines.flatMap((line,i)=>line.toLocaleLowerCase().includes(query)?[i+1]:[]):[];
    matchPosition=matches.length?0:-1;
    for(const line of matches)$('#source-L'+line)?.classList.add('matching-line');
    updateFindStatus();
    if(matches.length)onLine(matches[0],true);
  }
  function updateFindStatus() {
    const query=$('#source-find-input').value;
    $('#source-find-status').textContent=!query?'':matches.length?`${matchPosition+1} / ${matches.length} lines`:'No matches';
    document.querySelectorAll('[data-find-direction]').forEach(button=>{button.disabled=!matches.length;});
  }
  function nextMatch(direction) {
    if(!matches.length)return;
    matchPosition=(matchPosition+direction+matches.length)%matches.length;
    updateFindStatus();onLine(matches[matchPosition],true);
  }
  function click(button) {
    if(button.hasAttribute('data-full-wrap')) {
      const enabled=button.getAttribute('aria-pressed')!=='true';
      button.setAttribute('aria-pressed',enabled);$('#full-source-scroll').classList.toggle('wrap-full-source',enabled);
      moveToLine(activeLine);return true;
    }
    if(button.hasAttribute('data-find-direction')){nextMatch(Number(button.dataset.findDirection));return true;}
    if(button.hasAttribute('data-download-source')) {
      const url=URL.createObjectURL(new Blob([sourceText],{type:'text/plain;charset=utf-8'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=files.get(activePath).name;
      document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
    }
    return false;
  }
  function filterFiles(value) {filter=value;$('#source-file-list').innerHTML=fileRows(activePath);}
  function clear() {activePath=null;activeLine=null;sourceText='';lines=[];}
  return {browserHTML,mount,click,filterFiles,clear};
}
