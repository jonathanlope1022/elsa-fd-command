const APPARATUS=[
["Delta 1","Command",0,false],["Delta 2","Command",0,false],["Delta 3","Command",0,false],
["Truck 1","Truck",500,false],["Rescue 2","Rescue",750,false],["Squad 3","Squad",500,false],
["Brush 4","Brush",0,true],["Brush 5","Brush",0,true],["Brush 6","Brush",0,true],
["Tank 7","Tanker",3000,false],["Brush 8","Brush",0,true],["Utility 1","Utility",0,false]
];
const BASE_ASSIGNMENTS=["Incident Command","Safety","Operations","Staging Officer","Staging","Fire Attack","Primary Search","Secondary Search","Ventilation","Roof Division","Division A","Division B","Division C","Division D","Exposure 1","Exposure 2","Water Supply","Tanker Shuttle","RIT","Rapid Intervention","Rehab","Medical","Traffic Control","Investigation","Salvage","Overhaul","Accountability","Logistics","Planning","Public Information","Liaison","Brush Operations","Drone Operations","Other"];
const BENCHMARK_GROUPS={
"Search":["Primary Search Started","Primary Search Complete","Secondary Search Started","Secondary Search Complete"],
"Fire Operations":["Fire Attack","Ventilation Started","Ventilation Complete","Overhaul Started","Overhaul Complete","Control Time"],
"Utilities":["Water Shut Off","Power Company Requested","Power Disconnected","Gas Company Notified","Gas Company On Scene"],
"EMS":["EMS Requested","EMS On Scene"],
"Investigation":["Fire Marshal Notified","Fire Marshal On Scene"]
};
const DEPENDENCIES={
"Primary Search Complete":"Primary Search Started","Secondary Search Complete":"Secondary Search Started",
"Ventilation Complete":"Ventilation Started","Overhaul Complete":"Overhaul Started"
};
const $=id=>document.getElementById(id);
let state={units:{},mutualAid:[],benchmarks:{},timeline:[],logs:[],startTime:null,parDueAt:null,parCycle:1,parInProgress:false,customAssignments:[],fields:{},recentAddresses:[],favoriteAddresses:[]};
let activeUnit=null,activeMutualAid=null,activeBenchmark=null,assignmentTarget=null,audioCtx=null,alarmInterval=null,alarmStartedAt=null,timelineFilter="All",playbackEvents=[],playbackIndex=0,playbackTimer=null;

