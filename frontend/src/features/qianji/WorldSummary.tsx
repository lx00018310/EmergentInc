import {useEffect,useState} from 'react';
import {apiRequest} from '../../api/client';
import type {QianjiListItemDto} from '../../api/qianji';
const money=(value:string)=>`${BigInt(value)/1000000n}.${(BigInt(value)%1000000n).toString().padStart(6,'0')}`;
export function WorldSummary({item,onRefresh}:{item:QianjiListItemDto;onRefresh:()=>Promise<void>}){
  const [revenue,setRevenue]=useState<any>(),[pixel,setPixel]=useState(''),[error,setError]=useState('');const world=item.world;
  useEffect(()=>{if(!world)return;let live=true;const refresh=()=>void apiRequest(`/api/worlds/${world.world_id}/revenue`).then(value=>{if(live)setRevenue(value);}).catch(e=>{if(live)setError(e.message);});refresh();const timer=setInterval(refresh,10000);return()=>{live=false;clearInterval(timer);};},[world?.world_id]);
  if(!world)return null;
  return <section className="hall-side-panel qj-world-summary"><h2>人物世界</h2><p>{world.world_id}</p><p>{world.activePixels??0} 个活跃元胞 / {world.totalPixels??0} 个元胞</p>
    <p>对外入口：{world.gateway_pixel_id??'未设置'}。入口是可更换的内部元胞。</p><a href={'/YUAN?world='+encodeURIComponent(world.world_id)}>进入此 World</a>
    {revenue&&<><p>主网收款：{money(revenue.mainnetAtomic)} USDT</p></>}
    <form onSubmit={e=>{e.preventDefault();void apiRequest(`/api/worlds/${world.world_id}/gateway`,{method:'PUT',body:JSON.stringify({pixel_id:pixel,expected_revision:world.gatewayRevision})}).then(onRefresh).catch(e=>setError(e.message));}}>
      <label>更换活跃入口 Pixel<input required value={pixel} onChange={e=>setPixel(e.target.value)} placeholder="例如 1_0_0"/></label><button className="btn btn-sm">确认更换入口</button></form>{error&&<p role="alert">{error}</p>}
  </section>;
}
