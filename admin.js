/* FeeFlow admin module. Loaded only after the server confirms role = admin.
   All data access goes through Supabase, where the database itself enforces admin-only rules. */
(function(){
const A={tab:"u",users:[],coupons:[],cfg:{},q:"",f:"all",me:{},root:null,o:{},busy:0};
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $=i=>A.root.querySelector("#"+i);
const fdt=s=>s?new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"Never";
const ago=s=>{if(!s)return"Never";const m=(Date.now()-new Date(s))/6e4;return m<2?"Just now":m<60?Math.floor(m)+" min ago":m<1440?Math.floor(m/60)+" h ago":Math.floor(m/1440)+" d ago"};
const stt=u=>{const e=u.expires_at?new Date(u.expires_at):null;if(u.blocked)return["Blocked","dn","blocked"];if(u.plan==="pro"&&e&&e>new Date())return["Pro · "+Math.ceil((e-new Date())/864e5)+"d","up","pro"];if(u.plan==="pro")return["Expired","wn","expired"];return["Free","","free"]};
function toast(t){const e=document.createElement("div");e.className="ts";e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2600)}
const err=e=>toast(e.offline?"No internet connection":e.message);
const CSS=`.admw{max-width:960px}.g4{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px}.g4 .c{margin:0}.g4 b{font-size:26px;display:block}
.ur{cursor:pointer}.chip{font-weight:800;font-size:13px}.mdl{position:fixed;inset:0;background:rgba(5,8,20,.5);display:grid;place-items:center;z-index:60;padding:16px}
.mdl .c{max-width:460px;width:100%;max-height:92vh;overflow:auto;margin:0}.kv{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--ln)}.kv small{flex:none}.kv b{text-align:right;word-break:break-all}
.bar{display:flex;gap:8px;flex-wrap:wrap}.bar>*{flex:1}.bar input,.bar select{margin:0;min-width:140px}select{appearance:auto}.hb{display:flex;gap:8px;align-items:center}`;
function shell(){const o=A.o;
A.root.innerHTML=`<div class="w admw"><div class="hero sm"><div class="top">${o.logo||""}<div class="hb">${o.onMember?`<button class="b s" onclick="FFA.member()">My app</button>`:""}<button class="b s" onclick="FFA.logout()">Log out</button></div></div><h1 class="ah">Admin</h1><p class="mu">${esc(A.me.email||"")}</p></div>
<div class="seg">${[["u","Users"],["c","Coupons"],["s","Settings"]].map(t=>`<button class="${A.tab===t[0]?"on":""}" onclick="FFA.tab('${t[0]}')">${t[1]}</button>`).join("")}</div><div id="vw"></div><div id="md"></div></div>`;
({u:vUsers,c:vCoupons,s:vSettings})[A.tab]()}
async function load(){const[u,c,g]=await Promise.all([SB.rpc("admin_users"),SB.get("coupons?select=*&order=created_at.desc"),SB.get("app_config?select=key,value")]);A.users=u;A.coupons=c;A.cfg={};g.forEach(x=>A.cfg[x.key]=x.value)}
const match=u=>(A.f==="all"||stt(u)[2]===A.f)&&(!A.q||(u.email+" "+(u.biz||"")).toLowerCase().includes(A.q.toLowerCase()));
function vUsers(){const U=A.users,n7=Date.now()-7*864e5,c={pro:0,expired:0,free:0,blocked:0};U.forEach(u=>c[stt(u)[2]]++);
$("vw").innerHTML=`<div class="g4"><div class="c"><small>Total users</small><b>${U.length}</b></div><div class="c"><small>Pro active</small><b class="up">${c.pro}</b></div><div class="c"><small>Pro expired</small><b class="wn">${c.expired}</b></div><div class="c"><small>New in 7 days</small><b>${U.filter(u=>new Date(u.created_at)>n7).length}</b></div></div>
<div class="bar" style="margin-bottom:12px"><input placeholder="Search email or business" value="${esc(A.q)}" oninput="FFA.q(this.value)"><select onchange="FFA.f(this.value)">${[["all","All users"],["pro","Pro active"],["expired","Pro expired"],["free","Free"],["blocked","Blocked"]].map(o=>`<option value="${o[0]}" ${A.f===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select></div><div id="ul"></div>`;list()}
function list(){const L=A.users.filter(match);
$("ul").innerHTML=L.length?L.map(u=>{const s=stt(u);return`<div class="c ur row" onclick="FFA.user('${u.id}')"><div class="fx"><b>${esc(u.biz||"No business name")}</b><small>${esc(u.email)}${u.role==="admin"?" · admin":""}</small></div><div style="text-align:right"><span class="chip ${s[1]}">${s[0]}</span><small style="display:block">${u.members} members · ${ago(u.last_seen)}</small></div></div>`}).join(""):`<div class="c"><small>No users match.</small></div>`}
function vCoupons(){$("vw").innerHTML=`<div class="c"><h3>New coupon</h3><div class="two"><div><label>Code</label><input id="nc" placeholder="e.g. DIWALI30" style="text-transform:uppercase"></div><div><label>Days of Pro</label><input id="nd" type="number" min="1" value="30"></div><div><label>Max uses (blank = unlimited)</label><input id="nm" type="number" min="1"></div><div><label>Valid until (optional)</label><input id="nv" type="date"></div></div><button class="b w" onclick="FFA.addC()">Create coupon</button></div>
${A.coupons.map(c=>`<div class="c row"><div class="fx"><b>${esc(c.code)}</b><small>${c.days} days · used ${c.used_count}${c.max_uses?" of "+c.max_uses:""}${c.valid_until?" · until "+fdt(c.valid_until):""}</small></div><span class="chip ${c.active?"up":"dn"}">${c.active?"Active":"Off"}</span><button class="b s" onclick="FFA.togC('${esc(c.code)}',${!c.active})">${c.active?"Disable":"Enable"}</button><button class="b s dn" onclick="FFA.delC('${esc(c.code)}')">Delete</button></div>`).join("")||`<div class="c"><small>No coupons yet.</small></div>`}`}
function vSettings(){const a=A.cfg.announcement||{on:false,text:""},v=typeof APP_VER!=="undefined"?APP_VER:"the APP_VER value in index.html";
$("vw").innerHTML=`<div class="c"><h3>Announcement banner</h3><small>Shown at the bottom of the app. Users can dismiss it.</small><div style="height:10px"></div><label>Message</label><input id="at" value="${esc(a.text)}" placeholder="e.g. New feature: Kannada language"><label class="row" style="margin:0 0 12px"><input id="ao" type="checkbox" style="width:auto;margin:0" ${a.on?"checked":""}> Show banner</label><button class="b w" onclick="FFA.saveA()">Save announcement</button></div>
<div class="c"><h3>Force update</h3><small>This app is version ${esc(v)}. If you set a higher number here, every user sees “Update ready, tap to refresh”. Set 0 to turn off.</small><div style="height:10px"></div><label>Minimum app version</label><input id="mv" type="number" min="0" value="${+A.cfg.min_app_version||0}"><button class="b w" onclick="FFA.saveV()">Save version</button></div>
<div class="c"><h3>Make another admin</h3><small>Ask them to sign up in the app first, then run this in the Supabase SQL Editor:</small><pre style="white-space:pre-wrap;word-break:break-all;font-size:13px">update public.profiles set role = 'admin' where email = 'their@email.com';</pre></div>`}
async function act(fn,msg,id){try{await fn();await load();toast(msg);shell();if(id)FFA.user(id)}catch(e){err(e)}}
const cfgSave=(k,v,m)=>act(()=>SB.api("/rest/v1/app_config?on_conflict=key",{m:"POST",b:{key:k,value:v},h:{Prefer:"resolution=merge-duplicates,return=minimal"}}),m);
const FFA=window.FFA={
async mount(root,o){A.root=root;A.o=o||{};A.me=A.o.me||{};
if(!document.getElementById("admcss")){const s=document.createElement("style");s.id="admcss";s.textContent=CSS;document.head.appendChild(s)}
root.innerHTML=`<div class="w admw"><div class="hero sm"><div class="top">${A.o.logo||""}</div><h1 class="ah">Admin</h1><p class="mu">Loading…</p></div></div>`;
try{await load();shell()}catch(e){err(e);root.innerHTML=`<div class="w admw"><div class="hero sm"><h1 class="ah">Admin</h1><p class="mu">${esc(e.message)}</p></div><button class="b w" onclick="FFA.logout()">Log out</button></div>`}},
tab(t){A.tab=t;shell()},q(v){A.q=v;list()},f(v){A.f=v;list()},
logout(){A.o.onLogout&&A.o.onLogout()},member(){A.o.onMember&&A.o.onMember()},
closeM(){$("md").innerHTML=""},
user(id){const u=A.users.find(x=>x.id===id);if(!u)return;const s=stt(u),me=u.id===A.me.id;
$("md").innerHTML=`<div class="mdl" onclick="if(event.target===this)FFA.closeM()"><div class="c"><div class="row"><div class="fx"><h3 style="margin:0">${esc(u.biz||"No business name")}</h3><small>${esc(u.email)}</small></div><button class="ib" onclick="FFA.closeM()" aria-label="Close">✕</button></div><div style="height:10px"></div>
<div class="kv"><small>Plan</small><b class="${s[1]}">${s[0]}</b></div><div class="kv"><small>Pro ends</small><b>${u.expires_at?fdt(u.expires_at):"—"}</b></div><div class="kv"><small>Members · payments</small><b>${u.members} · ${u.payments}</b></div><div class="kv"><small>Joined</small><b>${fdt(u.created_at)}</b></div><div class="kv"><small>Last seen</small><b>${ago(u.last_seen)}</b></div>
<label style="margin-top:14px">Give Pro for</label><div class="act" style="margin-top:0">${[7,30,90,365].map(d=>`<button class="b s" onclick="FFA.grant('${u.id}',${d})">+${d}d</button>`).join("")}</div>
<div class="cpr" style="margin-top:8px"><input id="gd" type="number" min="1" placeholder="Custom days"><button class="b" onclick="FFA.grant('${u.id}',+document.getElementById('gd').value)">Add</button></div>
<div class="act"><button class="b s" onclick="FFA.revoke('${u.id}')">Remove Pro</button>${me?"":`<button class="b s dn" onclick="FFA.block('${u.id}',${!u.blocked})">${u.blocked?"Unblock":"Block"} user</button>`}</div></div></div>`},
grant(id,d){if(!(d>=1))return toast("Enter the number of days");act(()=>SB.rpc("admin_grant",{p_user:id,p_days:d}),"Added "+d+" days",id)},
revoke(id){if(confirm("Remove Pro from this user?"))act(()=>SB.rpc("admin_revoke",{p_user:id}),"Pro removed",id)},
block(id,b){if(confirm((b?"Block":"Unblock")+" this user?"))act(()=>SB.api("/rest/v1/profiles?id=eq."+id,{m:"PATCH",b:{blocked:b},h:{Prefer:"return=minimal"}}),b?"User blocked":"User unblocked",id)},
addC(){const code=$("nc").value.trim().toUpperCase(),days=+$("nd").value,mx=$("nm").value,vu=$("nv").value;if(!/^[A-Z0-9_-]{3,20}$/.test(code))return toast("Code: 3 to 20 letters or numbers");if(!(days>=1))return toast("Enter days");
act(()=>SB.api("/rest/v1/coupons",{m:"POST",b:{code,days,max_uses:mx?+mx:null,valid_until:vu||null},h:{Prefer:"return=minimal"}}),"Coupon "+code+" created")},
togC(c,a){act(()=>SB.api("/rest/v1/coupons?code=eq."+encodeURIComponent(c),{m:"PATCH",b:{active:a},h:{Prefer:"return=minimal"}}),a?"Coupon enabled":"Coupon disabled")},
delC(c){if(confirm("Delete "+c+"? Users who used it keep their Pro."))act(()=>SB.api("/rest/v1/coupons?code=eq."+encodeURIComponent(c),{m:"DELETE",h:{Prefer:"return=minimal"}}),"Coupon deleted")},
saveA(){cfgSave("announcement",{on:$("ao").checked,text:$("at").value.trim()},"Announcement saved")},
saveV(){cfgSave("min_app_version",+$("mv").value||0,"Version saved")}};
})();