function defaults(){
  const units={};APPARATUS.forEach(([n,t,w,m])=>units[n]={type:t,status:"Not Responding",personnel:0,assignment:"",water:w,manualWater:m,par:"Pending",lastUpdated:null});
  return {units,mutualAid:[],benchmarks:{},timeline:[],logs:[],startTime:null,parDueAt:null,parCycle:1,parInProgress:false,customAssignments:[],fields:{},recentAddresses:[],favoriteAddresses:[]};
}
function nowTime(){return new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
function isoNow(){return new Date().toISOString()}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function formatClock(ms){
  let s=Math.max(0,Math.floor(ms/1000)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return [h,m,sec].map(v=>String(v).padStart(2,"0")).join(":")
}
function timeFromISO(v){return new Date(v).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
function categoryFor(name){for(const [cat,items] of Object.entries(BENCHMARK_GROUPS))if(items.includes(name))return cat;return"Other"}

function init(){
  state=defaults();load();
  bindFields();renderAssignments();renderUnits();renderBenchmarks();renderMutualAid();renderTimeline();renderLog();renderCommandAssignments();renderResourceBoards();updateMetrics();updateTimers();
  renderAssignmentPicker("unitAssignment","unitAssignmentOptions");renderAssignmentPicker("maAssignment","maAssignmentOptions");renderAssignmentPicker("editMaAssignment","editMaAssignmentOptions");setInterval(updateTimers,1000);
}
function bindFields(){
  const ids=["address","caseNo","incidentType","otherIncidentType","waterMethod","waterUnit","hydrantLocation","fillSite","dumpSite","waterNotes","occReported","occLocated","rescued","patients","transported","unaccounted","canConditions","canActions","canNeeds"];
  ids.forEach(id=>$(id).addEventListener("input",()=>{save(false);updateMetrics()}));
  $("incidentType").addEventListener("change",()=>{$("otherIncidentType").classList.toggle("hidden",$("incidentType").value!=="Other");updateHeader();save(false)});
  $("otherIncidentType").addEventListener("input",updateHeader);
  ["canConditions","canActions","canNeeds"].forEach(id=>enableBullets($(id)));
}
function enableBullets(el){
  el.addEventListener("keydown",e=>{
    if(e.key==="Enter"){
      e.preventDefault();const s=el.selectionStart,en=el.selectionEnd;el.value=el.value.slice(0,s)+"\n• "+el.value.slice(en);el.selectionStart=el.selectionEnd=s+3;save(false)
    }else if(e.key==="Backspace"){
      const s=el.selectionStart;if(s>=2&&el.value.slice(s-2,s)==="• "&&(s===2||el.value[s-3]==="\n")){e.preventDefault();const cut=s===2?2:3;el.value=el.value.slice(0,s-cut)+el.value.slice(s);el.selectionStart=el.selectionEnd=s-cut;save(false)}
    }
  });
}
function collectFields(){
  const o={};["address","caseNo","incidentType","otherIncidentType","waterMethod","waterUnit","hydrantLocation","fillSite","dumpSite","waterNotes","occReported","occLocated","rescued","patients","transported","unaccounted","canConditions","canActions","canNeeds"].forEach(id=>o[id]=$(id).value);return o
}
function save(show=true){state.fields=collectFields();localStorage.setItem("elsaFDCommandV24",JSON.stringify(state));if(show)alert("Incident saved on this device.")}
function load(){
  try{
    const raw=localStorage.getItem("elsaFDCommandV24");if(raw){const saved=JSON.parse(raw);state={...defaults(),...saved,units:{...defaults().units,...(saved.units||{})}}}
  }catch(e){console.error(e)}
  Object.entries(state.fields||{}).forEach(([k,v])=>{if($(k))$(k).value=v});
  $("otherIncidentType").classList.toggle("hidden",$("incidentType").value!=="Other")
}
function addLog(text,category="Command"){state.logs.unshift({time:isoNow(),text,category});renderLog();save(false)}
function addTimeline(name,category,note="",time=isoNow()){state.timeline.push({id:crypto.randomUUID(),name,category,note,time});state.timeline.sort((a,b)=>new Date(a.time)-new Date(b.time));renderTimeline();save(false)}

function normalizeAddress(v){return String(v||"").trim().replace(/\s+/g," ")}
function rememberAddress(v){
  const address=normalizeAddress(v);if(!address)return;
  state.recentAddresses=[address,...(state.recentAddresses||[]).filter(x=>x.toLowerCase()!==address.toLowerCase())].slice(0,20);
  save(false)
}
function saveFavoriteAddress(){
  const address=normalizeAddress($("address").value);if(!address)return alert("Enter an address or location first.");
  if(!(state.favoriteAddresses||[]).some(x=>x.toLowerCase()===address.toLowerCase()))state.favoriteAddresses.push(address);
  save(false);showAddressChoices("favorites")
}
function addressMatches(query){
  const q=normalizeAddress(query).toLowerCase();
  const favorites=(state.favoriteAddresses||[]).filter(x=>!q||x.toLowerCase().includes(q));
  const recents=(state.recentAddresses||[]).filter(x=>!q||x.toLowerCase().includes(q));
  return{favorites,recents}
}
function renderAddressSuggestions(mode="search"){
  const q=mode==="search"?$("address").value:"";
  const {favorites,recents}=addressMatches(q);
  const groups=[];
  if(favorites.length)groups.push({name:"Favorite Locations",items:favorites,kind:"favorite"});
  if(recents.length)groups.push({name:"Recent Locations",items:recents,kind:"recent"});
  const box=$("addressSuggestions");
  if(!groups.length){box.innerHTML='<div class="empty">No saved locations yet.</div>';box.classList.remove("hidden");return}
  box.innerHTML=groups.map(g=>`<div class="address-group-title">${g.name}</div>${g.items.map(a=>`<div class="address-option" tabindex="0" data-address="${esc(a)}"><b>${esc(a)}</b><span>${g.kind==="favorite"?"Favorite location":"Recent incident location"}</span></div>`).join("")}`).join("");
  box.classList.remove("hidden");
  box.querySelectorAll("[data-address]").forEach(el=>{
    const choose=()=>{$("address").value=el.dataset.address;box.classList.add("hidden");save(false)};
    el.addEventListener("click",choose);el.addEventListener("keydown",e=>{if(e.key==="Enter")choose()})
  })
}
function showAddressChoices(mode){renderAddressSuggestions(mode)}

function startIncident(){
  if(state.startTime){alert("The incident timer is already running.");return}
  ensureAudio();state.startTime=Date.now();rememberAddress($("address").value.trim());state.parDueAt=Date.now()+15*60*1000;state.parCycle=1;state.parInProgress=false;
  addLog("Incident timer started","Command");addTimeline("Incident Started","Command");save(false);updateTimers()
}
function updateHeader(){
  const type=$("incidentType").value==="Other"?($("otherIncidentType").value.trim()||"Other Incident"):$("incidentType").value;
  $("headerSubtitle").textContent=state.startTime?`${type} • Active`:"Incident Command System • No Active Incident";
}
function updateTimers(){
  updateHeader();
  $("incidentTimer").textContent=state.startTime?formatClock(Date.now()-Number(state.startTime)):"00:00:00";
  $("parCycle").textContent=`PAR Cycle ${state.parCycle||1}`;
  const el=$("parTimer");
  if(!state.startTime){el.textContent="15:00";el.classList.remove("par-due");return}
  if(state.parInProgress){el.textContent="IN PROGRESS";el.classList.remove("par-due");stopAlarm();return}
  const r=Math.floor((Number(state.parDueAt)-Date.now())/1000);
  if(r<=0){
    el.textContent="PAR DUE";el.classList.add("par-due");startAlarm();
    if(alarmStartedAt&&Date.now()-alarmStartedAt>=30000)document.querySelector(".command-strip-inner").classList.add("alarm-escalated")
  }
  else{el.textContent=`${String(Math.floor(r/60)).padStart(2,"0")}:${String(r%60).padStart(2,"0")}`;el.classList.remove("par-due");stopAlarm()}
}
function ensureAudio(){try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume()}catch(e){}}
function tone(freq=1100,duration=.16,delay=0){
  ensureAudio();if(!audioCtx)return;
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type="square";o.frequency.value=freq;
  g.gain.setValueAtTime(.0001,audioCtx.currentTime+delay);
  g.gain.exponentialRampToValueAtTime(.24,audioCtx.currentTime+delay+.015);
  g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+delay+duration);
  o.connect(g);g.connect(audioCtx.destination);o.start(audioCtx.currentTime+delay);o.stop(audioCtx.currentTime+delay+duration+.02)
}
function urgentBurst(){
  tone(1150,.14,0);tone(1150,.14,.21);tone(1450,.18,.42);
  if(navigator.vibrate)navigator.vibrate([220,80,220,80,300])
}
function startAlarm(){
  if(alarmInterval)return;
  alarmStartedAt=Date.now();urgentBurst();
  alarmInterval=setInterval(urgentBurst,2000)
}
function stopAlarm(){
  if(alarmInterval){clearInterval(alarmInterval);alarmInterval=null}
  alarmStartedAt=null;
  const strip=document.querySelector(".command-strip-inner");if(strip)strip.classList.remove("alarm-escalated")
}
function startPAR(){
  if(!state.startTime)return alert("Start the incident first.");ensureAudio();state.parInProgress=true;stopAlarm();
  addLog(`PAR #${state.parCycle} Initiated — Elapsed ${formatClock(Date.now()-state.startTime)}`,"Accountability");save(false);updateTimers()
}
function completePAR(){
  if(!state.startTime)return alert("Start the incident first.");ensureAudio();
  addLog(`PAR #${state.parCycle} Complete — Elapsed ${formatClock(Date.now()-state.startTime)}`,"Accountability");
  state.parCycle=(state.parCycle||1)+1;state.parInProgress=false;state.parDueAt=Date.now()+15*60*1000;save(false);updateTimers()
}

function allAssignments(){
  return [...new Set([...BASE_ASSIGNMENTS.filter(x=>x!=="Other"),...(state.customAssignments||[])])];
}
function renderAssignmentPicker(inputId,containerId){
  const input=$(inputId),box=$(containerId);if(!input||!box)return;
  const query=input.value.trim().toLowerCase();
  const current=input.value.trim();
  const choices=allAssignments().filter(v=>!query||v.toLowerCase().includes(query));
  box.innerHTML=[
    `<button type="button" class="assignment-choice clear" data-assignment-value="">Clear / Unassigned</button>`,
    ...choices.map(v=>`<button type="button" class="assignment-choice ${current===v?"selected":""}" data-assignment-value="${esc(v)}">${esc(v)}</button>`),
    `<button type="button" class="assignment-choice custom" data-assignment-custom="1">Other / Custom</button>`
  ].join("");
  box.querySelectorAll("[data-assignment-value]").forEach(b=>b.onclick=()=>{
    input.value=b.dataset.assignmentValue;
    renderAssignmentPicker(inputId,containerId)
  });
  const custom=box.querySelector("[data-assignment-custom]");
  if(custom)custom.onclick=()=>{
    assignmentTarget={input,target:inputId};
    $("customAssignmentModal").classList.remove("hidden");
    $("customAssignmentInput").value="";
    $("customAssignmentInput").focus()
  }
}
function bindAssignmentPicker(inputId,containerId){
  const input=$(inputId);if(!input)return;
  input.addEventListener("input",()=>renderAssignmentPicker(inputId,containerId));
  input.addEventListener("focus",()=>renderAssignmentPicker(inputId,containerId));
}

function renderAssignments(){
  const values=[...new Set([...BASE_ASSIGNMENTS,...(state.customAssignments||[])])];
  $("assignmentList").innerHTML=values.map(v=>`<option value="${esc(v)}"></option>`).join("");
  const waterUnits=[...Object.keys(state.units),...(state.mutualAid||[]).map(m=>`${m.department} ${m.unit}`.trim())];
  $("waterUnitList").innerHTML=waterUnits.map(v=>`<option value="${esc(v)}"></option>`).join("");
  renderAssignmentPicker("unitAssignment","unitAssignmentOptions");
  renderAssignmentPicker("maAssignment","maAssignmentOptions");
  renderAssignmentPicker("editMaAssignment","editMaAssignmentOptions")
}
function assignmentChanged(input,target){
  if(input.value==="Other"){assignmentTarget={input,target};$("customAssignmentModal").classList.remove("hidden");$("customAssignmentInput").value="";$("customAssignmentInput").focus()}
}
function renderCommandAssignments(){
  const roles=["Incident Command","Safety","Operations","Staging Officer"];
  $("commandAssignments").innerHTML=roles.map(role=>{
    const list=[];Object.entries(state.units).forEach(([n,u])=>u.assignment===role&&list.push(n));state.mutualAid.forEach(m=>m.assignment===role&&list.push(`${m.department} ${m.unit}`.trim()));
    return`<div class="assignment-summary"><b>${role}</b>${esc(list.join(", ")||"Unassigned")}</div>`
  }).join("")
}
function renderUnits(){
  $("units").innerHTML="";Object.entries(state.units).forEach(([n,u])=>{
    const d=document.createElement("div");d.className=`unit-card ${u.status.replaceAll(" ","")}`;
    d.innerHTML=`<h4>${esc(n)}</h4><p>${esc(u.type)}</p><p>Status: <b>${esc(u.status)}</b></p><p>Assignment: ${esc(u.assignment||"—")}</p><p>Personnel: ${u.personnel}</p><p>Water: ${u.water} gal</p><p>PAR: ${esc(u.par)}</p><div class="last-updated">Last Updated: ${u.lastUpdated?timeFromISO(u.lastUpdated):"—"}</div>`;
    d.onclick=()=>openUnit(n);$("units").appendChild(d)
  });renderCommandAssignments();renderResourceBoards();updateMetrics()
}
function openUnit(n){
  activeUnit=n;const u=state.units[n];$("unitModalTitle").textContent=n;$("unitStatus").value=u.status;$("unitPersonnel").value=u.personnel;$("unitAssignment").value=u.assignment;$("unitWater").value=u.water;$("unitWater").disabled=!u.manualWater;$("unitPar").value=u.par;renderAssignmentPicker("unitAssignment","unitAssignmentOptions");$("unitModal").classList.remove("hidden")
}
function saveUnit(){
  const old=state.units[activeUnit],u={...old,status:$("unitStatus").value,personnel:+$("unitPersonnel").value||0,assignment:$("unitAssignment").value.trim(),par:$("unitPar").value,lastUpdated:isoNow()};
    if(u.manualWater)u.water=+$("unitWater").value||0;state.units[activeUnit]=u;
  if(u.assignment!==old.assignment)addLog(`${activeUnit} assignment changed: ${old.assignment||"Unassigned"} → ${u.assignment||"Unassigned"}`,"Resources");
  if(u.status!==old.status)addLog(`${activeUnit} status changed: ${old.status} → ${u.status}`,"Resources");
  $("unitModal").classList.add("hidden");renderUnits();save(false)
}
function renderBenchmarks(){
  $("benchmarkGroups").innerHTML=Object.entries(BENCHMARK_GROUPS).map(([group,items])=>`<div class="benchmark-group"><h4>${group}</h4>${items.map(name=>{
    const b=state.benchmarks[name],cls=b?(name.includes("Started")||name.includes("Requested")||name.includes("Notified")?"started":"complete"):"";
    return`<button class="benchmark-btn ${cls}" data-benchmark="${esc(name)}">${esc(name)}${b?`<span class="stamp">${timeFromISO(b.time)}${b.note?" • "+esc(b.note):""}</span>`:""}</button>`
  }).join("")}</div>`).join("");
  document.querySelectorAll("[data-benchmark]").forEach(btn=>btn.onclick=()=>handleBenchmark(btn.dataset.benchmark))
}
function handleBenchmark(name){
  if(state.benchmarks[name]){openBenchmarkEdit(name);return}
  const dep=DEPENDENCIES[name];if(dep&&!state.benchmarks[dep]){
    if(confirm(`${dep} has not been logged. Mark it started now?`))completeBenchmark(dep);else return
  }
  if(name==="Power Company Requested"){$("companyModal").classList.remove("hidden");return}
  if(name==="Fire Attack"){$("fireAttackModal").classList.remove("hidden");return}
  if(name==="EMS On Scene"){$("emsModal").classList.remove("hidden");return}
  completeBenchmark(name)
}
function completeBenchmark(name,note=""){
  const time=isoNow();state.benchmarks[name]={time,note};addTimeline(name,categoryFor(name),note,time);addLog(`${name}${note?" — "+note:""}`,categoryFor(name));renderBenchmarks()
}
function openBenchmarkEdit(name){
  activeBenchmark=name;const b=state.benchmarks[name];$("benchmarkModalTitle").textContent=name;$("benchmarkTime").value=new Date(b.time).toTimeString().slice(0,8);$("benchmarkNote").value=b.note||"";$("benchmarkModal").classList.remove("hidden")
}
function saveBenchmarkEdit(){
  const b=state.benchmarks[activeBenchmark],d=new Date(b.time),parts=$("benchmarkTime").value.split(":");d.setHours(+parts[0],+parts[1],+(parts[2]||0));b.time=d.toISOString();b.note=$("benchmarkNote").value.trim();
  const t=state.timeline.find(x=>x.name===activeBenchmark);if(t){t.time=b.time;t.note=b.note}state.timeline.sort((a,b)=>new Date(a.time)-new Date(b.time));$("benchmarkModal").classList.add("hidden");renderBenchmarks();renderTimeline();save(false)
}
function removeBenchmark(){
  delete state.benchmarks[activeBenchmark];state.timeline=state.timeline.filter(x=>x.name!==activeBenchmark);$("benchmarkModal").classList.add("hidden");renderBenchmarks();renderTimeline();save(false)
}
function renderTimeline(){
  const cats=["All",...new Set(state.timeline.map(x=>x.category))];$("timelineFilters").innerHTML=cats.map(c=>`<button class="filter-btn ${timelineFilter===c?"active":""}" data-filter="${esc(c)}">${esc(c)}</button>`).join("");
  document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{timelineFilter=b.dataset.filter;renderTimeline()});
  const arr=state.timeline.filter(x=>timelineFilter==="All"||x.category===timelineFilter);
  $("timeline").innerHTML=arr.length?arr.map(x=>`<div class="timeline-entry"><span class="timeline-actions"><button class="btn light small" data-edit-t="${x.id}">Edit</button><button class="btn light small" data-del-t="${x.id}">Remove</button></span><b>${esc(x.name)}</b><time>${new Date(x.time).toLocaleString()}${x.note?" • "+esc(x.note):""}</time></div>`).join(""):'<div class="empty">No timeline entries.</div>';
  document.querySelectorAll("[data-del-t]").forEach(b=>b.onclick=()=>{state.timeline=state.timeline.filter(x=>x.id!==b.dataset.delT);renderTimeline();save(false)});
  document.querySelectorAll("[data-edit-t]").forEach(b=>b.onclick=()=>{const x=state.timeline.find(v=>v.id===b.dataset.editT),n=prompt("Edit timeline note:",x.note||"");if(n!==null){x.note=n;renderTimeline();save(false)}})
}
function addMutualAid(){
  const assignment=$("maAssignment").value.trim();
  const m={id:crypto.randomUUID(),department:$("maDept").value.trim(),unit:$("maUnit").value.trim(),type:$("maType").value,status:$("maStatus").value,personnel:+$("maPersonnel").value||0,gallons:+$("maGallons").value||0,assignment,lastUpdated:isoNow()};
  if(!m.department&&!m.unit)return;state.mutualAid.push(m);addLog(`Mutual aid added: ${m.department} ${m.unit}`.trim(),"Mutual Aid");["maDept","maUnit","maPersonnel","maGallons","maAssignment"].forEach(id=>$(id).value=id.includes("Personnel")||id.includes("Gallons")?"0":"");renderAssignmentPicker("maAssignment","maAssignmentOptions");renderMutualAid();save(false)
}
function renderMutualAid(){
  $("maBody").innerHTML=state.mutualAid.map(m=>`<tr><td>${esc(m.department)}</td><td>${esc(m.unit)}</td><td>${esc(m.type)}</td><td>${esc(m.status)}</td><td>${m.personnel}</td><td>${m.gallons}</td><td>${esc(m.assignment||"—")}<div class="last-updated">${m.lastUpdated?"Updated "+timeFromISO(m.lastUpdated):""}</div></td><td><button class="btn light small" data-edit-ma="${m.id}">Edit</button> <button class="btn light small" data-remove-ma="${m.id}">Remove</button></td></tr>`).join("");
  document.querySelectorAll("[data-edit-ma]").forEach(b=>b.onclick=()=>openMutualAidEdit(b.dataset.editMa));
  document.querySelectorAll("[data-remove-ma]").forEach(b=>b.onclick=()=>{state.mutualAid=state.mutualAid.filter(m=>m.id!==b.dataset.removeMa);renderMutualAid();save(false)});
  renderAssignments();renderCommandAssignments();renderResourceBoards();updateMetrics()
}
function openMutualAidEdit(id){
  activeMutualAid=id;const m=state.mutualAid.find(x=>x.id===id);if(!m)return;
  $("mutualAidEditTitle").textContent=`${m.department} ${m.unit}`.trim();
  $("editMaStatus").value=m.status;$("editMaPersonnel").value=m.personnel;$("editMaGallons").value=m.gallons;$("editMaAssignment").value=m.assignment||"";renderAssignmentPicker("editMaAssignment","editMaAssignmentOptions");
  $("mutualAidEditModal").classList.remove("hidden")
}
function saveMutualAidEdit(){
  const i=state.mutualAid.findIndex(x=>x.id===activeMutualAid);if(i<0)return;
  const old=state.mutualAid[i],assignment=$("editMaAssignment").value.trim();
    const m={...old,status:$("editMaStatus").value,personnel:+$("editMaPersonnel").value||0,gallons:+$("editMaGallons").value||0,assignment,lastUpdated:isoNow()};
  state.mutualAid[i]=m;
  if(m.assignment!==old.assignment)addLog(`${m.department} ${m.unit} assignment changed: ${old.assignment||"Unassigned"} → ${m.assignment||"Unassigned"}`.trim(),"Resources");
  if(m.status!==old.status)addLog(`${m.department} ${m.unit} status changed: ${old.status} → ${m.status}`.trim(),"Resources");
  $("mutualAidEditModal").classList.add("hidden");renderMutualAid();save(false)
}
function renderResourceBoards(){
  const boards={Staging:[],Rehab:[]};
  Object.entries(state.units).forEach(([name,u])=>{if(boards[u.assignment])boards[u.assignment].push({kind:"elsa",id:name,name,meta:`${u.status} • ${u.personnel} personnel`})});
  state.mutualAid.forEach(m=>{if(boards[m.assignment])boards[m.assignment].push({kind:"ma",id:m.id,name:`${m.department} ${m.unit}`.trim(),meta:`${m.status} • ${m.personnel} personnel`})});
  renderBoard("stagingBoard","stagingCount",boards.Staging);
  renderBoard("rehabBoard","rehabCount",boards.Rehab)
}
function renderBoard(boardId,countId,items){
  $(countId).textContent=`(${items.length})`;
  $(boardId).innerHTML=items.length?items.map(x=>`<div class="resource-board-card"><div><b>${esc(x.name)}</b><div class="meta">${esc(x.meta)}</div></div><div class="quick-actions"><button class="btn primary small" data-reassign-kind="${x.kind}" data-reassign-id="${esc(x.id)}">Reassign</button></div></div>`).join(""):'<div class="empty">No units assigned.</div>';
  document.querySelectorAll(`#${boardId} [data-reassign-kind]`).forEach(b=>b.onclick=()=>b.dataset.reassignKind==="elsa"?openUnit(b.dataset.reassignId):openMutualAidEdit(b.dataset.reassignId))
}
function waterTotals(){
  const elsa=Object.values(state.units).filter(u=>u.status==="On Scene").reduce((s,u)=>s+(+u.water||0),0);
  const mutual=state.mutualAid.filter(m=>m.status==="On Scene").reduce((s,m)=>s+(+m.gallons||0),0);
  const enroute=Object.values(state.units).filter(u=>u.status==="Responding").reduce((s,u)=>s+(+u.water||0),0)+state.mutualAid.filter(m=>m.status==="Responding").reduce((s,m)=>s+(+m.gallons||0),0);
  return{elsa,mutual,total:elsa+mutual,enroute}
}
function updateMetrics(){
  const active=Object.values(state.units).filter(u=>!["Not Responding","Released"].includes(u.status));
  const personnel=active.reduce((s,u)=>s+(+u.personnel||0),0)+state.mutualAid.filter(m=>m.status!=="Released").reduce((s,m)=>s+(+m.personnel||0),0);
  const w=waterTotals();$("mPersonnel").textContent=personnel;$("mUnits").textContent=active.length;$("mWater").textContent=w.total;$("mMutual").textContent=state.mutualAid.length;$("mPatients").textContent=+$("patients").value||0;$("mMissing").textContent=+$("unaccounted").value||0;$("mWaterEnroute").textContent=w.enroute;
  $("elsaWater").textContent=w.elsa;$("mutualWater").textContent=w.mutual;$("totalWater").textContent=w.total;$("enrouteWater").textContent=w.enroute
}
function renderLog(){
  $("commandLog").innerHTML=state.logs.length?state.logs.map(l=>`<div class="log-entry"><b>${timeFromISO(l.time)}</b><span>${esc(l.text)}</span></div>`).join(""):'<div class="empty" style="margin-top:10px">No command-log entries.</div>'
}

