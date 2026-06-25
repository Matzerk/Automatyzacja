// ═══════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — logika aplikacji (backend PHP + MySQL na kei.pl)
//  Zapis: REST do api/api.php. Synchronizacja: odświeżanie co kilka s.
//  Role: 'supervisor' (nadzorca) tworzy/edytuje, 'worker' oznacza postęp.
//  Ścieżki WZGLĘDNE — działa też w podkatalogu (np. /gilotynka/).
// ═══════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ─── Klient API ────────────────────────────────────────────────
const API = 'api/api.php';
async function api(action, data, method) {
  const opts = { method: method || (data ? 'POST' : 'GET'), headers: {} };
  if (data) {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-Requested-With'] = 'gilotynka';   // anty-CSRF
    opts.body = JSON.stringify(data);
  }
  const res = await fetch(API + '?action=' + action, opts);
  let j = {};
  try { j = await res.json(); } catch {}
  if (!res.ok) throw new Error(j.error || ('Błąd ' + res.status));
  return j;
}

// ─── Stan aplikacji ────────────────────────────────────────────
const STATE = {
  tasks: [],         // [{id,name,t,p,note,status,createdBy,completedBy,completedDate}]
  profiles: {},      // id -> {name, role}
  me: null,          // {id, email, name, role}
  role: 'worker',
  cur: 'a',
};
let _poll = null;

// ═══ THEME ═══ (wygląd może zostać lokalnie)
let theme = (() => { try { return localStorage.getItem('gilo_th') || 'dark'; } catch { return 'dark'; } })();
(() => { document.documentElement.setAttribute('data-theme', theme); const b = $('thBtn'); if (b) b.textContent = theme === 'dark' ? '🌙' : '☀️'; })();
function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  $('thBtn').textContent = theme === 'dark' ? '🌙' : '☀️';
  try { localStorage.setItem('gilo_th', theme); } catch {}
}

// ═══ STATUS BAR ═══
function gsStatus(msg) {
  const el = $('gs-status'); if (!el) return;
  el.textContent = msg;
  el.style.color = msg.startsWith('✓') ? 'var(--ok)' : msg.startsWith('⏳') ? 'var(--ac)' : 'var(--wn)';
  if (msg.startsWith('✓')) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2500);
}

