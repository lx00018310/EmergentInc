import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorldRegistryStore, CoreStore, CurrentStore, LineageStore } from '@emergentinc/persistence';
import { QianjiNarrativeSpec, lifeId } from '@emergentinc/protocol';
import { containedPath } from './safe_path.js';

export class WorldRegistryService {
  constructor(readonly workspace: string, readonly control: WorldRegistryStore, readonly lineage: LineageStore, readonly interfaceVersion: string,readonly activePointer=path.join(workspace,"system/active-generation.json")) {}
  directory(id: string) { lifeId(id); const row = this.control.world(id); return containedPath(this.workspace,...row.workspace_relpath.split('/')); }
  list() { return this.control.worlds(); }
  effectiveGeneration(){
    const active=this.lineage.activeGeneration();if(!active)throw new Error('GLOBAL_GENERATION_REQUIRED');
    const pointer=JSON.parse(fs.readFileSync(this.activePointer,'utf8')).generation_id;
    if(pointer===active.id)return active;const next=this.lineage.generation(pointer);
    if(next.state!=='BIRTHING'||next.parent_id!==active.id)throw new Error('GLOBAL_GENERATION_POINTER_CONFLICT');return next;
  }
  create(narrative: QianjiNarrativeSpec, options: { qianjiId?: string; pixelId?: string; pixelDirectory?: string;artifactDirectory?:string; account?: Record<string, any>; existingProfile?: boolean; worldId?: string; round?: number; birthIdentity?: import("@emergentinc/protocol").QianjiBirthIdentity } = {}) {
    const worldId = options.worldId ?? `world_${randomUUID()}`, qianjiId = options.qianjiId ?? `qj_${randomUUID()}`;
    lifeId(worldId); lifeId(qianjiId);
    const directory = containedPath(this.workspace,'worlds',worldId), temporary = containedPath(this.workspace,'worlds',`.new-${worldId}`);
    if (fs.existsSync(directory) || fs.existsSync(temporary)) throw new Error('WORLD_DIRECTORY_MUST_BE_NEW');
    const generation = this.effectiveGeneration();if(generation.state!=='ACTIVE')throw new Error('WORLD_BIRTH_REQUIRES_ACTIVE_GLOBAL_GENERATION');
    const pixelId = options.pixelId ?? '0_0_0'; if (!/^-?\d+_-?\d+_-?\d+$/.test(pixelId)) throw new Error('INVALID_PIXEL_ID');
    let core: CoreStore | undefined, current: CurrentStore | undefined;
    try {
      const pixelRoot = path.join(temporary,'live/pixels',pixelId); fs.mkdirSync(pixelRoot,{recursive:true});
      if (options.pixelDirectory) {
        const copy = (from: string, to: string) => { const stat=fs.lstatSync(from); if (stat.isSymbolicLink()) throw new Error('WORLD_SOURCE_SYMLINK_FORBIDDEN');
          if (stat.isDirectory()) { fs.mkdirSync(to,{recursive:true}); for(const name of fs.readdirSync(from)) copy(path.join(from,name),path.join(to,name)); }
          else if (stat.isFile()) fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL); else throw new Error('WORLD_SPECIAL_FILE'); };
        for (const name of fs.readdirSync(options.pixelDirectory)) copy(path.join(options.pixelDirectory,name),path.join(pixelRoot,name));
        if(options.artifactDirectory&&fs.existsSync(options.artifactDirectory))copy(options.artifactDirectory,path.join(temporary,'live/artifacts',pixelId));
      } else {
        fs.writeFileSync(path.join(pixelRoot,'pixel.md'),'我是这个世界的创始元胞。遵守 Gene 契约，协作、繁衍并完成本世界的任务。');
        fs.writeFileSync(path.join(pixelRoot,'state.json'),JSON.stringify({ id:pixelId,pixel_id:pixelId,energy:100000,active:true,incarnation:1,generation:1,born_round:0,last_active_round:0 }));
      }
      fs.writeFileSync(path.join(temporary,'live/world_state.json'),JSON.stringify({round:options.round??0}));
      fs.writeFileSync(path.join(temporary,'live/environment.md'),'当前环境是一个独立 World。只访问本世界文件；公共 Gene 通过能力接口提供。');
      core = new CoreStore(path.join(temporary,'ledger/v9_core.sqlite3'));
      const a=options.account; core.pixels.upsertPixelAccount({pixelId,energy:a?.energy??100000,active:a?Boolean(a.active):true,refundDeficitTokens:a?.refund_deficit_tokens??0,spendBlockedReason:a?.spend_blocked_reason??null});
      core.db.exec(`CREATE TABLE world_chat_inbox (turn_id TEXT PRIMARY KEY,qianji_id TEXT NOT NULL,message_id TEXT NOT NULL UNIQUE,entry_pixel_id TEXT NOT NULL,entry_incarnation INTEGER NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE world_shared_assets(asset_id TEXT PRIMARY KEY,owner_pixel_id TEXT NOT NULL,kind TEXT NOT NULL,file TEXT NOT NULL,content_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE world_outbox (turn_id TEXT PRIMARY KEY REFERENCES world_chat_inbox(turn_id),message_id TEXT NOT NULL UNIQUE,reply TEXT NOT NULL,model_call_id TEXT NOT NULL,created_at INTEGER NOT NULL);`);
      current=new CurrentStore(path.join(temporary,'generations',String(generation.id),'current.sqlite3')); current.initialize(generation,this.interfaceVersion); current.close();current=undefined;
      fs.mkdirSync(path.join(temporary,'generations',String(generation.id),'body/skills'),{recursive:true});
      fs.writeFileSync(path.join(temporary,'world.json'),JSON.stringify({world_id:worldId,qianji_id:qianjiId,created_generation:generation.id})); core.close();core=undefined;
      fs.renameSync(temporary,directory);
      this.control.transaction(()=>{
        if(!options.existingProfile) this.control.qianji.createProfile({qianjiId,narrative,careerStatus:'active',birthIdentity:options.birthIdentity});
        this.control.insertWorld({world_id:worldId,qianji_id:qianjiId,status:'ACTIVE',workspace_relpath:`worlds/${worldId}`,gateway_pixel_id:pixelId,created_at:Date.now(),archived_at:null});
        this.control.event('WORLD_CREATED',worldId,{qianjiId,pixelId,generation:generation.id});
      });
      return this.control.world(worldId);
    } catch(error) { core?.close();current?.close(); for(const target of [temporary,directory]) if(fs.existsSync(target)) {
      if(!path.resolve(target).startsWith(path.resolve(this.workspace,'worlds')+path.sep)) throw new Error('WORLD_CLEANUP_PATH_INVALID'); fs.rmSync(target,{recursive:true,force:true}); }
      throw error;
    }
  }
}
