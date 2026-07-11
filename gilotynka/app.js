// ═══════════════════════════════════════════════════════════════
//  GILOTYNKA 🪓 — logika aplikacji (backend PHP + MySQL na kei.pl)
//  • Zadania: priorytety 1–10, statusy na_liscie/trwajace/zawieszone/zamkniete,
//    pracownik pobiera/zamyka/zawiesza, rejestr godzin per dzień (zadanie wielodniowe).
//  • Podsumowanie: raport godzin dzień/tydzień/miesiąc/zakres, filtr pracownika.
//  • Kalendarz: dni wolne + godziny dostępności (pracownik i admin).
//  • Konta — pod ⚙.
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
  tasks: [], logs: [], profiles: {}, me: null, role: 'worker', cur: 'a',
  viewAs: 'admin',                    // (admin) 'admin' = przegląd wszystkich, albo id pracownika = działaj jako on
  expanded: {},                       // ownerId -> czy lista rozwinięta (>10)
  cal: { y: 0, m: 0, mode: 'off', user: 0, days: {}, offYear: 0, locked: false },
  rep: { mode: 'month', anchor: '', from: '', to: '', owner: 'all' },
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

// ═══ HELPERS ═══
const DPL = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
const DPS = ['Pn','Wt','Śr','Cz','Pt','So','Nd'];
const MPL = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const MPL2 = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
function fmtDate(s){const d=s?new Date(s+'T12:00:00'):new Date();return`${DPL[d.getDay()]}, ${d.getDate()} ${MPL2[d.getMonth()]} ${d.getFullYear()}`;}
function todayISO(){const d=new Date();return iso(d);}
function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function hNum(h){return h==null?null:(Number.isInteger(h)?h:+(+h).toFixed(1));}
function hStr(h){const n=hNum(h);return n==null?'':n+'h';}
function pColor(p){p=+p;return p<=3?'var(--wn)':p<=6?'var(--ac)':'var(--bl)';}
function pBadge(p){return`<span class="b" style="border-color:${pColor(p)};color:${pColor(p)}">P${esc(p)}</span>`;}
function tBadge(t){return t==='cyc'?'<span class="b b-cy">🔄 cykliczne</span>':'<span class="b b-on">jednorazowe</span>';}
function stBadge(s){
  const m={na_liscie:['na liście','st-wait'],trwajace:['⏳ trwające','st-prog'],zawieszone:['⏸ zawieszone','st-wait'],zamkniete:['✓ zamknięte','st-done']};
  const x=m[s]||['?','st-wait'];return`<span class="b ${x[1]}">${x[0]}</span>`;
}
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
function allUsers(){
  return Object.entries(STATE.profiles).map(([id,p])=>({id:+id,name:p.name,role:p.role}))
    .sort((a,b)=>(a.role===b.role?0:a.role==='worker'?-1:1)||a.name.localeCompare(b.name,'pl'));
}
function workers(){ return allUsers().filter(u=>u.role==='worker'); }
function psort(a,b){return (+a.p||99)-(+b.p||99) || a.name.localeCompare(b.name,'pl');}

// godziny zadania (z rejestru)
function taskHours(taskId){return STATE.logs.filter(l=>l.taskId===taskId).reduce((s,l)=>s+(+l.hours||0),0);}
function taskHoursOn(taskId,date){return STATE.logs.filter(l=>l.taskId===taskId&&l.date===date).reduce((s,l)=>s+(+l.hours||0),0);}

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
  if(STATE.cur==='a'){ renderBoard(); ensureCalendar(); }
  else if(STATE.cur==='u') renderReport();
  else if(STATE.cur==='k') loadUsers().then(()=>{ if(STATE.cur==='k') renderK(); });
}