function buildPlaybackEvents(){
  const events=[];
  (state.timeline||[]).forEach(t=>events.push({time:t.time,name:t.name,note:t.note||"",category:t.category||"Command"}));
  (state.logs||[]).forEach(l=>events.push({time:l.time,name:l.text,note:"",category:l.category||"Command"}));
  const seen=new Set();
  return events.filter(e=>{
    const key=`${e.time}|${e.name}`;if(seen.has(key))return false;seen.add(key);return true
  }).sort((a,b)=>new Date(a.time)-new Date(b.time))
}
function playbackClass(category){
  const c=String(category||"").toLowerCase();
  if(c.includes("fire"))return"fire";if(c.includes("account"))return"accountability";if(c.includes("util"))return"utilities";
  if(c.includes("ems"))return"ems";if(c.includes("resource")||c.includes("mutual"))return"resources";return""
}
function elapsedAt(time){
  if(!state.startTime)return"00:00:00";
  return formatClock(new Date(time).getTime()-Number(state.startTime))
}
function openPlayback(){
  playbackEvents=buildPlaybackEvents();playbackIndex=0;stopPlayback();
  $("playbackModal").classList.remove("hidden");renderPlayback()
}
function renderPlayback(){
  $("playbackPosition").textContent=playbackEvents.length?`${playbackIndex+1} / ${playbackEvents.length}`:"0 / 0";
  $("playbackSpeedLabel").textContent=`${$("playbackSpeed").value}×`;
  if(!playbackEvents.length){
    $("playbackElapsed").textContent="00:00:00";$("playbackCurrent").className="playback-current empty";$("playbackCurrent").textContent="No recorded events yet.";$("playbackEventList").innerHTML="";return
  }
  const e=playbackEvents[playbackIndex];
  $("playbackElapsed").textContent=elapsedAt(e.time);
  $("playbackCurrent").className="playback-current";
  $("playbackCurrent").innerHTML=`<div class="event-time">${timeFromISO(e.time)}</div><div class="event-name">${esc(e.name)}</div><div class="event-note">${esc(e.note||e.category||"")}</div>`;
  $("playbackEventList").innerHTML=playbackEvents.map((x,i)=>`<div class="playback-item ${playbackClass(x.category)} ${i===playbackIndex?"active":""}" data-play-index="${i}"><b>${esc(x.name)}</b><time>${timeFromISO(x.time)} • Elapsed ${elapsedAt(x.time)}${x.note?" • "+esc(x.note):""}</time></div>`).join("");
  $("playbackEventList").querySelectorAll("[data-play-index]").forEach(el=>el.onclick=()=>{playbackIndex=+el.dataset.playIndex;renderPlayback()});
  const active=$("playbackEventList").querySelector(".active");if(active)active.scrollIntoView({block:"nearest"})
}
function playbackStep(delta){
  if(!playbackEvents.length)return;
  playbackIndex=Math.max(0,Math.min(playbackEvents.length-1,playbackIndex+delta));renderPlayback()
}
function startPlayback(){
  if(!playbackEvents.length)return;
  stopPlayback();$("playbackPlayBtn").textContent="⏸ Pause";
  const speed=+$("playbackSpeed").value||1;
  playbackTimer=setInterval(()=>{
    if(playbackIndex>=playbackEvents.length-1){stopPlayback();return}
    playbackIndex++;renderPlayback()
  },Math.max(350,1800/speed))
}
function stopPlayback(){
  if(playbackTimer){clearInterval(playbackTimer);playbackTimer=null}
  if($("playbackPlayBtn"))$("playbackPlayBtn").textContent="▶ Play"
}
function togglePlayback(){playbackTimer?stopPlayback():startPlayback()}

