// ═══════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — logika aplikacji (backend PHP + MySQL na kei.pl)
//  2 zakładki:
//   • Zadania     — pracownik: własna lista do odhaczania + godziny;
//                   nadzorca: kolumny per pracownik (zarządza listą, przypisuje).
//   • Podsumowanie— historia wykonań wg dnia, filtr po pracowniku, sumy godzin.
//  Konta — pod przyciskiem ⚙ (tylko nadzorca).
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
  tasks: [],         // [{id,name,t,p,note,status,ownerId,hours,createdBy,completedBy,completedDate}]
  templates: [],     // [{id,name,t,p,note,createdBy,ownerId}]
  profiles: {},      // id -> {name, role, email}
  me: null,          // {id, email, name, role}
  role: 'worker',
  cur: 'a',
};
let _poll = null;

// ═══ THEME ═══
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
function todayISO(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
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
// godziny -> tekst/badge
function hNum(h){return h==null?null:(Number.isInteger(h)?h:+(+h).toFixed(1));}
function hStr(h){const n=hNum(h);return n==null?'':n+'h';}
function hBadge(h){const s=hStr(h);return s?`<span class="b b-cy" title="godziny pracy">⏱ ${s}</span>`:'';}
function hueOf(id){let h=0;const s=String(id||'');for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h;}
function nameOf(id){const p=STATE.profiles[id];return p?p.name:'?';}
function roleOf(id){const p=STATE.profiles[id];return p?p.role:'';}
function initialOf(id){const n=nameOf(id);return (n[0]||'?').toUpperCase();}
function whoBadge(id){
  if(!id) return'<span class="b b-on" title="nieprzypisane">—</span>';
  const hue=hueOf(id);
  return`<span title="${esc(nameOf(id))}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;color:#fff;flex-shrink:0;background:hsl(${hue} 45% 45%)">${esc(initialOf(id))}</span>`;
}

const isSup = () => STATE.role==='supervisor';

// lista użytkowników (do przypisywania)
function allUsers(){
  return Object.entries(STATE.profiles).map(([id,p])=>({id:+id,name:p.name,role:p.role}))
    .sort((a,b)=>(a.role===b.role?0:a.role==='worker'?-1:1)||a.name.localeCompare(b.name,'pl'));
}

// opcje wyboru właściciela (select) — '' = nieprzypisane
function ownerOptions(selected){
  const opts=['<option value="">— nieprzypisane</option>']
    .concat(allUsers().map(u=>`<option value="${u.id}"${(+selected===u.id)?' selected':''}>${esc(u.name)}${u.role==='supervisor'?' (nadzorca)':''}</option>`));
  return opts.join('');
}

// ═══ ROUTING ═══
function go(r){
  if(r==='k' && !isSup()) r='a';
  STATE.cur=r;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  const v=$('v-'+r); if(v) v.classList.add('on');
  ['a','u'].forEach(x=>{const t=$('tab-'+x);if(t)t.classList.toggle('on',x===r);});
  renderCur();
}
function renderCur(){
  if(STATE.cur==='a') renderBoard();
  else if(STATE.cur==='u') renderU();
  else if(STATE.cur==='k') loadUsers().then(()=>{ if(STATE.cur==='k') renderK(); });
}

// ═══ GODZINY — edytor (popraw godziny istniejącego wpisu) ═══
async function setHours(id){
  const t=STATE.tasks.find(x=>x.id===id);
  const cur=t&&t.hours!=null?String(hNum(t.hours)):'';
  const v=prompt('Godziny pracy (np. 2 lub 1.5). Puste = wyczyść:', cur);
  if(v===null) return;
  const val=v.trim()===''?null:parseFloat(v.replace(',','.'));
  if(val!==null&&(isNaN(val)||val<0)){alert('Podaj liczbę godzin ≥ 0.');return;}
  gsStatus('⏳ Zapisuję...');
  try{ await api('task_hours',{id,hours:val}); gsStatus('✓ Zapisano'); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}
async function setStatus(id,status){
  gsStatus('⏳ Zapisuję...');
  try{ await api('task_status',{id,status}); gsStatus('✓ Zapisano'); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}

let cmodCb=null;
function showConfirm(msg,cb){$('cmod-msg').innerHTML=msg;cmodCb=cb;$('cmod').classList.remove('h');}
function delTask(id){
  const t=STATE.tasks.find(x=>x.id===id);
  if(!t) return;
  showConfirm(`Usunąć wpis:<br><strong>${esc(t.name)}</strong>?`,async()=>{
    gsStatus('⏳ Usuwam...');
    try{ await api('task_delete',{id}); gsStatus('✓ Usunięto'); await reload(); }
    catch(e){gsStatus('⚠ '+e.message);}
  });
}

// ═══ ZAKŁADKA 1: ZADANIA (board) ═══
function renderBoard(){
  const board=$('board'); if(!board) return;
  $('board-title').textContent = isSup() ? 'Zadania pracowników' : 'Moje zadania';
  $('board-sub').textContent   = isSup()
    ? 'Każdy pracownik ma swoją kolumnę — zarządzaj listą i przypisuj zadania'
    : 'Odhacz, co dziś zrobiłeś, i wpisz godziny';
  if(isSup()){
    const workers=allUsers().filter(u=>u.role==='worker');
    if(!workers.length){
      board.className='';
      board.innerHTML='<div class="empty"><div class="ei">👥</div>Brak pracowników.<br><span style="font-size:11px">Dodaj konta w <strong style="color:var(--ac)">⚙ Konta</strong> (prawy górny róg).</span></div>';
      return;
    }
    board.className='board';
    board.innerHTML=workers.map(w=>panelHtml(w.id,false)).join('');
  } else {
    board.className='';
    board.innerHTML=panelHtml(STATE.me.id,true);
  }
}

function panelHtml(ownerId, solo){
  const tasks=STATE.tasks.filter(t=>t.ownerId===ownerId);
  const today=todayISO();
  const assigned=tasks.filter(t=>t.status==='oczekiwanie'||t.status==='w_realizacji').sort(psort);
  const doneToday=tasks.filter(t=>t.status==='ukonczone'&&t.completedDate===today).sort((a,b)=>b.id-a.id);
  const todayH=doneToday.reduce((s,t)=>s+(t.hours!=null?+t.hours:0),0);
  const catalog=STATE.templates.filter(t=>t.ownerId===ownerId||t.ownerId==null)
    .sort((a,b)=>a.name.localeCompare(b.name,'pl'));
  const title=(ownerId===STATE.me.id && !isSup()) ? 'Moje zadania' : nameOf(ownerId);
  return `<div class="panel${solo?' panel-solo':''}">
    <div class="panel-head">
      ${whoBadge(ownerId)}
      <span class="panel-name">${esc(title)}</span>
      <span class="panel-stat">dziś <strong style="color:var(--ok)">${doneToday.length}</strong> · ⏱ <strong style="color:var(--bl)">${hStr(todayH)||'0h'}</strong></span>
    </div>
    ${assigned.length?`<div class="panel-sec">📌 Od szefa</div>${assigned.map(assignedRowHtml).join('')}`:''}
    <div class="panel-sec">📝 Lista — odhacz co zrobione</div>
    ${catalog.length?catalog.map(t=>catalogRowHtml(t,ownerId)).join(''):'<div class="col-empty">Brak zadań na liście — dodaj poniżej.</div>'}
    <div class="cat-add">
      <input class="fi" id="newcat-${ownerId}" placeholder="Dodaj zadanie do listy…" onkeydown="if(event.key==='Enter')addCatalog(${ownerId})">
      <button class="btn sm" onclick="addCatalog(${ownerId})" title="Dodaj do listy">＋</button>
    </div>
    ${isSup()?`<div class="cat-add"><input class="fi" id="assign-${ownerId}" placeholder="Przypisz jednorazowe…" onkeydown="if(event.key==='Enter')assignOne(${ownerId})"><button class="btn ok sm" onclick="assignOne(${ownerId})" title="Przypisz zadanie">📌</button></div>`:''}
    ${doneToday.length?`<div class="panel-sec">✅ Zrobione dziś</div>${doneToday.map(doneRowHtml).join('')}`:''}
  </div>`;
}

function catalogRowHtml(tpl,ownerId){
  return `<div class="cat-row">
    <span class="cat-name" title="${esc(tpl.name)}">${esc(tpl.name)}${tpl.t==='dc'?' <span class="b b-dc" style="font-size:8px;padding:1px 5px">codz</span>':''}</span>
    <input class="fi hbox" id="h-${ownerId}-${tpl.id}" type="number" min="0" step="0.5" placeholder="h">
    <button class="btn ok sm" onclick="logTpl(${ownerId},${tpl.id})" title="Zapisz jako zrobione dziś">✓</button>
    <button class="ibtn" onclick="delCatalog(${tpl.id})" title="Usuń z listy">🗑️</button>
  </div>`;
}
function assignedRowHtml(t){
  return `<div class="task-card" style="padding:4px 8px;flex-wrap:wrap;gap:5px">
    <div class="dot" style="background:${dotC(t.p)}"></div>
    <span class="task-card-name">${esc(t.name)}</span>${tBadge(t.t)}
    <input class="fi hbox" id="ah-${t.id}" type="number" min="0" step="0.5" placeholder="h" value="${t.hours!=null?hNum(t.hours):''}">
    <button class="btn ok sm" onclick="completeAssigned(${t.id})" title="Ukończono">✓</button>
    <button class="ibtn e" onclick="openEd(${t.id})" title="Edytuj">✏️</button>
    <button class="ibtn" onclick="delTask(${t.id})" title="Usuń">🗑️</button>
  </div>`;
}
function doneRowHtml(t){
  return `<div class="task-card done-card-dc" style="padding:4px 8px;flex-wrap:wrap;gap:5px">
    <div class="dot" style="background:${dotC(t.p)}"></div>
    <span class="task-card-name" style="text-decoration:line-through;color:var(--mu)">${esc(t.name)}</span>
    ${hBadge(t.hours)}
    <button class="ibtn" onclick="setHours(${t.id})" title="Popraw godziny">⏱</button>
    <button class="ibtn" onclick="delTask(${t.id})" title="Cofnij / usuń wpis">↩</button>
  </div>`;
}

async function logTpl(ownerId,tplId){
  const t=STATE.templates.find(x=>x.id===tplId); if(!t) return;
  const inp=$(`h-${ownerId}-${tplId}`);
  const hv=inp?inp.value.trim():'';
  gsStatus('⏳ Zapisuję...');
  try{
    await api('task_log',{name:t.name,type:t.t,priority:t.p==='dc'?1:t.p,note:t.note||'',hours:hv===''?null:hv,owner_id:ownerId});
    gsStatus('✓ Zapisano'); await reload();
  }catch(e){gsStatus('⚠ '+e.message);}
}
async function addCatalog(ownerId){
  const inp=$(`newcat-${ownerId}`); const name=inp?inp.value.trim():'';
  if(!name) return;
  gsStatus('⏳ Dodaję...');
  try{
    await api('template_create',{name,type:'once',priority:1,owner_id:ownerId});
    if(inp) inp.value='';
    await loadTemplates(); renderCur(); gsStatus('✓ Dodano do listy');
  }catch(e){gsStatus('⚠ '+e.message);}
}
function delCatalog(tplId){
  const t=STATE.templates.find(x=>x.id===tplId);
  showConfirm(`Usunąć z listy:<br><strong>${esc(t?t.name:'')}</strong>?`,async()=>{
    gsStatus('⏳ Usuwam...');
    try{ await api('template_delete',{id:tplId}); await loadTemplates(); renderCur(); gsStatus('✓ Usunięto'); }
    catch(e){gsStatus('⚠ '+e.message);}
  });
}
async function assignOne(ownerId){
  const inp=$(`assign-${ownerId}`); const name=inp?inp.value.trim():'';
  if(!name) return;
  gsStatus('⏳ Przypisuję...');
  try{
    await api('task_create',{name,type:'once',priority:1,owner_id:ownerId});
    if(inp) inp.value='';
    await reload(); gsStatus('✓ Przypisano');
  }catch(e){gsStatus('⚠ '+e.message);}
}
async function completeAssigned(id){
  const inp=$(`ah-${id}`); const hv=inp?inp.value.trim():'';
  gsStatus('⏳ Zapisuję...');
  try{ await api('task_status',{id,status:'ukonczone',hours:hv===''?null:hv}); gsStatus('✓ Zapisano'); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}

// ═══ EDYCJA (modal) ═══
let edId=null;
function openEd(id){
  edId=id;
  const t=STATE.tasks.find(x=>x.id===id);
  if(!t) return;
  $('ed-n').value=t.name;
  $('ed-p').value=t.p==='dc'?'1':String(t.p);
  $('ed-t').value=t.t;
  $('ed-hours').value=t.hours!=null?String(hNum(t.hours)):'';
  const supOnly=document.querySelectorAll('#ed-who, #ed-owner');
  if(isSup()){
    const sups=Object.entries(STATE.profiles).filter(([,p])=>p.role==='supervisor');
    $('ed-who').innerHTML=sups.map(([id,p])=>`<option value="${id}">${esc(p.name)}</option>`).join('')||`<option value="${STATE.me.id}">${esc(nameOf(STATE.me.id))}</option>`;
    $('ed-who').value=t.createdBy||STATE.me.id;
    $('ed-owner').innerHTML=ownerOptions(t.ownerId);
    supOnly.forEach(el=>el.closest('.ff').classList.remove('h'));
  }else{
    supOnly.forEach(el=>el.closest('.ff').classList.add('h'));
  }
  $('ed-note').value=t.note||'';
  $('emod').classList.remove('h');
}
function closeEd(){edId=null;$('emod').classList.add('h');}
async function saveEd(){
  if(!edId) return;
  const t=STATE.tasks.find(x=>x.id===edId);
  if(!t){closeEd();return;}
  const newT=$('ed-t').value;
  const hv=$('ed-hours').value.trim();
  const payload={
    id:edId,
    name:$('ed-n').value.trim()||t.name,
    type:newT,
    priority:parseInt($('ed-p').value)||1,
    note:$('ed-note').value.trim(),
    hours:hv===''?null:hv,
  };
  if(isSup()){
    payload.created_by=parseInt($('ed-who').value)||null;
    const ow=$('ed-owner').value;
    payload.owner_id=ow===''?null:ow;
  }
  gsStatus('⏳ Zapisuję...');
  try{ await api('task_update',payload); gsStatus('✓ Zapisano'); closeEd(); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}

// ═══ ZAKŁADKA 2: PODSUMOWANIE DNIA ═══
let uState={owner:'all'};
function setUFilter(v){uState.owner=v;renderU();}
function buildUFilter(){
  const sel=$('u-filter'); if(!sel) return;
  if(!isSup()){sel.classList.add('h');return;}
  sel.classList.remove('h');
  sel.innerHTML=['<option value="all">👥 Wszyscy pracownicy</option>']
    .concat(allUsers().filter(u=>u.role==='worker').map(u=>`<option value="${u.id}">${esc(u.name)}</option>`)).join('');
  sel.value=uState.owner;
}
function renderU(){
  buildUFilter();
  let done=STATE.tasks.filter(t=>t.status==='ukonczone');
  if(isSup() && uState.owner!=='all') done=done.filter(t=>t.ownerId===+uState.owner);
  done.sort((a,b)=>(b.completedDate||'').localeCompare(a.completedDate||''));
  $('u-count').textContent=done.length;
  const totalH=done.reduce((s,t)=>s+(t.hours!=null?+t.hours:0),0);
  $('u-hours').textContent=hStr(totalH)||'0h';
  if(!done.length){$('u-list').innerHTML=`<div class="empty"><div class="ei">📊</div>Brak ukończonych zadań w tym widoku.</div>`;return;}
  const byDate={};
  done.forEach(t=>{const d=t.completedDate||'brak';(byDate[d]=byDate[d]||[]).push(t);});
  $('u-list').innerHTML=Object.entries(byDate).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,items])=>{
    const dayH=items.reduce((s,t)=>s+(t.hours!=null?+t.hours:0),0);
    const byOwner={};
    items.forEach(t=>{const o=t.ownerId||0;(byOwner[o]=byOwner[o]||[]).push(t);});
    const ownerBlocks=Object.entries(byOwner).map(([oid,its])=>{
      const oh=its.reduce((s,t)=>s+(t.hours!=null?+t.hours:0),0);
      const head=isSup()?`<div style="display:flex;align-items:center;gap:6px;margin:8px 0 4px">${whoBadge(+oid||null)}<span style="font-size:11px;font-weight:700">${esc(+oid?nameOf(+oid):'— nieprzypisane')}</span><span style="font-size:10px;color:var(--bl)">⏱ ${hStr(oh)||'0h'}</span><span style="font-size:9px;color:var(--mu)">· ${its.length} zad.</span></div>`:'';
      return head+its.map(doneSummaryRow).join('');
    }).join('');
    return `<div style="margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:var(--ac);letter-spacing:1px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between">
        <span>${fmtDate(date==='brak'?null:date)}</span>${dayH>0?`<span style="color:var(--bl)">⏱ ${hStr(dayH)}</span>`:''}
      </div>${ownerBlocks}</div>`;
  }).join('');
}
function doneSummaryRow(t){
  return `<div class="done-entry">
    <div class="dot" style="background:${dotC(t.p)};flex-shrink:0"></div>
    <div style="flex:1"><div style="font-size:12px">${esc(t.name)}</div>
    ${t.note?`<div style="font-size:10px;color:var(--mu);margin-top:1px">${esc(t.note)}</div>`:''}</div>
    ${hBadge(t.hours)}
    <button class="ibtn" onclick="setHours(${t.id})" title="Godziny">⏱</button>
    ${isSup()?`<button class="ibtn e" onclick="openEd(${t.id})" title="Edytuj">✏️</button><button class="ibtn" onclick="delTask(${t.id})" title="Usuń">🗑️</button>`:''}
  </div>`;
}

// ═══ KONTA (tylko nadzorca, pod ⚙) ═══
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
async function loadTemplates(){
  try{ const j=await api('templates'); STATE.templates=j.templates||[]; }catch(e){/* brak dostępu */}
}
async function reload(){ await loadTasks(); renderCur(); }

// odświeżanie w tle — nie przeszkadzaj, gdy ktoś coś wpisuje
function startPolling(){
  if(_poll) clearInterval(_poll);
  _poll=setInterval(async()=>{
    if(document.hidden) return;
    const ae=document.activeElement;
    if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')) return;
    try{ await loadTasks(); renderCur(); }catch(e){}
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
  try{
    const j=await api('bootstrap');
    setProfiles(j.users);
    STATE.tasks=j.tasks||[];
  }catch(e){ gsStatus('⚠ '+e.message); }
  await loadTemplates();

  $('me-name').textContent=user.name||user.email;
  const rp=$('me-role');
  rp.textContent=isSup()?'nadzorca':'wykonawca';
  rp.className='role-pill '+(isSup()?'sup':'wrk');

  const cfg=$('cfgBtn'); if(cfg) cfg.classList.toggle('h',!isSup());

  $('login').classList.add('h');
  $('app').classList.remove('h');

  go('a');
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
