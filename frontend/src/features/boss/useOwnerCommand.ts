import {useRef,useState} from 'react';
import {ownerError,ownerGoalRequest} from '../../api/owner';
import {ApiError} from '../../api/client';
import {t} from '../../i18n';

interface Pending {path:string;body:Record<string,unknown>}
/** A lost response retries the exact decision, including its original versions and key. */
export function useOwnerCommand(storageKey:string,path:string){
  const read=():Pending|undefined=>{try{const value=JSON.parse(localStorage.getItem(storageKey)||'null');if(value?.path===path&&value.body&&typeof value.body.idempotencyKey==='string')return value;}catch{/* Invalid local input never grants server authority. */}return undefined;};
  const pending=useRef<Pending|undefined>(read()),flight=useRef(false);
  const [busy,setBusy]=useState(false),[awaiting,setAwaiting]=useState(Boolean(pending.current)),[error,setError]=useState('');
  function save(value:Pending|undefined){pending.current=value;setAwaiting(Boolean(value));try{if(value)localStorage.setItem(storageKey,JSON.stringify(value));else localStorage.removeItem(storageKey);}catch{/* The in-memory original request remains available. */}}
  async function send(command:Pending){
    if(flight.current)return false;flight.current=true;setBusy(true);setError('');save(command);
    try{await ownerGoalRequest(command.path,'POST',command.body);save(undefined);return true;}
    catch(e){
      if(e instanceof ApiError&&[400,401,403,404,409,422].includes(e.status))save(undefined);
      setError(ownerError(e));return false;
    }finally{flight.current=false;setBusy(false);}
  }
  return {busy,awaiting,error,submit:(body:Record<string,unknown>)=>{
    if(pending.current){setError(t('Resolve the pending request before sending a different command.'));return Promise.resolve(false);}
    return send({path,body});
  },retry:()=>pending.current?send(pending.current):Promise.resolve(false)};
}
