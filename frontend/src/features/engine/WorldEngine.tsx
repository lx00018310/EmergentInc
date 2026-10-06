import { t as tr, useLanguage } from '../../i18n';
import {useEffect,useState} from 'react';
import {apiRequest} from '../../api/client';
import {selectWorld} from '../../api/worldScope';
import {EngineView} from './EngineView';
type World={world_id:string;qianji_id:string;status:string};
export function WorldEngine({onBack}:{onBack:()=>void}){
  useLanguage();
  const [items,setItems]=useState<World[]>([]),[id,setId]=useState<string|null>(null),[error,setError]=useState('');
  useEffect(()=>{void apiRequest<{items:World[]}>('/api/worlds').then(data=>{setItems(data.items);const requested=new URLSearchParams(window.location.search).get('world');
    if(requested&&data.items.some(w=>w.world_id===requested&&w.status==='ACTIVE')){selectWorld(requested);setId(requested);}}).catch(e=>setError(e.message));return()=>selectWorld(null);},[]);
  return <><div className="world-selector"><label>{tr("所属 World") + " "}<select aria-label={tr("选择 World")} value={id??''} onChange={e=>{const next=e.target.value||null;selectWorld(next);setId(next);
    window.history.replaceState(null,'',next?'/YUAN?world='+encodeURIComponent(next):'/YUAN');}}><option value="">{tr("请选择 World")}</option>{items.filter(w=>w.status==='ACTIVE').map(w=><option key={w.world_id} value={w.world_id}>{w.qianji_id} · {w.world_id}</option>)}</select></label></div>
    {error&&<p role="alert">{error}</p>}{id?<EngineView key={id} onBack={onBack}/>:<main><p>{tr("选择一个 World 后查看它的元胞、文件与运行记录。")}</p><button onClick={onBack}>{tr("返回千机阁")}</button></main>}</>;
}
