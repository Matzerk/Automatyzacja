// ═══════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — logika aplikacji (Supabase backend + role)
//  Zapis: Postgres (Supabase) zamiast localStorage/Google Sheets.
//  Synchronizacja: realtime (zmiany widać na żywo u wszystkich).
//  Role: 'supervisor' (nadzorca) tworzy/edytuje, 'worker' oznacza postęp.
// ═══════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ─── Klient Supabase ───────────────────────────────────────────
if (!window.CONFIG || !window.CONFIG.url || window.CONFIG.url.includes('TWOJ-PROJEKT')) {
  alert('Brak konfiguracji! Skopiuj config.example.js → config.js i wpisz dane Supabase.');
}
const sb = window.supabase.createClient(window.CONFIG.url, window.CONFIG.anonKey);

// ─── Stan aplikacji ────────────────────────────────────────────
const STATE = {
  tasks: [],         // [{id,name,t,p,note,status,createdBy,completedBy,completedDate}]
  profiles: {},      // id -> {name, role}
  me: null,          // {id, email}
  role: 'worker',    // 'supervisor' | 'worker'
  cur: 'a',
};
let _rtChannel = null;

// ═══ THEME ═══ (motyw może zostać lokalnie — to tylko wygląd)
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
// kolor inicjału z uuid (stabilny)
function hueOf(id){let h=0;const s=String(id||'');for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
function nameOf(id){const p=STATE.profiles[id];return p?p.name:'?';}
function initialOf(id){const n=nameOf(id);return (n[0]||'?').toUpperCase();}
function whoBadge(id){
  if(!id) return'';
  const hue=hueOf(id);
  return`<span title="${esc(nameOf(id))}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;color:#fff;background:hsl(${hue} 45% 45%)">${esc(initialOf(id))}</span>`;
}

// ═══ BADGES (liczniki w zakładkach) ═══
function updateBadges(){
  const inM=STATE.tasks.filter(t=>t.status==='w_realizacji').length;
  const doneAll=STATE.tasks.filter(t=>t.status==='ukonczone').length;
  const bm=$('badge-m');if(bm){bm.textContent=inM;bm.classList.toggle('h',inM===0);}
  const bu=$('badge-u');if(bu){bu.textContent=doneAll;bu.classList.toggle('h',doneAll===0);}
}

// ═══ ROUTING ═══
function go(r){
  if(STATE.role==='worker' && r==='a') r='m';   // wykonawca nie ma zakładki Zadania
  STATE.cur=r;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  $('v-'+r).classList.add('on');
  ['m','a','u'].forEach(x=>$('tab-'+x).classList.toggle('on',x===r));
  renderCur();
}
function renderCur(){
  if(STATE.cur==='m') renderM();
  else if(STATE.cur==='a') renderA();
  else if(STATE.cur==='u') renderU();
  updateBadges();
}

const isSup = () => STATE.role==='supervisor';

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
          ?`<button class="btn sm" onclick="setStatus('${t.id}','${t.t==='dc'?'w_realizacji':'oczekiwanie'}')">↩</button>`
          :`<button class="btn ok" style="padding:3px 9px;font-size:10px;white-space:nowrap" onclick="setStatus('${t.id}','ukonczone')">✓ Ukończono</button>
            ${t.t==='dc'?`<button class="btn sm" onclick="setStatus('${t.id}','nie_potrzeby')" style="border-color:var(--mu);color:var(--mu);white-space:nowrap" title="Nie ma potrzeby">⊘</button>`:''}`}
        ${isSup()?`<button class="ibtn e" onclick="openEd('${t.id}')" title="Edytuj">✏️</button>
        <button class="ibtn" onclick="delTask('${t.id}')" title="Usuń">🗑️</button>`:''}
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
  const p=NW.t==='dc'?'dc':String(NW.p);
  const status=NW.t==='dc'?'w_realizacji':'oczekiwanie';
  gsStatus('⏳ Zapisuję...');
  const {error}=await sb.from('tasks').insert({
    name, type:NW.t, priority:p, note:$('a-nw-note').value.trim(),
    status, created_by:STATE.me.id
  });
  if(error){gsStatus('⚠ '+error.message);return;}
  gsStatus('✓ Dodano');
  clearForm();
  const wrap=$('add-form-wrap'); if(wrap&&!wrap.classList.contains('h')) toggleForm();
  await reload();
}

// Zmiana statusu (oba role) — przez bezpieczną funkcję RPC
async function setStatus(id,status){
  gsStatus('⏳ Zapisuję...');
  const {error}=await sb.rpc('set_task_status',{p_id:id,p_status:status});
  if(error){gsStatus('⚠ '+error.message);return;}
  gsStatus('✓ Zapisano');
  await reload();
}

