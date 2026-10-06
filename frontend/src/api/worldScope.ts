let enabled=false;
let world:string|null=null;
export function enableWorlds(value:boolean){enabled=value;}
export function worldsEnabled(){return enabled;}
export function selectWorld(id:string|null){world=id;}
export function selectedWorld(){return world;}
export function worldApiUrl(url:string){
  if(!enabled||!world)return url;
  if(/^\/api\/(?:world(?:\?|$)|run(?:\/|$)|pixels(?:\/|$)|prompts(?:\/|$)|genesis-prompt(?:\?|$)|temporary-prompt(?:\?|$)|private-files(?:\/|\?|$)|tools(?:\/|$)|tool-executions(?:\?|$)|environment(?:\/|$)|audit(?:\/|$)|owner(?:\/|$)|budget(?:\/|$))/.test(url))
    return `/api/worlds/${encodeURIComponent(world)}/api/`+url.slice(5);
  return url;
}
