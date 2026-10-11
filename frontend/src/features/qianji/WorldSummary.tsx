import { t as tr, useLanguage } from '../../i18n';
import {useEffect,useState} from 'react';
import {apiRequest,ApiError} from '../../api/client';
import type {QianjiListItemDto} from '../../api/qianji';
const money=(value:string)=>`${BigInt(value)/1000000n}.${(BigInt(value)%1000000n).toString().padStart(6,'0')}`;
export function WorldSummary({item,onRefresh}:{item:QianjiListItemDto;onRefresh:()=>Promise<void>}){
  useLanguage();
  const [revenue,setRevenue]=useState<any>(),[pixel,setPixel]=useState(''),[error,setError]=useState(''),[revenueError,setRevenueError]=useState(''),[busy,setBusy]=useState(false);const world=item.world;
  useEffect(()=>{if(!world)return;let live=true;const refresh=()=>void apiRequest(`/api/worlds/${world.world_id}/revenue`).then(value=>{if(live){setRevenue(value);setRevenueError('');}}).catch(e=>{if(live)setRevenueError(e.message);});refresh();const timer=setInterval(refresh,10000);return()=>{live=false;clearInterval(timer);};},[world?.world_id]);
  if(!world)return null;
  return <section className="hall-side-panel qj-world-summary"><h2>{tr("人物世界")}</h2><p>{world.world_id}</p>
    {world.status==='ACTIVE'?<><p>{world.activePixels??0} {" " + tr("个活跃元胞 /") + " "}{world.totalPixels??0} {" " + tr("个元胞")}</p>
    <p>{tr("对外入口：")}{world.gateway_pixel_id??(tr("未设置"))}{tr("。入口是可更换的内部元胞。")}</p><a href={'/YUAN?world='+encodeURIComponent(world.world_id)}>{tr("进入此 World")}</a>
    </>:<p>{tr("此 World 已归档，仅保留人物与历史记录。")}</p>}
    {revenue&&<><p>{tr("主网收款：")}{money(revenue.mainnetAtomic)} USDT</p></>}
    {world.status==='ACTIVE'&&<form onSubmit={async e=>{
      e.preventDefault();if(busy)return;setBusy(true);setError('');
      try{
        await apiRequest(`/api/worlds/${world.world_id}/gateway`,{method:'PUT',body:JSON.stringify({pixel_id:pixel,expected_revision:world.gatewayRevision})});
        await onRefresh();setPixel('');
      }catch(e){setError(e instanceof ApiError?e.detail:(e as Error).message);}finally{setBusy(false);}
    }}>
      <label>{tr("更换活跃入口 Pixel")}<input required disabled={busy} value={pixel} onChange={e=>setPixel(e.target.value)} placeholder={tr("例如 1_0_0")}/></label><button disabled={busy} className="btn btn-sm">{tr("确认更换入口")}</button></form>}{(error||revenueError)&&<p role="alert">{tr("操作失败：{0}",[tr(error||revenueError)])}</p>}
  </section>;
}
