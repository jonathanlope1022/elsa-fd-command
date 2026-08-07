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
let state={units:{},mutualAid:[],benchmarks:{},timeline:[],logs:[],startTime:null,parDueAt:null,parCycle:1,parInProgress:false,customAssignments:[],fields:{},recentAddresses:[],favoriteAddresses:[],closed:false,closedAt:null,locked:false,firegroundMode:false,mayday:null};
let activeUnit=null,activeMutualAid=null,activeBenchmark=null,assignmentTarget=null,audioCtx=null,alarmInterval=null,alarmStartedAt=null,audioUnlocked=false,timelineFilter="All",playbackEvents=[],playbackIndex=0,playbackTimer=null,undoStack=[],maydayHoldTimer=null;

function defaults(){
  const units={};APPARATUS.forEach(([n,t,w,m])=>units[n]={type:t,status:"Not Responding",personnel:0,assignment:"",water:w,manualWater:m,par:"Pending",lastUpdated:null});
  return {units,mutualAid:[],benchmarks:{},timeline:[],logs:[],startTime:null,parDueAt:null,parCycle:1,parInProgress:false,customAssignments:[],fields:{},recentAddresses:[],favoriteAddresses:[],closed:false,closedAt:null,locked:false,firegroundMode:false,mayday:null};
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

function renderAll(){renderAssignments();renderUnits();renderBenchmarks();renderMutualAid();renderTimeline();renderLog();renderCommandAssignments();renderDynamicAssignmentBoard();updateMetrics();updateTimers();renderCriticalAlerts();renderMayday();applyBoardModes()}
function init(){
  state=defaults();load();
  bindFields();renderAll();
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
function save(show=true){state.fields=collectFields();const s=$("saveStatus");if(s){s.textContent="Saving…";s.className="save-status saving"}localStorage.setItem("elsaFDCommandV24",JSON.stringify(state));setTimeout(()=>{if(s){s.textContent=`Saved ${nowTime()}`;s.className="save-status saved"}},180);if(show)alert("Incident saved on this device.")}
function snapshotForUndo(label){undoStack.push({label,state:JSON.stringify(state)});if(undoStack.length>20)undoStack.shift();$("undoBtn").disabled=false;$("undoBtn").textContent=`Undo: ${label}`}
function undoLastAction(){const x=undoStack.pop();if(!x)return;state=JSON.parse(x.state);save(false);renderAll();$("undoBtn").disabled=undoStack.length===0;$("undoBtn").textContent=undoStack.length?`Undo: ${undoStack[undoStack.length-1].label}`:"Undo Last Action"}
function load(){
  try{
    const raw=localStorage.getItem("elsaFDCommandV24");if(raw){const saved=JSON.parse(raw);state={...defaults(),...saved,units:{...defaults().units,...(saved.units||{})}}}
  }catch(e){console.error(e)}
  Object.entries(state.fields||{}).forEach(([k,v])=>{if($(k))$(k).value=v});if(state.startTime&&!state.closed)setTimeout(()=>$("recoveryModal").classList.remove("hidden"),250);
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

async function startIncident(){
  await ensureAudio();
  if(state.startTime){alert("The incident timer is already running.");return}
  ensureAudio();state.startTime=Date.now();rememberAddress($("address").value.trim());state.parDueAt=Date.now()+15*60*1000;state.parCycle=1;state.parInProgress=false;
  addLog("Incident timer started","Command");addTimeline("Incident Started","Command");save(false);updateTimers()
}
function updateHeader(){
  const type=$("incidentType").value==="Other"?($("otherIncidentType").value.trim()||"Other Incident"):$("incidentType").value;
  $("headerSubtitle").textContent=state.startTime?`${type} • Active`:"Incident Command System • No Active Incident";
}
function updateTimers(){
  updateHeader();renderMayday();
  $("incidentTimer").textContent=state.startTime?formatClock((state.closed?Number(state.closedAt):Date.now())-Number(state.startTime)):"00:00:00";
  $("parCycle").textContent=`PAR Cycle ${state.parCycle||1}`;
  const el=$("parTimer");
  if(!state.startTime||state.closed){el.textContent=state.closed?"CLOSED":"15:00";el.classList.remove("par-due");return}
  if(state.parInProgress){el.textContent="IN PROGRESS";el.classList.remove("par-due");stopAlarm();return}
  const r=Math.floor((Number(state.parDueAt)-Date.now())/1000);
  if(r<=0){
    el.textContent="PAR DUE";el.classList.add("par-due");startAlarm();
    if(alarmStartedAt&&Date.now()-alarmStartedAt>=30000)document.querySelector(".command-strip-inner").classList.add("alarm-escalated")
  }
  else{el.textContent=`${String(Math.floor(r/60)).padStart(2,"0")}:${String(r%60).padStart(2,"0")}`;el.classList.remove("par-due");stopAlarm()}
}
async function ensureAudio(){
  try{
    audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==="suspended")await audioCtx.resume();
    audioUnlocked=audioCtx.state==="running";
    $("parAudioStatus").textContent=audioUnlocked?"LOUD alarm enabled":"Tap Enable / Test LOUD Alarm";
    return audioUnlocked
  }catch(e){
    audioUnlocked=false;$("parAudioStatus").textContent="Audio unavailable";return false
  }
}
function alarmTone(freq,duration,delay=0){
  if(!audioCtx||audioCtx.state!=="running")return;
  const start=audioCtx.currentTime+delay;
  const master=audioCtx.createGain();
  const compressor=audioCtx.createDynamicsCompressor();
  compressor.threshold.value=-24;
  compressor.knee.value=12;
  compressor.ratio.value=12;
  compressor.attack.value=.002;
  compressor.release.value=.12;
  master.gain.setValueAtTime(.0001,start);
  master.gain.exponentialRampToValueAtTime(.95,start+.008);
  master.gain.setValueAtTime(.95,start+Math.max(.01,duration-.025));
  master.gain.exponentialRampToValueAtTime(.0001,start+duration);
  master.connect(compressor);
  compressor.connect(audioCtx.destination);
  [
    {type:"square",frequency:freq,gain:.62},
    {type:"square",frequency:freq*1.5,gain:.34},
    {type:"sawtooth",frequency:freq*.5,gain:.22}
  ].forEach(layer=>{
    const oscillator=audioCtx.createOscillator();
    const gain=audioCtx.createGain();
    oscillator.type=layer.type;
    oscillator.frequency.setValueAtTime(layer.frequency,start);
    gain.gain.value=layer.gain;
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start+duration+.03)
  })
}
async function urgentBurst(){
  await ensureAudio();
  const pattern=[
    [1550,.19,0.00],[1050,.19,0.22],
    [1550,.19,0.44],[1050,.19,0.66],
    [1550,.22,0.88],[1050,.22,1.13]
  ];
  pattern.forEach(([frequency,duration,delay])=>alarmTone(frequency,duration,delay));
  if(navigator.vibrate)navigator.vibrate([300,70,300,70,300,70,450])
}
async function testParAlarm(){
  const ok=await ensureAudio();
  if(!ok)return alert("Audio could not be enabled. Turn the iPad volume up, disable Silent Mode, and tap again.");
  urgentBurst();$("parAudioStatus").textContent="LOUD alarm enabled and tested"
}
function showParAlert(){$("parAlertOverlay").classList.remove("hidden")}
function hideParAlert(){$("parAlertOverlay").classList.add("hidden")}
function startAlarm(){
  showParAlert();
  if(alarmInterval)return;
  alarmStartedAt=Date.now();urgentBurst();
  alarmInterval=setInterval(urgentBurst,1600)
}
function stopAlarm(){
  if(alarmInterval){clearInterval(alarmInterval);alarmInterval=null}
  alarmStartedAt=null;hideParAlert();
  const strip=document.querySelector(".command-strip-inner");if(strip)strip.classList.remove("alarm-escalated")
}
function startPAR(){
  snapshotForUndo("PAR started");
  if(!state.startTime)return alert("Start the incident first.");ensureAudio();state.parInProgress=true;stopAlarm();
  addLog(`PAR #${state.parCycle} Initiated — Elapsed ${formatClock(Date.now()-state.startTime)}`,"Accountability");save(false);updateTimers()
}
function completePAR(){
  snapshotForUndo("PAR complete");
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
  $("units").innerHTML=Object.entries(state.units).map(([n,u])=>{let cls="";if(u.par==="No Contact")cls="no-contact";else if(u.assignment==="Staging"||u.status==="Staging")cls="staging";else if(u.assignment==="Rehab"||u.status==="Rehab")cls="rehab";else if(u.status==="Responding")cls="responding";else if(!["Not Responding","Released"].includes(u.status))cls="active";return`<button class="compact-unit-button ${cls}" data-unit="${esc(n)}">${esc(n)}</button>`}).join("");document.querySelectorAll("[data-unit]").forEach(b=>b.onclick=()=>openUnit(b.dataset.unit));renderCommandAssignments();renderDynamicAssignmentBoard();updateMetrics();renderCriticalAlerts()
}
function openUnit(n){
  activeUnit=n;const u=state.units[n];$("unitModalTitle").textContent=n;$("unitStatus").value=u.status;$("unitPersonnel").value=u.personnel;$("unitAssignment").value=u.assignment;$("unitWater").value=u.water;$("unitWater").disabled=!u.manualWater;$("unitPar").value=u.par;renderAssignmentPicker("unitAssignment","unitAssignmentOptions");$("unitModal").classList.remove("hidden")
}
function saveUnit(){
  snapshotForUndo("unit change");
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
  snapshotForUndo(name);
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
  snapshotForUndo("add mutual aid");
  const assignment=$("maAssignment").value.trim();
  const m={id:crypto.randomUUID(),department:$("maDept").value.trim(),unit:$("maUnit").value.trim(),type:$("maType").value,status:$("maStatus").value,personnel:+$("maPersonnel").value||0,gallons:+$("maGallons").value||0,assignment,lastUpdated:isoNow()};
  if(!m.department&&!m.unit)return;state.mutualAid.push(m);addLog(`Mutual aid added: ${m.department} ${m.unit}`.trim(),"Mutual Aid");["maDept","maUnit","maPersonnel","maGallons","maAssignment"].forEach(id=>$(id).value=id.includes("Personnel")||id.includes("Gallons")?"0":"");renderAssignmentPicker("maAssignment","maAssignmentOptions");renderMutualAid();save(false)
}
function renderMutualAid(){
  $("maBody").innerHTML=state.mutualAid.map(m=>`<tr><td>${esc(m.department)}</td><td>${esc(m.unit)}</td><td>${esc(m.type)}</td><td>${esc(m.status)}</td><td>${m.personnel}</td><td>${m.gallons}</td><td>${esc(m.assignment||"—")}<div class="last-updated">${m.lastUpdated?"Updated "+timeFromISO(m.lastUpdated):""}</div></td><td><button class="btn light small" data-edit-ma="${m.id}">Edit</button> <button class="btn light small" data-remove-ma="${m.id}">Remove</button></td></tr>`).join("");
  document.querySelectorAll("[data-edit-ma]").forEach(b=>b.onclick=()=>openMutualAidEdit(b.dataset.editMa));
  document.querySelectorAll("[data-remove-ma]").forEach(b=>b.onclick=()=>{state.mutualAid=state.mutualAid.filter(m=>m.id!==b.dataset.removeMa);renderMutualAid();save(false)});
  renderAssignments();renderCommandAssignments();renderDynamicAssignmentBoard();updateMetrics()
}
function openMutualAidEdit(id){
  activeMutualAid=id;const m=state.mutualAid.find(x=>x.id===id);if(!m)return;
  $("mutualAidEditTitle").textContent=`${m.department} ${m.unit}`.trim();
  $("editMaStatus").value=m.status;$("editMaPersonnel").value=m.personnel;$("editMaGallons").value=m.gallons;$("editMaAssignment").value=m.assignment||"";renderAssignmentPicker("editMaAssignment","editMaAssignmentOptions");
  $("mutualAidEditModal").classList.remove("hidden")
}
function saveMutualAidEdit(){
  snapshotForUndo("mutual aid change");
  const i=state.mutualAid.findIndex(x=>x.id===activeMutualAid);if(i<0)return;
  const old=state.mutualAid[i],assignment=$("editMaAssignment").value.trim();
    const m={...old,status:$("editMaStatus").value,personnel:+$("editMaPersonnel").value||0,gallons:+$("editMaGallons").value||0,assignment,lastUpdated:isoNow()};
  state.mutualAid[i]=m;
  if(m.assignment!==old.assignment)addLog(`${m.department} ${m.unit} assignment changed: ${old.assignment||"Unassigned"} → ${m.assignment||"Unassigned"}`.trim(),"Resources");
  if(m.status!==old.status)addLog(`${m.department} ${m.unit} status changed: ${old.status} → ${m.status}`.trim(),"Resources");
  $("mutualAidEditModal").classList.add("hidden");renderMutualAid();save(false)
}
function renderDynamicAssignmentBoard(){
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
function renderDynamicAssignmentBoard(){const groups={};Object.entries(state.units).forEach(([name,u])=>{if(u.assignment){groups[u.assignment]=groups[u.assignment]||[];groups[u.assignment].push({kind:"elsa",id:name,name,personnel:+u.personnel||0,status:u.status})}});state.mutualAid.forEach(m=>{if(m.assignment){groups[m.assignment]=groups[m.assignment]||[];groups[m.assignment].push({kind:"ma",id:m.id,name:`${m.department} ${m.unit}`.trim(),personnel:+m.personnel||0,status:m.status})}});const order=["Incident Command","Safety","Operations","RIT","Rapid Intervention","Fire Attack","Primary Search","Secondary Search","Ventilation","Water Supply","Staging","Rehab"];const names=Object.keys(groups).sort((a,b)=>{const ai=order.indexOf(a),bi=order.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b)});$("dynamicAssignmentBoard").innerHTML=names.length?names.map(name=>{const items=groups[name],personnel=items.reduce((s,x)=>s+x.personnel,0);return`<div class="assignment-group"><h4>${esc(name)}<span>${items.length} unit${items.length===1?"":"s"} / ${personnel} personnel</span></h4>${items.map(x=>`<div class="assignment-group-unit"><div><b>${esc(x.name)}</b><div class="muted">${esc(x.status)}</div></div><button class="btn light small" data-board-kind="${x.kind}" data-board-id="${esc(x.id)}">Reassign</button></div>`).join("")}</div>`}).join(""):'<div class="empty">Assignments will appear here after units are assigned.</div>';document.querySelectorAll("[data-board-kind]").forEach(b=>b.onclick=()=>b.dataset.boardKind==="elsa"?openUnit(b.dataset.boardId):openMutualAidEdit(b.dataset.boardId))}
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
  renderCriticalAlerts();
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

function closeIncident(){if(!state.startTime)return alert("No active incident is running.");if(state.closed)return alert("The incident is already closed.");if(!confirm("Close the incident, stop timers, and lock the board?"))return;snapshotForUndo("close incident");state.closed=true;state.closedAt=Date.now();state.locked=true;stopAlarm();addLog(`Incident Closed — Duration ${formatClock(state.closedAt-state.startTime)}`,"Command");addTimeline("Incident Closed","Command","",isoNow());save(false);renderAll()}
function reopenIncident(){if(!state.closed)return alert("The incident is not closed.");if(!confirm("Reopen this incident?"))return;snapshotForUndo("reopen incident");const gap=Date.now()-Number(state.closedAt||Date.now());state.startTime=Number(state.startTime)+gap;if(state.parDueAt)state.parDueAt=Number(state.parDueAt)+gap;state.closed=false;state.closedAt=null;state.locked=false;addLog("Incident Reopened","Command");save(false);renderAll()}
function toggleCommandLock(){state.locked=!state.locked;save(false);applyBoardModes()}
function toggleFiregroundMode(){state.firegroundMode=!state.firegroundMode;save(false);applyBoardModes()}
function applyBoardModes(){document.body.classList.toggle("board-locked",!!state.locked);document.body.classList.toggle("fireground-mode",!!state.firegroundMode);$("commandLockBtn").textContent=state.locked?"Unlock Board":"Lock Board";$("firegroundModeBtn").textContent=state.firegroundMode?"Standard Mode":"Fireground Mode";$("closeIncidentBtn").textContent=state.closed?"Incident Closed":"Close Incident";$("reopenIncidentBtn").disabled=!state.closed}
function renderCriticalAlerts(){const a=[];if(state.mayday?.active)a.push(`ACTIVE MAYDAY — ${state.mayday.unitName||"Unit/Firefighter not entered"}`);if(state.startTime&&!state.closed&&state.parDueAt&&!state.parInProgress&&Date.now()>=Number(state.parDueAt))a.push("PAR is overdue");const nc=Object.entries(state.units).filter(([,u])=>u.par==="No Contact").map(([n])=>n);if(nc.length)a.push(`No Contact: ${nc.join(", ")}`);if((+$("unaccounted").value||0)>0)a.push(`${+$("unaccounted").value} occupant(s) unaccounted for`);if(state.startTime&&!Object.values(state.units).some(u=>u.assignment==="Safety")&&!state.mutualAid.some(m=>m.assignment==="Safety"))a.push("No Safety Officer assigned");if(state.startTime&&!Object.values(state.units).some(u=>["RIT","Rapid Intervention"].includes(u.assignment))&&!state.mutualAid.some(m=>["RIT","Rapid Intervention"].includes(m.assignment)))a.push("No RIT assigned");if(state.startTime&&!$("waterMethod").value)a.push("Water supply method not selected");$("criticalAlertsPanel").classList.toggle("hidden",!a.length);$("criticalAlertsList").innerHTML=a.map(x=>`<div class="critical-alert-item">${esc(x)}</div>`).join("")}
function beginMaydayHold(){$("maydayHoldBtn").classList.add("mayday-holding");maydayHoldTimer=setTimeout(()=>{$("maydayHoldBtn").classList.remove("mayday-holding");$("maydayConfirmModal").classList.remove("hidden")},2000)}
function cancelMaydayHold(){if(maydayHoldTimer){clearTimeout(maydayHoldTimer);maydayHoldTimer=null}$("maydayHoldBtn").classList.remove("mayday-holding")}
function declareMayday(){if(state.mayday?.active)return;snapshotForUndo("declare mayday");stopAlarm();state.mayday={active:true,startedAt:Date.now(),location:"",unitName:"",assignment:"",resources:"",nature:"",channel:"",air:"",ritUnit:"",notes:"",actions:[]};addLog("MAYDAY DECLARED","Mayday");addTimeline("MAYDAY DECLARED","Mayday");$("maydayConfirmModal").classList.add("hidden");save(false);renderAll();openMaydayPanel()}
function openMaydayPanel(){if(!state.mayday?.active)return alert("No active Mayday.");const m=state.mayday;for(const [id,k] of [["maydayLocation","location"],["maydayUnitName","unitName"],["maydayAssignment","assignment"],["maydayResources","resources"],["maydayNature","nature"],["maydayChannel","channel"],["maydayAir","air"],["maydayRitUnit","ritUnit"],["maydayNotes","notes"]])$(id).value=m[k]||"";$("maydayPanelModal").classList.remove("hidden")}
function saveMaydayInfo(){if(!state.mayday)return;Object.assign(state.mayday,{location:$("maydayLocation").value.trim(),unitName:$("maydayUnitName").value.trim(),assignment:$("maydayAssignment").value.trim(),resources:$("maydayResources").value.trim(),nature:$("maydayNature").value.trim(),channel:$("maydayChannel").value.trim(),air:$("maydayAir").value.trim(),ritUnit:$("maydayRitUnit").value.trim(),notes:$("maydayNotes").value.trim()});addLog(`Mayday information updated — ${state.mayday.unitName||"Unknown member"}`,"Mayday");save(false);renderAll()}
function maydayAction(action){if(!state.mayday?.active)return;snapshotForUndo(action);state.mayday.actions.push({action,time:isoNow()});addLog(action,"Mayday");addTimeline(action,"Mayday");save(false);renderAll()}
function resolveMayday(){if(!state.mayday?.active)return;if(!confirm("Resolve the active Mayday?"))return;snapshotForUndo("resolve mayday");const d=Date.now()-Number(state.mayday.startedAt);state.mayday.active=false;state.mayday.resolvedAt=Date.now();addLog(`MAYDAY RESOLVED — Duration ${formatClock(d)}`,"Mayday");addTimeline("MAYDAY RESOLVED","Mayday",`Duration ${formatClock(d)}`);if(confirm("Restart the normal 15-minute PAR cycle?")){state.parInProgress=false;state.parDueAt=Date.now()+15*60*1000}$("maydayPanelModal").classList.add("hidden");save(false);renderAll()}
function renderMayday(){const a=!!state.mayday?.active;$("maydayBanner").classList.toggle("hidden",!a);if(!a)return;const m=state.mayday,e=formatClock(Date.now()-Number(m.startedAt)).slice(3);$("maydaySummary").textContent=[m.unitName,m.location].filter(Boolean).join(" • ")||"Awaiting LUNAR information";$("maydayTimer").textContent=e;$("maydayPanelTimer").textContent=e}
function downloadBackup(){save(false);const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Elsa_FD_Command_${($("caseNo").value||"incident").replace(/[^a-z0-9-_]/gi,"_")}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function restoreBackup(file){const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);state={...defaults(),...x,units:{...defaults().units,...(x.units||{})}};save(false);renderAll();alert("Incident backup restored.")}catch(e){alert("Invalid backup file.")}};r.readAsText(file)}
function resetIncident(){if(confirm("Clear all incident data and start a new incident?")){stopAlarm();localStorage.removeItem("elsaFDCommandV24");location.reload()}}

