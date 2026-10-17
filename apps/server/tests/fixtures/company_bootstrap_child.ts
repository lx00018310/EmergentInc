import {resolve} from 'node:path';
import {initializeBossWorkspace} from '../../src/boss_workspace.js';
import {runtimeConfig,acquireWorkspaceLock} from '../../src/runtime_config.js';
import {bootstrapWorlds} from '../../src/world_bootstrap.js';
import {OwnerWorkService} from '../../src/services/owner_work_service.js';
const hasFailure=OwnerWorkService.prototype.hasFailure;let reported=false;
OwnerWorkService.prototype.hasFailure=function(){const failed=hasFailure.call(this);if(failed&&!reported){reported=true;console.error('BOOTSTRAP_WORK_ERROR',String((this as any).schedulerError));}return failed;};
const root=resolve('.'),config=runtimeConfig(root);initializeBossWorkspace(root,config.workspaceRoot);
const unlock=acquireWorkspaceLock(config.workspaceRoot);process.once('exit',unlock);
try{const app=await bootstrapWorlds(root,config,unlock);process.send?.({kind:'ready',pid:process.pid});process.on('message',async value=>{if(value==='shutdown'){await app.close();if(process.connected)process.disconnect();}});}catch(e){unlock();throw e;}
