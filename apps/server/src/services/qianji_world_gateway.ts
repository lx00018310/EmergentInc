import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorldRuntimeManager } from './world_runtime_manager.js';
import { lifeId, lifeText } from '@emergentinc/protocol';

export class QianjiWorldGateway {
  constructor(readonly manager:WorldRuntimeManager){}
  async enqueue(qianjiId:string,content:string,key:string){
    lifeText(content,8000);lifeText(key,128);if(/[\x00-\x1f]/.test(key))throw new Error('INVALID_CHAT_KEY');const control=this.manager.registry.control;
    const world=control.worldForQianji(qianjiId),runtime=await this.manager.open(world.world_id);
    const pixel=world.gateway_pixel_id;if(!pixel||!runtime.store.pixels.getPixelAccount(pixel)?.active)throw new Error('WORLD_GATEWAY_NOT_AVAILABLE');
    const requestKey=`${qianjiId}:${key}`,old=control.db.prepare('SELECT * FROM world_chat_turns WHERE request_key=?').get(requestKey);
    if(old){if(old.question!==content)throw new Error('IDEMPOTENCY_CONFLICT');return old;}
    const turnId=`turn_${randomUUID()}`,messageId=`msg_${randomUUID()}`;
    const state=JSON.parse(fs.readFileSync(path.join(runtime.directory,'live/pixels',pixel,'state.json'),'utf8'));
    if(!Number.isSafeInteger(state.incarnation)||state.incarnation<1)throw new Error('GATEWAY_INCARNATION_INVALID');
    runtime.store.transaction(()=>{
      runtime.store.messages.enqueueMessage({messageId,roundNum:runtime.run.getWorldRound()+1,sender:'owner',recipient:pixel,content,sourceType:'human'});
      runtime.store.db.prepare('INSERT INTO world_chat_inbox VALUES(?,?,?,?,?,?)').run(turnId,qianjiId,messageId,pixel,state.incarnation,Date.now());
    });
    try{control.db.prepare('INSERT INTO world_chat_turns VALUES(?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL)').run(turnId,qianjiId,world.world_id,messageId,pixel,requestKey,content,Date.now());}
    catch(error){runtime.store.transaction(()=>{runtime.store.db.prepare('DELETE FROM world_chat_inbox WHERE turn_id=?').run(turnId);runtime.store.db.prepare('DELETE FROM messages WHERE message_id=?').run(messageId);});throw error;}
    return control.db.prepare('SELECT * FROM world_chat_turns WHERE turn_id=?').get(turnId)!;
  }
  async turns(qianjiId:string){
    const control=this.manager.registry.control,world=control.worldForQianji(qianjiId),runtime=world.status==='ACTIVE'?await this.manager.open(world.world_id):undefined;
    for(const outbox of runtime?.store.db.prepare('SELECT * FROM world_outbox ORDER BY created_at').all()??[])
      control.db.prepare('UPDATE world_chat_turns SET reply=?,reply_call_id=?,replied_at=? WHERE turn_id=? AND world_id=? AND message_id=? AND reply IS NULL')
        .run(outbox.reply,outbox.model_call_id,outbox.created_at,outbox.turn_id,world.world_id,outbox.message_id);
    return control.db.prepare('SELECT * FROM world_chat_turns WHERE qianji_id=? ORDER BY created_at LIMIT 200').all(qianjiId).map(row=>{
      const message=runtime?.store.messages.getMessage(String(row.message_id));
      let status: 'queued'|'processing'|'replied'|'no_reply'|'blocked'|'failed' = 'failed';
      if(row.reply!==null)status='replied';
      else if(message?.status==='COMMITTED')status='no_reply';
      else if(message?.status==='QUEUED')status='queued';
      else if(message && ['WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT','ABANDONED'].includes(message.status))status='blocked';
      else if(message && ['PROCESSING','RESERVED','CALLING','RESPONSE_STORED'].includes(message.status))status=runtime?.run.getStatus().running?'processing':'blocked';
      return {turnId:row.turn_id,qianjiId:row.qianji_id,worldId:row.world_id,
        bindingId:null,messageId:row.message_id,question:row.question,reply:row.reply,createdAt:Number(row.created_at)/1000,repliedAt:row.replied_at?Number(row.replied_at)/1000:null,
        entryPixelId:row.entry_pixel_id,isMilestone:Boolean(control.db.prepare('SELECT turn_id FROM world_conclusions WHERE turn_id=?').get(row.turn_id)),status,blockReason:message?.status??null};
    });
  }
}