// ═══ ZAKŁADKA 1: ZADANIA ═══
function renderSwitcher(){
  const el=$('switcher'); if(!el) return;
  if(!isSup()){ el.classList.add('h'); return; }
  el.classList.remove('h');
  const chips=[`<button class="chip ${STATE.viewAs==='admin'?'on':''}" onclick="setViewAs('admin')">🛡️ ${esc(STATE.me.name||nameOf(STATE.me.id))} <span style="opacity:.6">· admin</span></button>`];
  workers().forEach(w=>chips.push(`<button class="chip ${(+STATE.viewAs===w.id)?'on':''}" onclick="setViewAs('${w.id}')">🧒 ${esc(w.name)}</button>`));
  el.innerHTML=`<div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--mu);margin-bottom:6px">Wybierz osobę</div><div class="switcher-row">${chips.join('')}</div>`;
}
function setViewAs(v){
  STATE.viewAs = (v==='admin') ? 'admin' : v;
  if(v!=='admin'){ STATE.cal.user=+v; }
  renderCur();
}
function renderBoard(){
  const board=$('board'); if(!board) return;
  renderSwitcher();

  // WYKONAWCA: tylko swój panel
  if(!isSup()){
    $('board-title').textContent='Moje zadania';
    $('board-sub').textContent='Wpisuj godziny, pobieraj i zamykaj zadania (priorytet 1 = najważniejsze)';
    STATE.cal.user=STATE.me.id; STATE.cal.locked=true;
    board.className=''; board.innerHTML=panelHtml(STATE.me.id,true);
    return;
  }

  // ADMIN — działaj jako pracownik
  const imp = STATE.viewAs!=='admin' ? +STATE.viewAs : null;
  if(imp && STATE.profiles[imp]){
    $('board-title').textContent='Podgląd: '+nameOf(imp);
    $('board-sub').textContent='Działasz w imieniu tego pracownika — zmiany zapisują się u niego';
    STATE.cal.user=imp; STATE.cal.locked=true;
    board.className='';
    board.innerHTML=`<div class="imp-banner">👁 Podgląd jako <strong>${esc(nameOf(imp))}</strong> — zmiany zapisują się na jego koncie.<button class="btn sm" onclick="setViewAs('admin')">← wróć do widoku admina</button></div>`+panelHtml(imp,true);
    return;
  }

  // ADMIN — przegląd wszystkich
  $('board-title').textContent='Wszyscy pracownicy';
  $('board-sub').textContent='Kliknij osobę powyżej, aby wejść w jej panel i działać za nią';
  STATE.cal.locked=false;
  if(!STATE.cal.user || roleOf(STATE.cal.user)!=='worker') STATE.cal.user=(workers()[0]?.id||STATE.me.id);
  const ws=workers();
  if(!ws.length){
    board.className='';
    board.innerHTML='<div class="empty"><div class="ei">👥</div>Brak pracowników.<br><span style="font-size:11px">Dodaj konta w <strong style="color:var(--ac)">⚙ Konta</strong>.</span></div>';
    return;
  }
  board.className='board';
  board.innerHTML=ws.map(w=>panelHtml(w.id,false)).join('');
}