// ═══ HELPERS (wygląd) ═══
const DPL = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
const MPL = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
function fmtDate(s){const d=s?new Date(s+'T12:00:00'):new Date();return`${DPL[d.getDay()]}, ${d.getDate()} ${MPL[d.getMonth()]} ${d.getFullYear()}`;}
function psort(a,b){
  const pa=a.t==='dc'?-1:(a.p==='dc'?0:+a.p||99);
  const pb=b.t==='dc'?-1:(b.p==='dc'?0:+b.p||99);
  return pa-pb;
}
function dotC(p){return p==='dc'?'var(--ac)':p==1?'var(--ok)':p==2?'var(--bl)':'var(--mu)';}
function tBadge(t){
  if(t==='dc') return'<span class="b b-dc">✅ codzienne</span>';
  if(t==='cyc') return'<span class="b b-cy">🔄 cykliczne</span>';
  return'<span class="b b-on">jednorazowe</span>';
}
function pBadge(p){
  if(p==='dc') return'<span class="b b-dc">codzienne</span>';
  if(p==1) return'<span class="b b-p1">prio 1</span>';
  if(p==2) return'<span class="b b-p2">prio 2</span>';
  return'<span class="b b-p3">prio '+esc(p)+'</span>';
}
function stBadge(st){
  if(st==='oczekiwanie') return'<span class="b st-wait">⏳ oczekiwanie</span>';
  if(st==='w_realizacji') return'<span class="b st-prog">🔄 w realizacji</span>';
  if(st==='nie_potrzeby') return'<span class="b st-wait">⊘ pominięte</span>';
  return'<span class="b st-done">✓ ukończone</span>';
}
function hueOf(id){let h=0;const s=String(id||'');for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
function nameOf(id){const p=STATE.profiles[id];return p?p.name:'?';}
function initialOf(id){const n=nameOf(id);return (n[0]||'?').toUpperCase();}
function whoBadge(id){
  if(!id) return'';
  const hue=hueOf(id);
  return`<span title="${esc(nameOf(id))}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;color:#fff;background:hsl(${hue} 45% 45%)">${esc(initialOf(id))}</span>`;
}

// ═══ BADGES ═══
function updateBadges(){
  const inM=STATE.tasks.filter(t=>t.status==='w_realizacji').length;
  const doneAll=STATE.tasks.filter(t=>t.status==='ukonczone').length;
  const bm=$('badge-m');if(bm){bm.textContent=inM;bm.classList.toggle('h',inM===0);}
  const bu=$('badge-u');if(bu){bu.textContent=doneAll;bu.classList.toggle('h',doneAll===0);}
}

const isSup = () => STATE.role==='supervisor';

// ═══ ROUTING ═══
function go(r){
  if(!isSup() && (r==='a'||r==='k')) r='m';   // wykonawca: brak Zadań i Kont
  STATE.cur=r;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  $('v-'+r).classList.add('on');
  ['m','a','u','k'].forEach(x=>{const t=$('tab-'+x);if(t)t.classList.toggle('on',x===r);});
  renderCur();
}
function renderCur(){
  if(STATE.cur==='m') renderM();
  else if(STATE.cur==='a') renderA();
  else if(STATE.cur==='u') renderU();
  else if(STATE.cur==='k') loadUsers().then(()=>{ if(STATE.cur==='k') renderK(); });
  updateBadges();
}

// ═══ TAB 1: MOJE ZADANIA ═══
function renderM(){
  const mine=STATE.tasks.filter(t=>t.status==='w_realizacji'||t.status==='nie_potrzeby'||(t.status==='ukonczone'&&t.t==='dc')).sort(psort);
  const active=mine.filter(t=>t.status==='w_realizacji').length;
  $('m-count').textContent=active;

  if(!mine.length){
    $('m-list').innerHTML=`<div class="empty"><div class="ei">🪓</div>Brak zadań na dziś.<br><span style="font-size:11px;color:var(--bd2)">${isSup()?'Idź do <strong style="color:var(--ac)">Zadania</strong> i kliknij <strong style="color:var(--bl)">▶ Przypisz</strong>.':'Nadzorca przypisze Ci zadania.'}</span></div>`;
    return;
  }
  $('m-list').innerHTML=mine.map(t=>{
    const isDone=t.status==='ukonczone';
    const isSkip=t.status==='nie_potrzeby';
    const isDimmed=isDone||isSkip;
    return`<div class="task-card${isDimmed?' done-card-dc':''}" style="padding:5px 10px;flex-wrap:nowrap;gap:8px">
      <div class="dot" style="background:${dotC(t.p)};flex-shrink:0"></div>
      <div class="task-card-name" style="flex:1;${isDimmed?'text-decoration:line-through;color:var(--mu)':''}">${esc(t.name)}</div>
      ${tBadge(t.t)}
      ${isSkip?'<span class="b" style="border-color:var(--mu);color:var(--mu);white-space:nowrap">⊘ pominięte</span>':''}
      <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
        ${isDimmed
          ?`<button class="btn sm" onclick="setStatus(${t.id},'${t.t==='dc'?'w_realizacji':'oczekiwanie'}')">↩</button>`
          :`<button class="btn ok" style="padding:3px 9px;font-size:10px;white-space:nowrap" onclick="setStatus(${t.id},'ukonczone')">✓ Ukończono</button>
            ${t.t==='dc'?`<button class="btn sm" onclick="setStatus(${t.id},'nie_potrzeby')" style="border-color:var(--mu);color:var(--mu);white-space:nowrap" title="Nie ma potrzeby">⊘</button>`:''}`}
        ${isSup()?`<button class="ibtn e" onclick="openEd(${t.id})" title="Edytuj">✏️</button>
        <button class="ibtn" onclick="delTask(${t.id})" title="Usuń">🗑️</button>`:''}
      </div>
    </div>`;
  }).join('');
}

// ═══ TAB 2: ZADANIA (tylko nadzorca) ═══
const NW={p:1,t:'once'};
function nwSeg(type,btn){
  const segId='a-nw-'+type+'-seg';
  document.querySelectorAll('#'+segId+' .sbtn').forEach(b=>b.className='sbtn');
  btn.classList.add('on');
  if(type==='p') NW.p=parseInt(btn.dataset.v);
  else if(type==='t') NW.t=btn.dataset.v;
}
function toggleForm(){
  const wrap=$('add-form-wrap'),btn=$('form-toggle-btn'),hint=$('form-toggle-hint');
  const open=wrap.classList.contains('h');
  wrap.classList.toggle('h',!open);
  if(open){btn.textContent='▲ Zwiń formularz';btn.className='btn wn';if(hint)hint.textContent='';setTimeout(()=>$('a-nw-n')&&$('a-nw-n').focus(),50);}
  else{btn.textContent='＋ Dodaj zlecenie';btn.className='btn ok';if(hint)hint.textContent='kliknij aby rozwinąć formularz';}
}
function clearForm(){$('a-nw-n').value='';$('a-nw-note').value='';}

async function addTask(){
  const name=$('a-nw-n').value.trim();
  if(!name){alert('Wpisz nazwę zadania!');return;}
  gsStatus('⏳ Zapisuję...');
  try{
    await api('task_create',{name,type:NW.t,priority:NW.p,note:$('a-nw-note').value.trim()});
    gsStatus('✓ Dodano');
    clearForm();
    const wrap=$('add-form-wrap'); if(wrap&&!wrap.classList.contains('h')) toggleForm();
    await reload();
  }catch(e){gsStatus('⚠ '+e.message);}
}

async function setStatus(id,status){
  gsStatus('⏳ Zapisuję...');
  try{ await api('task_status',{id,status}); gsStatus('✓ Zapisano'); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}
function assignTask(id){
  const t=STATE.tasks.find(x=>x.id===id);
  if(!t||t.status==='ukonczone') return;
  setStatus(id, t.status==='w_realizacji'?'oczekiwanie':'w_realizacji');
}

let cmodCb=null;
function showConfirm(msg,cb){$('cmod-msg').innerHTML=msg;cmodCb=cb;$('cmod').classList.remove('h');}
function delTask(id){
  const t=STATE.tasks.find(x=>x.id===id);
  if(!t) return;
  showConfirm(`Usunąć zlecenie:<br><strong>${esc(t.name)}</strong>?`,async()=>{
    gsStatus('⏳ Usuwam...');
    try{ await api('task_delete',{id}); gsStatus('✓ Usunięto'); await reload(); }
    catch(e){gsStatus('⚠ '+e.message);}
  });
}

let edId=null;
function openEd(id){
  edId=id;
  const t=STATE.tasks.find(x=>x.id===id);
  if(!t) return;
  $('ed-n').value=t.name;
  $('ed-p').value=t.p==='dc'?'1':String(t.p);
  $('ed-t').value=t.t;
  const sups=Object.entries(STATE.profiles).filter(([,p])=>p.role==='supervisor');
  $('ed-who').innerHTML=sups.map(([id,p])=>`<option value="${id}">${esc(p.name)}</option>`).join('')||`<option value="${STATE.me.id}">${esc(nameOf(STATE.me.id))}</option>`;
  $('ed-who').value=t.createdBy||STATE.me.id;
  $('ed-note').value=t.note||'';
  $('emod').classList.remove('h');
}
function closeEd(){edId=null;$('emod').classList.add('h');}
async function saveEd(){
  if(!edId) return;
  const t=STATE.tasks.find(x=>x.id===edId);
  if(!t){closeEd();return;}
  const newT=$('ed-t').value;
  gsStatus('⏳ Zapisuję...');
  try{
    await api('task_update',{
      id:edId,
      name:$('ed-n').value.trim()||t.name,
      type:newT,
      priority:parseInt($('ed-p').value)||1,
      created_by:parseInt($('ed-who').value)||null,
      note:$('ed-note').value.trim(),
    });
    gsStatus('✓ Zapisano');
    closeEd();
    await reload();
  }catch(e){gsStatus('⚠ '+e.message);}
}

let aState={sort:'prio',sortDir:1,fType:'all',fPrio:'all'};
function renderA(){
  const all=[...STATE.tasks];
  const stats=[
    {lbl:'Wszystkich',val:all.length,col:'var(--ac)'},
    {lbl:'Oczekiwanie',val:all.filter(t=>t.status==='oczekiwanie').length,col:'var(--mu)'},
    {lbl:'W realizacji',val:all.filter(t=>t.status==='w_realizacji').length,col:'var(--bl)'},
    {lbl:'Ukończone',val:all.filter(t=>t.status==='ukonczone').length,col:'var(--ok)'},
    {lbl:'Codzienne',val:all.filter(t=>t.t==='dc').length,col:'var(--ac)'},
  ];
  $('a-stats').innerHTML=stats.map(s=>`
    <div style="background:var(--bg2);border:1px solid var(--bd);border-radius:7px;padding:10px 12px;text-align:center">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--mu);margin-bottom:4px">${s.lbl}</div>
      <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:20px;color:${s.col}">${s.val}</div>
    </div>`).join('');

  let filtered=[...all];
  if(aState.fType!=='all') filtered=filtered.filter(t=>t.t===aState.fType);
  if(aState.fPrio!=='all') filtered=filtered.filter(t=>String(t.p)===String(aState.fPrio));

  const typeOrder={dc:0,once:1,cyc:2};
  const stOrder={w_realizacji:0,oczekiwanie:1,nie_potrzeby:2,ukonczone:3};
  filtered.sort((a,b)=>{
    let v=0;
    if(aState.sort==='prio') v=(a.p==='dc'?0:+a.p||99)-(b.p==='dc'?0:+b.p||99);
    else if(aState.sort==='type') v=(typeOrder[a.t]||9)-(typeOrder[b.t]||9);
    else if(aState.sort==='name') v=a.name.localeCompare(b.name,'pl');
    else if(aState.sort==='who') v=nameOf(a.createdBy).localeCompare(nameOf(b.createdBy),'pl');
    else if(aState.sort==='status') v=(stOrder[a.status]||0)-(stOrder[b.status]||0);
    return v*aState.sortDir;
  });

  $('a-total').textContent=filtered.length;
  $('a-body').innerHTML=filtered.length?filtered.map(t=>{
    const isDone=t.status==='ukonczone';
    const isInProg=t.status==='w_realizacji';
    return`<tr style="${isDone?'opacity:.5':''}">
      <td><div class="dot" style="background:${dotC(t.p)};margin:0 auto"></div></td>
      <td style="max-width:250px">
        <div style="font-size:12px;${isDone?'text-decoration:line-through;color:var(--mu)':''}">${esc(t.name)}</div>
        ${t.note?`<div style="font-size:10px;color:var(--mu);margin-top:1px">${esc(t.note)}</div>`:''}
        ${isDone&&t.completedDate?`<div style="font-size:10px;color:var(--ok);margin-top:1px">ukończono: ${esc(t.completedDate)}${t.completedBy?' · '+esc(nameOf(t.completedBy)):''}</div>`:''}
      </td>
      <td>${tBadge(t.t)}</td>
      <td>${pBadge(t.p)}</td>
      <td style="text-align:center">${whoBadge(t.createdBy)}</td>
      <td>${stBadge(t.status)}</td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end;align-items:center;flex-wrap:wrap">
          ${t.status==='oczekiwanie'?`<button class="btn sm bl" onclick="assignTask(${t.id})">▶ Przypisz</button>`:''}
          ${isInProg?`<button class="btn sm" onclick="assignTask(${t.id})" style="border-color:rgba(91,155,212,.5);color:var(--bl);background:rgba(91,155,212,.08)">🔄 w realizacji ×</button>`:''}
          ${isDone?`<button class="btn sm" onclick="setStatus(${t.id},'${t.t==='dc'?'w_realizacji':'oczekiwanie'}')">↩ Przywróć</button>`:''}
          <button class="ibtn e" onclick="openEd(${t.id})" title="Edytuj">✏️</button>
          <button class="ibtn" onclick="delTask(${t.id})" title="Usuń">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join(''):`<tr><td colspan="7" class="empty" style="padding:20px">Brak zadań spełniających kryteria</td></tr>`;
}
function aSort(btn){
  const v=btn.dataset.v;
  if(aState.sort===v) aState.sortDir*=-1; else{aState.sort=v;aState.sortDir=1;}
  document.querySelectorAll('#a-sort-seg .sbtn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  ['name','type','prio','who','status'].forEach(c=>{const el=$('a-col-'+c);if(el)el.textContent=aState.sort===c?(aState.sortDir===1?'↑':'↓'):'↕';});
  renderA();
}
function aColSort(col){
  if(aState.sort===col) aState.sortDir*=-1; else{aState.sort=col;aState.sortDir=1;}
  document.querySelectorAll('#a-sort-seg .sbtn').forEach(b=>b.classList.toggle('on',b.dataset.v===col));
  ['name','type','prio','who','status'].forEach(c=>{const el=$('a-col-'+c);if(el)el.textContent=aState.sort===c?(aState.sortDir===1?'↑':'↓'):'↕';});
  renderA();
}
function aFilter(kind,btn){
  const segId='a-f'+kind+'-seg';
  document.querySelectorAll('#'+segId+' .sbtn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  if(kind==='type') aState.fType=btn.dataset.v;
  else if(kind==='prio') aState.fPrio=btn.dataset.v;
  renderA();
}

// ═══ TAB 3: UKOŃCZONO ═══
const uActive={};
function buildUFilter(){
  const sups=Object.entries(STATE.profiles).filter(([,p])=>p.role==='supervisor');
  sups.forEach(([id])=>{ if(uActive[id]===undefined) uActive[id]=true; });
  $('u-filter').innerHTML=sups.map(([id,p])=>
    `<button class="sbtn${uActive[id]?' on':''}" id="uf-${id}" onclick="uFilter('${id}')">${esc(p.name)}</button>`).join('');
}
function uFilter(id){
  uActive[id]=!uActive[id];
  const b=$('uf-'+id);if(b)b.classList.toggle('on',uActive[id]);
  renderU();
}
function renderU(){
  buildUFilter();
  const activeWho=Object.entries(uActive).filter(([,v])=>v).map(([k])=>+k);
  const done=STATE.tasks
    .filter(t=>t.status==='ukonczone'&&(!t.createdBy||activeWho.includes(t.createdBy)))
    .sort((a,b)=>(b.completedDate||'').localeCompare(a.completedDate||''));
  $('u-count').textContent=STATE.tasks.filter(t=>t.status==='ukonczone').length;

  if(!done.length){
    $('u-list').innerHTML=`<div class="empty"><div class="ei">✅</div>Brak ukończonych dla wybranych filtrów.</div>`;
    return;
  }
  const byDate={};
  done.forEach(t=>{const d=t.completedDate||'brak';if(!byDate[d])byDate[d]=[];byDate[d].push(t);});
  $('u-list').innerHTML=Object.entries(byDate).map(([date,items])=>`
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--ac);letter-spacing:1px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd)">${fmtDate(date==='brak'?null:date)}</div>
      ${items.map(t=>`
        <div class="done-entry">
          <div class="dot" style="background:${dotC(t.p)};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:12px">${esc(t.name)}</div>
            ${t.note?`<div style="font-size:10px;color:var(--mu);margin-top:1px">${esc(t.note)}</div>`:''}
            <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;align-items:center">${tBadge(t.t)}${pBadge(t.p)}${whoBadge(t.createdBy)}${t.completedBy?`<span style="font-size:9px;color:var(--mu)">wyk.: ${esc(nameOf(t.completedBy))}</span>`:''}</div>
          </div>
          <div style="display:flex;gap:5px;align-items:center">
            <button class="btn sm" onclick="setStatus(${t.id},'${t.t==='dc'?'w_realizacji':'oczekiwanie'}')">↩ Przywróć</button>
            ${isSup()?`<button class="ibtn e" onclick="openEd(${t.id})" title="Edytuj">✏️</button>
            <button class="ibtn" onclick="delTask(${t.id})" title="Usuń">🗑️</button>`:''}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

// ═══ TAB 4: KONTA (tylko nadzorca) ═══
function toggleUserForm(){
  const w=$('k-form-wrap'),b=$('uf-toggle');
  const open=w.classList.contains('h');
  w.classList.toggle('h',!open);
  b.textContent=open?'▲ Zwiń':'＋ Dodaj konto';
  b.className=open?'btn wn':'btn ok';
}
async function addUser(){
  const email=$('k-email').value.trim();
  const pass=$('k-pass').value;
  if(!email||pass.length<6){alert('Podaj e-mail i hasło (min. 6 znaków).');return;}
  gsStatus('⏳ Tworzę konto...');
  try{
    await api('user_create',{email,name:$('k-name').value.trim(),role:$('k-role').value,password:pass});
    gsStatus('✓ Utworzono');
    $('k-email').value='';$('k-name').value='';$('k-pass').value='';
    toggleUserForm();
    await loadUsers(); renderK();
  }catch(e){gsStatus('⚠ '+e.message);}
}
async function toggleRole(id,role){
  const next=role==='supervisor'?'worker':'supervisor';
  gsStatus('⏳ Zapisuję...');
  try{ await api('user_update',{id,role:next}); gsStatus('✓ Zapisano'); await loadUsers(); renderK(); }
  catch(e){gsStatus('⚠ '+e.message);}
}
async function resetPass(id){
  const p=prompt('Nowe hasło (min. 6 znaków):');
  if(p===null) return;
  if(p.length<6){alert('Za krótkie hasło.');return;}
  gsStatus('⏳ Zapisuję...');
  try{ await api('user_update',{id,password:p}); gsStatus('✓ Zmieniono hasło'); }
  catch(e){gsStatus('⚠ '+e.message);}
}
function delUser(id){
  showConfirm(`Usunąć konto:<br><strong>${esc(nameOf(id))}</strong>?`,async()=>{
    gsStatus('⏳ Usuwam...');
    try{ await api('user_delete',{id}); gsStatus('✓ Usunięto'); await loadUsers(); renderK(); }
    catch(e){gsStatus('⚠ '+e.message);}
  });
}
function renderK(){
  const users=Object.entries(STATE.profiles).map(([id,p])=>({id:+id,...p}))
    .sort((a,b)=>a.role.localeCompare(b.role)||a.name.localeCompare(b.name,'pl'));
  $('k-body').innerHTML=users.map(u=>`
    <tr>
      <td style="display:flex;align-items:center;gap:8px">${whoBadge(u.id)}<span style="font-size:12px">${esc(u.name)}</span>${u.id===STATE.me.id?'<span style="font-size:9px;color:var(--mu)">(Ty)</span>':''}</td>
      <td style="font-size:11px;color:var(--mu)">${esc(u.email||'')}</td>
      <td><span class="b ${u.role==='supervisor'?'b-dc':'b-cy'}">${u.role==='supervisor'?'nadzorca':'wykonawca'}</span></td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn sm" onclick="toggleRole(${u.id},'${u.role}')">${u.role==='supervisor'?'→ wykonawca':'→ nadzorca'}</button>
          <button class="btn sm" onclick="resetPass(${u.id})">🔑 hasło</button>
          ${u.id!==STATE.me.id?`<button class="ibtn" onclick="delUser(${u.id})" title="Usuń">🗑️</button>`:''}
        </div>
      </td>
    </tr>`).join('');
}

// ═══ ŁADOWANIE DANYCH ═══
function setProfiles(users){
  STATE.profiles={};
  (users||[]).forEach(u=>{STATE.profiles[u.id]={name:u.name||'?',role:u.role,email:u.email};});
}
async function loadUsers(){
  try{ const j=await api('users'); setProfiles(j.users); }catch(e){/* worker nie ma dostępu */}
}
async function loadTasks(){
  const j=await api('tasks');
  STATE.tasks=j.tasks||[];
}
async function reload(){ await loadTasks(); renderCur(); }

// odświeżanie w tle (zamiast realtime)
function startPolling(){
  if(_poll) clearInterval(_poll);
  _poll=setInterval(async()=>{
    if(document.hidden) return;
    try{ await loadTasks(); renderCur(); gsStatus('✓ Zsynchronizowano'); }catch(e){}
  },6000);
}

// ═══ AUTH ═══
async function doLogin(){
  const email=$('lg-email').value.trim();
  const pass=$('lg-pass').value;
  $('lg-err').textContent='';
  if(!email||!pass){$('lg-err').textContent='Podaj e-mail i hasło.';return;}
  $('lg-btn').disabled=true;$('lg-btn').textContent='Loguję...';
  try{
    const j=await api('login',{email,password:pass});
    await enterApp(j.user);
  }catch(e){
    $('lg-err').textContent=e.message;
  }finally{
    $('lg-btn').disabled=false;$('lg-btn').textContent='Zaloguj';
  }
}
async function doLogout(){
  try{ await api('logout',{}); }catch{}
  location.reload();
}

async function enterApp(user){
  STATE.me=user;
  STATE.role=user.role;
  // wczytaj dane startowe (użytkownicy + zadania jednym żądaniem)
  try{
    const j=await api('bootstrap');
    setProfiles(j.users);
    STATE.tasks=j.tasks||[];
  }catch(e){ gsStatus('⚠ '+e.message); }

  $('me-name').textContent=user.name||user.email;
  const rp=$('me-role');
  rp.textContent=isSup()?'nadzorca':'wykonawca';
  rp.className='role-pill '+(isSup()?'sup':'wrk');

  $('tab-a').classList.toggle('h',!isSup());
  $('tab-k').classList.toggle('h',!isSup());

  $('login').classList.add('h');
  $('app').classList.remove('h');

  go(isSup()?'a':'m');
  startPolling();
  gsStatus('✓ Połączono');
}

// ═══ INIT ═══
(async()=>{
  $('lg-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  try{
    const j=await api('me');
    if(j.user) await enterApp(j.user);
  }catch(e){/* nie zalogowany — pokaż ekran logowania */}
})();