// Przełącznik przypisania (nadzorca): oczekiwanie <-> w_realizacji
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
    const {error}=await sb.from('tasks').delete().eq('id',id);
    if(error){gsStatus('⚠ '+error.message);return;}
    gsStatus('✓ Usunięto');
    await reload();
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
  // lista zlecających = nadzorcy
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
  const patch={
    name:$('ed-n').value.trim()||t.name,
    type:newT,
    priority:newT==='dc'?'dc':String(parseInt($('ed-p').value)||1),
    created_by:$('ed-who').value,
    note:$('ed-note').value.trim(),
  };
  if(newT==='dc'&&t.status==='oczekiwanie') patch.status='w_realizacji';
  gsStatus('⏳ Zapisuję...');
  const {error}=await sb.from('tasks').update(patch).eq('id',edId);
  if(error){gsStatus('⚠ '+error.message);return;}
  gsStatus('✓ Zapisano');
  closeEd();
  await reload();
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
          ${t.status==='oczekiwanie'?`<button class="btn sm bl" onclick="assignTask('${t.id}')">▶ Przypisz</button>`:''}
          ${isInProg?`<button class="btn sm" onclick="assignTask('${t.id}')" style="border-color:rgba(91,155,212,.5);color:var(--bl);background:rgba(91,155,212,.08)">🔄 w realizacji ×</button>`:''}
          ${isDone?`<button class="btn sm" onclick="setStatus('${t.id}','${t.t==='dc'?'w_realizacji':'oczekiwanie'}')">↩ Przywróć</button>`:''}
          <button class="ibtn e" onclick="openEd('${t.id}')" title="Edytuj">✏️</button>
          <button class="ibtn" onclick="delTask('${t.id}')" title="Usuń">🗑️</button>
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
const uActive={};   // id zlecającego -> bool
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
  const activeWho=Object.entries(uActive).filter(([,v])=>v).map(([k])=>k);
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
            <button class="btn sm" onclick="setStatus('${t.id}','${t.t==='dc'?'w_realizacji':'oczekiwanie'}')">↩ Przywróć</button>
            ${isSup()?`<button class="ibtn e" onclick="openEd('${t.id}')" title="Edytuj">✏️</button>
            <button class="ibtn" onclick="delTask('${t.id}')" title="Usuń">🗑️</button>`:''}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

// ═══ ŁADOWANIE DANYCH ═══
function mapTask(r){
  return {
    id:r.id, name:r.name, t:r.type,
    p:r.priority==='dc'?'dc':(/^\d+$/.test(r.priority)?+r.priority:r.priority),
    note:r.note||'', status:r.status,
    createdBy:r.created_by, completedBy:r.completed_by, completedDate:r.completed_date,
  };
}
async function loadProfiles(){
  const {data,error}=await sb.from('profiles').select('id,display_name,role');
  if(error){console.error(error);return;}
  STATE.profiles={};
  (data||[]).forEach(p=>{STATE.profiles[p.id]={name:p.display_name||'?',role:p.role};});
}
async function loadTasks(){
  const {data,error}=await sb.from('tasks').select('*');
  if(error){gsStatus('⚠ '+error.message);return;}
  STATE.tasks=(data||[]).map(mapTask);
}
async function reload(){
  await loadTasks();
  renderCur();
}

// ═══ REALTIME ═══
function subscribeRealtime(){
  if(_rtChannel) sb.removeChannel(_rtChannel);
  _rtChannel=sb.channel('tasks-rt')
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},async()=>{
      await loadTasks();
      renderCur();
    })
    .subscribe();
}

// ═══ AUTH ═══
async function doLogin(){
  const email=$('lg-email').value.trim();
  const pass=$('lg-pass').value;
  $('lg-err').textContent='';
  if(!email||!pass){$('lg-err').textContent='Podaj e-mail i hasło.';return;}
  $('lg-btn').disabled=true;$('lg-btn').textContent='Loguję...';
  const {error}=await sb.auth.signInWithPassword({email,password:pass});
  $('lg-btn').disabled=false;$('lg-btn').textContent='Zaloguj';
  if(error){
    $('lg-err').textContent = error.message.includes('Invalid')?'Błędny e-mail lub hasło.':error.message;
    return;
  }
  // onAuthStateChange zajmie się resztą
}
async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}

async function enterApp(session){
  STATE.me={id:session.user.id, email:session.user.email};
  await loadProfiles();
  // jeśli z jakiegoś powodu brak profilu — przyjmij worker
  STATE.role=(STATE.profiles[STATE.me.id]||{}).role||'worker';
  const myName=nameOf(STATE.me.id)!=='?'?nameOf(STATE.me.id):STATE.me.email;
  $('me-name').textContent=myName;
  const rp=$('me-role');
  rp.textContent=isSup()?'nadzorca':'wykonawca';
  rp.className='role-pill '+(isSup()?'sup':'wrk');

  // widoczność zakładki "Zadania" tylko dla nadzorcy
  $('tab-a').classList.toggle('h',!isSup());

  $('login').classList.add('h');
  $('app').classList.remove('h');

  await loadTasks();
  subscribeRealtime();
  go(isSup()?'a':'m');
  gsStatus('✓ Połączono');
}

// ═══ INIT ═══
(async()=>{
  // reaguj na zmiany sesji (login/logout/refresh tokena)
  sb.auth.onAuthStateChange((event,session)=>{
    if(session && $('app').classList.contains('h')){
      enterApp(session);
    }
  });
  const {data:{session}}=await sb.auth.getSession();
  if(session) await enterApp(session);
  // Enter w polu hasła = login
  $('lg-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
})();