function panelHtml(ownerId, solo){
  const today=todayISO();
  const all=STATE.tasks.filter(t=>t.ownerId===ownerId);
  const active=all.filter(t=>t.status!=='zamkniete').sort(psort);
  const picklist=active.filter(t=>t.status!=='zamkniete');
  const expanded=!!STATE.expanded[ownerId];
  const shown=expanded?active:active.slice(0,10);
  const todayLogs=STATE.logs.filter(l=>l.workerId===ownerId&&l.date===today);
  const todayH=todayLogs.reduce((s,l)=>s+(+l.hours||0),0);
  const title=(ownerId===STATE.me.id && !isSup()) ? 'Moje zadania' : nameOf(ownerId);
  const taskOpts=picklist.map(t=>`<option value="${t.id}">[P${esc(t.p)}] ${esc(t.name)}</option>`).join('');
  return `<div class="panel${solo?' panel-solo':''}">
    <div class="panel-head">
      ${whoBadge(ownerId)}
      <span class="panel-name">${esc(title)}</span>
      <span class="panel-stat">dziś ⏱ <strong style="color:var(--bl)">${hStr(todayH)||'0h'}</strong></span>
    </div>

    <div class="panel-sec">⏱ Wpisz godziny (dziś)</div>
    <div class="wlog">
      <input class="fi" type="date" id="wd-${ownerId}" value="${today}">
      <select class="fsel" id="wt-${ownerId}">${taskOpts||'<option value="">— brak zadań —</option>'}</select>
      <input class="fi hbox" id="wh-${ownerId}" type="number" min="0" step="0.5" placeholder="godz.">
      <button class="btn ok sm" onclick="logHours(${ownerId})">Zapisz</button>
      <button class="btn sm" onclick="toggleNewTask(${ownerId})" id="ntbtn-${ownerId}" title="Dodaj nowe zlecenie">＋ Nowe</button>
    </div>
    <div class="h" id="ntform-${ownerId}">
      <div class="wlog" style="margin-top:5px">
        <input class="fi" id="ntn-${ownerId}" placeholder="Nazwa nowego zlecenia">
        <select class="fsel hbox2" id="ntp-${ownerId}" title="Priorytet">${prioOpts(5)}</select>
        <select class="fsel" id="ntt-${ownerId}" title="Typ"><option value="once">jednorazowe</option><option value="cyc">cykliczne</option></select>
        <button class="btn ok sm" onclick="addTaskFor(${ownerId})">Dodaj</button>
      </div>
    </div>

    <div class="panel-sec">📋 Lista zadań ${active.length>10?`<span style="color:var(--mu);font-weight:400">(${active.length})</span>`:''}</div>
    ${shown.length?shown.map(t=>taskRow(t)).join(''):'<div class="col-empty">Brak aktywnych zadań.</div>'}
    ${active.length>10?`<button class="btn sm" style="margin-top:4px" onclick="toggleExpand(${ownerId})">${expanded?'▲ Zwiń':'▼ Pokaż wszystkie ('+active.length+')'}</button>`:''}

    ${todayLogs.length?`<div class="panel-sec">✅ Dziś wpisane (${hStr(todayH)})</div>${todayLogs.map(logRow).join('')}`:''}
  </div>`;
}
function prioOpts(sel){let o='';for(let i=1;i<=10;i++)o+=`<option value="${i}"${i===sel?' selected':''}>P${i}</option>`;return o;}

function taskRow(t){
  const total=taskHours(t.id), today=taskHoursOn(t.id,todayISO());
  const addedBy = (isSup() && t.createdBy && roleOf(t.createdBy)==='worker')
    ? `<span class="b b-on" title="zlecenie dodane przez pracownika">➕ dodał ${esc(nameOf(t.createdBy))}</span>` : '';
  let actions='';
  if(t.status==='na_liscie') actions=`<button class="btn sm bl" onclick="setStat(${t.id},'trwajace')" title="Pobierz zadanie">▶ Pobierz</button>`;
  else if(t.status==='trwajace') actions=`<button class="btn ok sm" onclick="setStat(${t.id},'zamkniete')" title="Zamknij (skończone)">✓ Zamknij</button><button class="btn sm" onclick="setStat(${t.id},'zawieszone')" title="Zawieś">⏸</button>`;
  else if(t.status==='zawieszone') actions=`<button class="btn sm bl" onclick="setStat(${t.id},'trwajace')" title="Wznów">▶ Wznów</button>`;
  return `<div class="task-card" style="padding:5px 8px;flex-wrap:wrap;gap:5px;align-items:center">
    ${pBadge(t.p)}
    <span class="task-card-name" style="flex:1;min-width:90px">${esc(t.name)}</span>
    ${tBadge(t.t)}${stBadge(t.status)}
    ${total>0?`<span class="b b-cy" title="łącznie godzin">Σ ${hStr(total)}</span>`:''}
    ${addedBy}
    <div style="display:flex;gap:3px;align-items:center;flex-shrink:0">
      ${actions}
      <button class="ibtn" onclick="openNotes(${t.id})" title="Uwagi / wyślij e-mail">💬</button>
      <button class="ibtn e" onclick="openEd(${t.id})" title="Edytuj">✏️</button>
      <button class="ibtn" onclick="delTask(${t.id})" title="Usuń">🗑️</button>
    </div>
  </div>`;
}
function logRow(l){
  const tn=l.taskId?(STATE.tasks.find(t=>t.id===l.taskId)||{}).name:'(bez zadania)';
  return `<div class="task-card done-card-dc" style="padding:4px 8px;gap:6px">
    <span class="b b-cy">⏱ ${hStr(l.hours)}</span>
    <span class="task-card-name" style="flex:1">${esc(tn||'?')}</span>
    <button class="ibtn" onclick="delLog(${l.id})" title="Usuń wpis godzin">🗑️</button>
  </div>`;
}