$("startIncidentBtn").onclick=startIncident;$("testParAlarmBtn").onclick=testParAlarm;$("overlayStartParBtn").onclick=startPAR;$("saveBtn").onclick=()=>save(true);$("newIncidentBtn").onclick=resetIncident;$("startParBtn").onclick=startPAR;$("completeParBtn").onclick=completePAR;
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


["pointerdown","touchstart","keydown"].forEach(evt=>{
  document.addEventListener(evt,()=>{if(!audioUnlocked)ensureAudio()},{once:true,passive:true})
});

$("undoBtn").onclick=undoLastAction;$("commandLockBtn").onclick=toggleCommandLock;$("firegroundModeBtn").onclick=toggleFiregroundMode;$("closeIncidentBtn").onclick=closeIncident;$("reopenIncidentBtn").onclick=reopenIncident;$("downloadBackupBtn").onclick=downloadBackup;$("restoreBackupInput").onchange=e=>{if(e.target.files[0])restoreBackup(e.target.files[0])};$("resumeRecoveryBtn").onclick=()=>$("recoveryModal").classList.add("hidden");$("discardRecoveryBtn").onclick=()=>{localStorage.removeItem("elsaFDCommandV24");location.reload()};$("maydayHoldBtn").addEventListener("pointerdown",beginMaydayHold);$("maydayHoldBtn").addEventListener("pointerup",cancelMaydayHold);$("maydayHoldBtn").addEventListener("pointerleave",cancelMaydayHold);$("maydayHoldBtn").addEventListener("pointercancel",cancelMaydayHold);$("cancelMaydayBtn").onclick=()=>$("maydayConfirmModal").classList.add("hidden");$("confirmMaydayBtn").onclick=declareMayday;$("openMaydayPanelBtn").onclick=openMaydayPanel;$("closeMaydayPanelBtn").onclick=()=>$("maydayPanelModal").classList.add("hidden");$("saveMaydayInfoBtn").onclick=saveMaydayInfo;document.querySelectorAll("[data-mayday-action]").forEach(b=>b.onclick=()=>maydayAction(b.dataset.maydayAction));$("resolveMaydayBtn").onclick=resolveMayday;
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