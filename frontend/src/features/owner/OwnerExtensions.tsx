import {useRef,useState} from 'react';
import {apiRequest} from '../../api/client';
import {ownerError} from '../../api/owner';
import {t,useLanguage} from '../../i18n';
interface Extension {id:string;worldId:string;revision:number;hash:string|null;previousHash:string|null;enabled:boolean;requestedEnabled:boolean;reason:string|null;versions:{hash:string;version:string;creatorPixelId:string;engine:string;requiredContracts:string[];reason:string|null}[]}
export function OwnerExtensions({worldIds}:{worldIds:string[]}){
  useLanguage();const [items,setItems]=useState<Extension[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const pending=useRef<{body:string;key:string}>();
  const load=async()=>{const lists=await Promise.all(worldIds.map(id=>apiRequest<{items:Extension[]}>(`worlds/${encodeURIComponent(id)}/extensions`,{worldScoped:false})));setItems(lists.flatMap(l=>l.items));};
  const act=async(e:Extension,action:string,hash=e.hash)=>{const body={action,...(action==='activate'?{hash}:{}),expectedRevision:e.revision,expectedHash:e.hash},signature=JSON.stringify({world:e.worldId,id:e.id,body});if(pending.current?.body!==signature)pending.current={body:signature,key:crypto.randomUUID()};setBusy(true);setError('');try{await apiRequest(`worlds/${encodeURIComponent(e.worldId)}/extensions/${encodeURIComponent(e.id)}/actions`,{worldScoped:false,method:'POST',body:JSON.stringify({...body,idempotencyKey:pending.current.key})});pending.current=undefined;await load();}catch(err){setError(ownerError(err));await load().catch(()=>{});}finally{setBusy(false);}};
  return <details className="owner-extensions" onToggle={async event=>{if(event.currentTarget.open){setError('');try{await load();}catch(err){setError(ownerError(err));}}}}><summary>{t('Private World extensions')}</summary>
    <p>{t('Pure JSON programs have independent versions. They cannot access files, data stores or networks. Core patches still need maintenance approval.')}</p>
    {error&&<p role="alert">{error}</p>}{!items.length&&<p>{t('No extensions in this goal’s Worlds.')}</p>}
    <ul>{items.map(e=><li key={`${e.worldId}:${e.id}`}><strong>{e.id}</strong> · {e.enabled?t('Extension enabled'):e.reason?t('Extension blocked'):t('Extension disabled')}<p>{t('Source World')}: {e.worldId}<br/>{t('Active content hash')}: <code>{e.hash??'—'}</code></p>{e.reason&&<p>{t(e.reason)}</p>}
      <ul>{e.versions.map(v=><li key={v.hash}>{v.version} · {t('Created by Pixel')} {v.creatorPixelId} · {v.engine} · {v.requiredContracts.join(', ')}<br/><code>{v.hash}</code>{v.reason?<p>{t(v.reason)}</p>:v.hash!==e.hash&&<button disabled={busy} onClick={()=>void act(e,'activate',v.hash)}>{t('Activate extension version {0}',[v.version])}</button>}</li>)}</ul>
      {e.requestedEnabled?<button disabled={busy} onClick={()=>void act(e,'disable')}>{t('Disable extension')}</button>:e.hash&&!e.reason&&<button disabled={busy} onClick={()=>void act(e,'activate')}>{t('Enable extension')}</button>}
      {e.previousHash&&<button disabled={busy} onClick={()=>void act(e,'rollback')}>{t('Restore previous extension version')}</button>}
    </li>)}</ul>
  </details>;
}