function toggleExpand(ownerId){ STATE.expanded[ownerId]=!STATE.expanded[ownerId]; renderBoard(); }
function toggleNewTask(ownerId){ const f=$(`ntform-${ownerId}`); if(f) f.classList.toggle('h'); }

async function logHours(ownerId){
  const tid=$(`wt-${ownerId}`).value;
  if(!tid){alert('Wybierz zadanie z listy (albo dodaj nowe przyciskiem „＋ Nowe").');return;}
  const hv=$(`wh-${ownerId}`).value.trim();
  if(hv===''||+hv<=0){alert('Podaj liczbę godzin większą od 0.');return;}
  const date=$(`wd-${ownerId}`).value||todayISO();
  gsStatus('⏳ Zapisuję godziny...');
  try{
    await api('log_add',{task_id:tid,hours:hv,work_date:date,worker_id:ownerId});
    $(`wh-${ownerId}`).value='';
    gsStatus('✓ Zapisano godziny'); await reload();
  }catch(e){gsStatus('⚠ '+e.message);}
}
async function addTaskFor(ownerId){
  const name=$(`ntn-${ownerId}`).value.trim();
  if(!name){alert('Wpisz nazwę zlecenia.');return;}
  gsStatus('⏳ Dodaję zlecenie...');
  try{
    await api('task_create',{name,priority:$(`ntp-${ownerId}`).value,type:$(`ntt-${ownerId}`).value,owner_id:ownerId});
    $(`ntn-${ownerId}`).value='';
    gsStatus('✓ Dodano'); await reload();
  }catch(e){gsStatus('⚠ '+e.message);}
}
async function setStat(id,status){
  gsStatus('⏳ Zapisuję...');
  try{ await api('task_status',{id,status}); gsStatus('✓ Zapisano'); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}
async function delLog(id){
  gsStatus('⏳ Usuwam...');
  try{ await api('log_delete',{id}); gsStatus('✓ Usunięto'); await reload(); }
  catch(e){gsStatus('⚠ '+e.message);}
}

let cmodCb=null;
function showConfirm(msg,cb){$('cmod-msg').innerHTML=msg;cmodCb=cb;$('cmod').classList.remove('h');}
function delTask(id){
  const t=STATE.tasks.find(x=>x.id===id); if(!t) return;
  showConfirm(`Usunąć zadanie:<br><strong>${esc(t.name)}</strong>?<br><span style="font-size:11px;color:var(--mu)">Usunie też powiązane wpisy godzin.</span>`,async()=>{
    gsStatus('⏳ Usuwam...');
    try{ await api('task_delete',{id}); gsStatus('✓ Usunięto'); await reload(); }
    catch(e){gsStatus('⚠ '+e.message);}
  });
}

// ═══ UWAGI (modal + e-mail) ═══
let noteTaskId=null;
async function openNotes(id){
  noteTaskId=id;
  const t=STATE.tasks.find(x=>x.id===id);
  $('nmod-title').textContent='💬 Uwagi — '+(t?t.name:'');
  $('nmod-body').value='';
  $('nmod-list').innerHTML='<div style="font-size:11px;color:var(--mu)">Ładuję…</div>';
  $('nmod').classList.remove('h');
  try{
    const j=await api('task_notes&task_id='+id);
    const notes=j.notes||[];
    $('nmod-list').innerHTML=notes.length?notes.map(n=>`
      <div class="done-entry" style="display:block;padding:8px 10px">
        <div style="font-size:12px;white-space:pre-wrap">${esc(n.body)}</div>
        <div style="font-size:9px;color:var(--mu);margin-top:3px">${esc(n.authorId?nameOf(n.authorId):'?')} · ${esc((n.createdAt||'').slice(0,16).replace('T',' '))}${n.emailed?' · 📧 wysłano':''}</div>
      </div>`).join(''):'<div style="font-size:11px;color:var(--mu)">Brak uwag.</div>';
  }catch(e){ $('nmod-list').innerHTML='<div style="font-size:11px;color:var(--wn)">'+esc(e.message)+'</div>'; }
}
function closeNotes(){ noteTaskId=null; $('nmod').classList.add('h'); }
async function saveNote(send){
  if(!noteTaskId) return;
  const body=$('nmod-body').value.trim();
  if(!body){alert('Wpisz treść uwagi.');return;}
  gsStatus('⏳ Zapisuję uwagę...');
  try{
    const j=await api('task_note',{task_id:noteTaskId,body,send:!!send});
    gsStatus(send?(j.emailed?'✓ Zapisano i wysłano e-mail':'✓ Zapisano (e-mail nie wyszedł)'):'✓ Zapisano uwagę');
    openNotes(noteTaskId);
  }catch(e){gsStatus('⚠ '+e.message);}
}

// ═══ EDYCJA (modal) ═══
let edId=null;
function openEd(id){
  edId=id;
  const t=STATE.tasks.find(x=>x.id===id); if(!t) return;
  $('ed-n').value=t.name;
  $('ed-p').innerHTML=prioOpts(+t.p||5);
  $('ed-t').value=t.t==='cyc'?'cyc':'once';
  $('ed-st').value=t.status;
  $('ed-note').value=t.note||'';
  const supOnly=document.querySelectorAll('#ed-who, #ed-owner');
  if(isSup()){
    const sups=Object.entries(STATE.profiles).filter(([,p])=>p.role==='supervisor');
    $('ed-who').innerHTML=sups.map(([id,p])=>`<option value="${id}">${esc(p.name)}</option>`).join('')||`<option value="${STATE.me.id}">${esc(nameOf(STATE.me.id))}</option>`;
    $('ed-who').value=t.createdBy||STATE.me.id;
    $('ed-owner').innerHTML='<option value="">— nieprzypisane</option>'+allUsers().map(u=>`<option value="${u.id}"${t.ownerId===u.id?' selected':''}>${esc(u.name)}</option>`).join('');
    supOnly.forEach(el=>el.closest('.ff').classList.remove('h'));
  }else{
    supOnly.forEach(el=>el.closest('.ff').classList.add('h'));
  }
  $('emod').classList.remove('h');
}
function closeEd(){edId=null;$('emod').classList.add('h');}
async function saveEd(){
  if(!edId) return;
  const t=STATE.tasks.find(x=>x.id===edId); if(!t){closeEd();return;}
  const payload={id:edId,name:$('ed-n').value.trim()||t.name,type:$('ed-t').value,priority:$('ed-p').value,note:$('ed-note').value.trim()};
  if(isSup()){
    payload.created_by=parseInt($('ed-who').value)||null;
    const ow=$('ed-owner').value; payload.owner_id=ow===''?null:ow;
  }
  gsStatus('⏳ Zapisuję...');
  try{
    await api('task_update',payload);
    // status osobno (gdy zmieniony)
    const ns=$('ed-st').value;
    if(ns && ns!==t.status) await api('task_status',{id:edId,status:ns});
    gsStatus('✓ Zapisano'); closeEd(); await reload();
  }catch(e){gsStatus('⚠ '+e.message);}
}

// ═══ ZAKŁADKA 2: RAPORT GODZIN ═══
function repRange(){
  const a=STATE.rep.anchor?new Date(STATE.rep.anchor+'T12:00:00'):new Date();
  if(STATE.rep.mode==='day') return [iso(a),iso(a)];
  if(STATE.rep.mode==='week'){
    const d=new Date(a); const dow=(d.getDay()+6)%7; // pon=0
    const mon=new Date(d); mon.setDate(d.getDate()-dow);
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    return [iso(mon),iso(sun)];
  }
  if(STATE.rep.mode==='month'){
    const f=new Date(a.getFullYear(),a.getMonth(),1), l=new Date(a.getFullYear(),a.getMonth()+1,0);
    return [iso(f),iso(l)];
  }
  return [STATE.rep.from||'0000-01-01', STATE.rep.to||'9999-12-31']; // zakres
}
function setRepMode(m){ STATE.rep.mode=m; renderReport(); }
function setRepAnchor(v){ STATE.rep.anchor=v; renderReport(); }
function setRepFromTo(){ STATE.rep.from=$('rep-from').value; STATE.rep.to=$('rep-to').value; renderReport(); }
function setRepOwner(v){ STATE.rep.owner=v; renderReport(); }
function renderReport(){
  if(!STATE.rep.anchor) STATE.rep.anchor=todayISO();
  // seg active
  document.querySelectorAll('#rep-seg .sbtn').forEach(b=>b.classList.toggle('on',b.dataset.v===STATE.rep.mode));
  $('rep-anchor').classList.toggle('h', STATE.rep.mode==='range');
  $('rep-fromto').classList.toggle('h', STATE.rep.mode!=='range');
  $('rep-anchor').value=STATE.rep.anchor;
  // filtr pracownika (admin)
  const fsel=$('u-filter');
  if(isSup()){ fsel.classList.remove('h');
    fsel.innerHTML=['<option value="all">👥 Wszyscy</option>'].concat(workers().map(u=>`<option value="${u.id}">${esc(u.name)}</option>`)).join('');
    fsel.value=STATE.rep.owner;
  } else fsel.classList.add('h');

  const [from,to]=repRange();
  let logs=STATE.logs.filter(l=>l.date>=from && l.date<=to);
  if(isSup() && STATE.rep.owner!=='all') logs=logs.filter(l=>l.workerId===+STATE.rep.owner);
  const total=logs.reduce((s,l)=>s+(+l.hours||0),0);
  $('u-hours').textContent=hStr(total)||'0h';
  $('u-count').textContent=logs.length;
  const lbl={day:'dzień',week:'tydzień',month:'miesiąc',range:'zakres'}[STATE.rep.mode];
  $('rep-period').textContent = from===to?fmtDate(from):`${from} → ${to}`;

  if(!logs.length){ $('u-list').innerHTML=`<div class="empty"><div class="ei">📊</div>Brak godzin w wybranym okresie (${esc(lbl)}).</div>`; return; }

  // grupuj: pracownik -> zadanie -> suma; + rozbicie po dniach
  const byWorker={};
  logs.forEach(l=>{ (byWorker[l.workerId]=byWorker[l.workerId]||[]).push(l); });
  $('u-list').innerHTML=Object.entries(byWorker)
    .sort((a,b)=>nameOf(+a[0]).localeCompare(nameOf(+b[0]),'pl'))
    .map(([wid,ls])=>{
      const wh=ls.reduce((s,l)=>s+(+l.hours||0),0);
      const byTask={};
      ls.forEach(l=>{ const k=l.taskId||0; (byTask[k]=byTask[k]||[]).push(l); });
      const taskRows=Object.entries(byTask).map(([tid,tls])=>{
        const th=tls.reduce((s,l)=>s+(+l.hours||0),0);
        const tname=+tid?((STATE.tasks.find(t=>t.id===+tid)||{}).name||'(usunięte)'):'(bez zadania)';
        const days=tls.sort((a,b)=>a.date.localeCompare(b.date)).map(l=>`${l.date.slice(5)}: ${hStr(l.hours)}`).join(' · ');
        return `<div class="done-entry" style="display:block;padding:7px 10px">
          <div style="display:flex;gap:8px"><span style="flex:1;font-size:12px">${esc(tname)}</span><span class="b b-cy">Σ ${hStr(th)}</span></div>
          <div style="font-size:9px;color:var(--mu);margin-top:2px">${esc(days)}</div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--ac);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--bd);display:flex;justify-content:space-between;align-items:center">
          <span style="display:flex;align-items:center;gap:6px">${whoBadge(+wid)} ${esc(nameOf(+wid))}</span>
          <span style="color:var(--bl)">⏱ ${hStr(wh)}</span>
        </div>${taskRows}</div>`;
    }).join('');
}

// ═══ KALENDARZ ═══
function ensureCalendar(){
  if(!STATE.cal.y){ const d=new Date(); STATE.cal.y=d.getFullYear(); STATE.cal.m=d.getMonth(); }
  if(!STATE.cal.user) STATE.cal.user = isSup() ? (workers()[0]?.id || STATE.me.id) : STATE.me.id;
  loadCalendar().then(renderCalendar);
}
async function loadCalendar(){
  const y=STATE.cal.y, m=STATE.cal.m;
  const from=iso(new Date(y,m,1)), to=iso(new Date(y,m+1,0));
  try{
    const j=await api(`calendar_get&user_id=${STATE.cal.user}&from=${from}&to=${to}&year=${y}`);
    STATE.cal.days={}; (j.days||[]).forEach(d=>{STATE.cal.days[d.day]={isOff:d.isOff,avail:d.availHours};});
    STATE.cal.offYear=j.offThisYear||0;
  }catch(e){ STATE.cal.days={}; }
}
function calNav(delta){ let m=STATE.cal.m+delta, y=STATE.cal.y; if(m<0){m=11;y--;}if(m>11){m=0;y++;} STATE.cal.m=m;STATE.cal.y=y; loadCalendar().then(renderCalendar); }
function calMode(mode){ STATE.cal.mode=mode; renderCalendar(); }
function calUser(v){ STATE.cal.user=+v; loadCalendar().then(renderCalendar); }
function renderCalendar(){
  const wrap=$('calwrap'); if(!wrap) return;
  const y=STATE.cal.y, m=STATE.cal.m;
  const first=new Date(y,m,1), startDow=(first.getDay()+6)%7, dim=new Date(y,m+1,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<div class="cal-cell cal-empty"></div>';
  const today=todayISO();
  for(let d=1;d<=dim;d++){
    const ds=iso(new Date(y,m,d)); const info=STATE.cal.days[ds]||{};
    const cls=['cal-cell']; if(info.isOff)cls.push('cal-off'); if(ds===today)cls.push('cal-today');
    cells+=`<div class="${cls.join(' ')}" onclick="calClick('${ds}')" title="${ds}">
      <span class="cal-d">${d}</span>
      ${info.avail!=null?`<span class="cal-av">${hNum(info.avail)}h</span>`:''}
      ${info.isOff?'<span class="cal-off-tag">wolne</span>':''}
    </div>`;
  }
  const owSel = (isSup() && !STATE.cal.locked)
    ? `<select class="fsel" onchange="calUser(this.value)" style="width:auto;font-size:11px;padding:4px 8px">${workers().map(u=>`<option value="${u.id}"${STATE.cal.user===u.id?' selected':''}>${esc(u.name)}</option>`).join('')}</select>`
    : `<span style="font-size:11px;color:var(--mu)">${esc(nameOf(STATE.cal.user))}</span>`;
  wrap.innerHTML=`
  <div class="panel" style="max-width:560px">
    <div class="panel-head" style="flex-wrap:wrap;gap:8px">
      <span class="panel-name">🗓️ Kalendarz dni wolnych</span>
      ${owSel}
    </div>
    <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:6px">
        <button class="btn sm" onclick="calNav(-1)">‹</button>
        <strong style="font-family:'Syne',sans-serif">${MPL[m]} ${y}</strong>
        <button class="btn sm" onclick="calNav(1)">›</button>
      </div>
      <div class="seg">
        <button class="sbtn ${STATE.cal.mode==='off'?'on':''}" onclick="calMode('off')">Dni wolne</button>
        <button class="sbtn ${STATE.cal.mode==='avail'?'on':''}" onclick="calMode('avail')">Godziny dostępności</button>
      </div>
    </div>
    <div class="cal-dows">${DPS.map(d=>`<div>${d}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mu);margin-top:6px">
      <span>Tryb: <strong style="color:var(--ac)">${STATE.cal.mode==='off'?'klik = dzień wolny':'klik = ustaw godziny dostępności'}</strong></span>
      <span>Dni urlopowe ${y}: <strong style="color:var(--wn)">${STATE.cal.offYear}</strong></span>
    </div>
  </div>`;
}
async function calClick(ds){
  const info=STATE.cal.days[ds]||{};
  try{
    if(STATE.cal.mode==='off'){
      await api('calendar_set',{user_id:STATE.cal.user,day:ds,is_off:info.isOff?0:1});
    } else {
      const cur=info.avail!=null?String(info.avail):'';
      const v=prompt('Godziny dostępności w dniu '+ds+' (puste = wyczyść):',cur);
      if(v===null) return;
      await api('calendar_set',{user_id:STATE.cal.user,day:ds,avail_hours:v.trim()===''?'':v.replace(',','.')});
    }
    await loadCalendar(); renderCalendar();
    gsStatus('✓ Zapisano');
  }catch(e){gsStatus('⚠ '+e.message);}
}

// ═══ KONTA (pod ⚙) ═══
function toggleUserForm(){
  const w=$('k-form-wrap'),b=$('uf-toggle'); const open=w.classList.contains('h');
  w.classList.toggle('h',!open); b.textContent=open?'▲ Zwiń':'＋ Dodaj konto'; b.className=open?'btn wn':'btn ok';
}
async function addUser(){
  const email=$('k-email').value.trim(), pass=$('k-pass').value;
  if(!email||pass.length<6){alert('Podaj e-mail i hasło (min. 6 znaków).');return;}
  gsStatus('⏳ Tworzę konto...');
  try{
    await api('user_create',{email,name:$('k-name').value.trim(),role:$('k-role').value,password:pass});
    gsStatus('✓ Utworzono'); $('k-email').value='';$('k-name').value='';$('k-pass').value='';
    toggleUserForm(); await loadUsers(); renderK();
  }catch(e){gsStatus('⚠ '+e.message);}
}
async function toggleRole(id,role){
  const next=role==='supervisor'?'worker':'supervisor';
  gsStatus('⏳ Zapisuję...');
  try{ await api('user_update',{id,role:next}); gsStatus('✓ Zapisano'); await loadUsers(); renderK(); }
  catch(e){gsStatus('⚠ '+e.message);}
}
async function resetPass(id){
  const p=prompt('Nowe hasło (min. 6 znaków):'); if(p===null) return;
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
      <td><span class="b ${u.role==='supervisor'?'b-dc':'b-cy'}">${u.role==='supervisor'?'admin':'pracownik'}</span></td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn sm" onclick="toggleRole(${u.id},'${u.role}')">${u.role==='supervisor'?'→ pracownik':'→ admin'}</button>
        <button class="btn sm" onclick="resetPass(${u.id})">🔑 hasło</button>
        ${u.id!==STATE.me.id?`<button class="ibtn" onclick="delUser(${u.id})" title="Usuń">🗑️</button>`:''}
      </div></td>
    </tr>`).join('');
}

// ═══ ŁADOWANIE DANYCH ═══
function setProfiles(users){
  STATE.profiles={};
  (users||[]).forEach(u=>{STATE.profiles[u.id]={name:u.name||'?',role:u.role,email:u.email};});
}
async function loadUsers(){ try{ const j=await api('users'); setProfiles(j.users); }catch(e){} }
async function loadTasks(){ const j=await api('tasks'); STATE.tasks=j.tasks||[]; STATE.logs=j.logs||[]; }
async function reload(){ await loadTasks(); renderCur(); }

function startPolling(){
  if(_poll) clearInterval(_poll);
  _poll=setInterval(async()=>{
    if(document.hidden) return;
    const ae=document.activeElement;
    if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT')) return;
    if(!$('emod').classList.contains('h')||!$('nmod').classList.contains('h')) return; // modal otwarty
    try{ await loadTasks(); if(STATE.cur!=='k') renderCur(); }catch(e){}
  },7000);
}

// ═══ AUTH ═══
async function doLogin(){
  const email=$('lg-email').value.trim(), pass=$('lg-pass').value;
  $('lg-err').textContent='';
  if(!email||!pass){$('lg-err').textContent='Podaj e-mail i hasło.';return;}
  $('lg-btn').disabled=true;$('lg-btn').textContent='Loguję...';
  try{ const j=await api('login',{email,password:pass}); await enterApp(j.user); }
  catch(e){ $('lg-err').textContent=e.message; }
  finally{ $('lg-btn').disabled=false;$('lg-btn').textContent='Zaloguj'; }
}
async function doLogout(){ try{ await api('logout',{}); }catch{} location.reload(); }

async function enterApp(user){
  STATE.me=user; STATE.role=user.role;
  try{ const j=await api('bootstrap'); setProfiles(j.users); STATE.tasks=j.tasks||[]; STATE.logs=j.logs||[]; }
  catch(e){ gsStatus('⚠ '+e.message); }
  $('me-name').textContent=user.name||user.email;
  const rp=$('me-role'); rp.textContent=isSup()?'admin':'pracownik'; rp.className='role-pill '+(isSup()?'sup':'wrk');
  const cfg=$('cfgBtn'); if(cfg) cfg.classList.toggle('h',!isSup());
  $('login').classList.add('h'); $('app').classList.remove('h');
  go('a'); startPolling(); gsStatus('✓ Połączono');
}

// ═══ INIT ═══
(async()=>{
  $('lg-pass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  try{ const j=await api('me'); if(j.user) await enterApp(j.user); }catch(e){}
})();
