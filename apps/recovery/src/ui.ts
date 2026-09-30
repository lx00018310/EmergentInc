export const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GENE · 元胞会社</title><link rel="stylesheet" href="/GENE/style.css"></head>
<body><main><small>EMERGENTINC / GENE</small><h1>基因与恢复</h1><p>独立于身体运行的诊断入口。</p>
<p id="error" role="alert"></p><section id="login"><h2>Owner 登录</h2>
<form id="login-form"><label>恢复口令<input id="secret" type="password" autocomplete="current-password" required minlength="32"></label><button>登录</button></form></section>
<section id="diagnostics" hidden><h2>运行状态</h2><p id="status" aria-live="polite"></p><dl id="details"></dl>
<p>健康接口可达只说明后端应答，不能证明页面与任务正常。</p>
<p id="control">可信恢复执行器尚未接入，当前只能诊断。此页不会自动重放任务或调用模型。</p>
<button id="refresh">刷新状态</button> <button id="logout">退出</button></section>
</main><script src="/GENE/app.js" defer></script></body></html>`;

export const css = `:root{font-family:system-ui,sans-serif;color:#dfe6ee;background:#10151e;color-scheme:dark}body{margin:0}main{max-width:760px;margin:6vh auto;padding:28px}small{letter-spacing:.15em;color:#95adca}h1{font-size:32px}section{padding:24px;border:1px solid #344253;border-radius:12px;margin-top:24px}label,input{display:block}input{width:min(100%,440px);box-sizing:border-box;margin:12px 0;padding:12px}button{padding:10px 18px;border:1px solid #718ba8;border-radius:6px;background:#23354a;color:white;cursor:pointer}button:disabled{opacity:.5}#error{color:#ffb9a9}dt{color:#a9bfd5;margin-top:12px}dd{margin:4px 0;overflow-wrap:anywhere}p{line-height:1.65}`;

export const js = `'use strict';
const el=id=>document.getElementById(id);let csrf='';
async function api(path,body){const response=await fetch('/api/recovery/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.detail||'请求失败');return data;}
function fail(error){el('error').textContent=error.message;}
async function refresh(){const data=await api('status');el('status').textContent=data.body.state==='REACHABLE'?'身体后端健康接口可达':'身体后端当前不可用';el('details').replaceChildren();for(const [key,value] of Object.entries(data.body)){const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=key;description.textContent=String(value);el('details').append(term,description);}}
async function session(){const data=await api('session');csrf=data.csrfToken||'';el('login').hidden=data.authenticated;el('diagnostics').hidden=!data.authenticated;if(data.authenticated)await refresh();}
el('login-form').addEventListener('submit',async event=>{event.preventDefault();el('error').textContent='';const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api('login',{secret:el('secret').value});el('secret').value='';await session();}catch(error){fail(error);}finally{button.disabled=false;}});
el('refresh').onclick=()=>{el('error').textContent='';void refresh().catch(fail);};
el('logout').onclick=()=>{void api('logout',{}).then(session).catch(fail);};
void session().catch(fail);
`;