function resetIncident(){if(confirm("Clear all incident data and start a new incident?")){stopAlarm();localStorage.removeItem("elsaFDCommandV24");location.reload()}}

$("startIncidentBtn").onclick=startIncident;$("saveBtn").onclick=()=>save(true);$("newIncidentBtn").onclick=resetIncident;$("startParBtn").onclick=startPAR;$("completeParBtn").onclick=completePAR;
$("addLogBtn").onclick=()=>{const t=$("logInput").value.trim();if(t){addLog(t);$("logInput").value=""}};$("logInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("addLogBtn").click()});
$("addMaBtn").onclick=addMutualAid;bindAssignmentPicker("maAssignment","maAssignmentOptions");bindAssignmentPicker("unitAssignment","unitAssignmentOptions");
$("cancelUnitBtn").onclick=()=>$("unitModal").classList.add("hidden");$("saveUnitBtn").onclick=saveUnit;
$("cancelCustomBtn").onclick=()=>$("customAssignmentModal").classList.add("hidden");$("saveCustomBtn").onclick=()=>{
  const v=$("customAssignmentInput").value.trim();if(!v)return;
  if(!state.customAssignments.includes(v))state.customAssignments.push(v);
  assignmentTarget.input.value=v;
  $("customAssignmentModal").classList.add("hidden");
  renderAssignments();
  if(assignmentTarget.target==="unitAssignment")renderAssignmentPicker("unitAssignment","unitAssignmentOptions");
  if(assignmentTarget.target==="maAssignment")renderAssignmentPicker("maAssignment","maAssignmentOptions");
  if(assignmentTarget.target==="editMaAssignment")renderAssignmentPicker("editMaAssignment","editMaAssignmentOptions");
  save(false)
};
$("cancelBenchmarkBtn").onclick=()=>$("benchmarkModal").classList.add("hidden");$("saveBenchmarkBtn").onclick=saveBenchmarkEdit;$("removeBenchmarkBtn").onclick=removeBenchmark;
$("cancelCompanyBtn").onclick=()=>$("companyModal").classList.add("hidden");$("saveCompanyBtn").onclick=()=>{completeBenchmark("Power Company Requested",$("powerCompany").value);$("companyModal").classList.add("hidden")};
$("cancelFireAttackBtn").onclick=()=>$("fireAttackModal").classList.add("hidden");
$("saveFireAttackBtn").onclick=()=>{completeBenchmark("Fire Attack",$("fireAttackMode").value);$("fireAttackModal").classList.add("hidden")};
$("cancelEmsBtn").onclick=()=>$("emsModal").classList.add("hidden");
$("saveEmsBtn").onclick=()=>{const agency=$("emsAgency").value.trim(),unit=$("emsUnitNumber").value.trim();if(!agency&&!unit)return alert("Enter an EMS agency or unit number.");completeBenchmark("EMS On Scene",[agency,unit].filter(Boolean).join(" — "));$("emsModal").classList.add("hidden")};
$("cancelMaEditBtn").onclick=()=>$("mutualAidEditModal").classList.add("hidden");
$("saveMaEditBtn").onclick=saveMutualAidEdit;
bindAssignmentPicker("editMaAssignment","editMaAssignmentOptions");

try {
  
$("address").addEventListener("input",()=>renderAddressSuggestions("search"));
$("address").addEventListener("focus",()=>renderAddressSuggestions("search"));
$("showRecentBtn").onclick=()=>showAddressChoices("recent");
$("showFavoritesBtn").onclick=()=>showAddressChoices("favorites");
$("saveFavoriteBtn").onclick=saveFavoriteAddress;
document.addEventListener("click",e=>{if(!e.target.closest(".smart-address-card"))$("addressSuggestions").classList.add("hidden")});
$("playbackBtn").onclick=openPlayback;
$("closePlaybackBtn").onclick=()=>{$("playbackModal").classList.add("hidden");stopPlayback()};
$("playbackBeginningBtn").onclick=()=>{playbackIndex=0;renderPlayback()};
$("playbackPrevBtn").onclick=()=>playbackStep(-1);
$("playbackPlayBtn").onclick=togglePlayback;
$("playbackNextBtn").onclick=()=>playbackStep(1);
$("playbackEndBtn").onclick=()=>{if(playbackEvents.length){playbackIndex=playbackEvents.length-1;renderPlayback()}};
$("playbackSpeed").onchange=()=>{renderPlayback();if(playbackTimer)startPlayback()};

init();
  window.EFD_APP_READY = true;
} catch (error) {
  console.error("Elsa FD Command failed to initialize:", error);
  window.EFD_APP_READY = false;
  window.addEventListener("load", function () {
    const box = document.getElementById("loadError");
    if (box) {
      box.classList.remove("hidden");
      box.innerHTML = "<strong>The command board could not load.</strong><br>Error: " +
        String(error && error.message ? error.message : error);
    }
  });
}