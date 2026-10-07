import {afterEach,describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {LineageStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {classifyChange} from '../../../supervisor/protocol.js';
import {sourceHash,appCodePath} from '../src/services/app_code_policy.js';
// @ts-ignore Owner maintenance module.
import {prepareAppCode,readAppCodeReport} from '../../../scripts/prepare-app-code.mjs';

const cleanups:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanups.splice(0).reverse())fn();});
function fixture(){
  const root=fs.mkdtempSync(join(tmpdir(),'app-code-upgrade-')),releases=join(root,'releases'),base=join(releases,'r1'),system=join(root,'workspace/system'),owner=join(root,'owner');
  fs.mkdirSync(join(base,'frontend/src'),{recursive:true});fs.mkdirSync(join(base,'genome'),{recursive:true});fs.mkdirSync(owner);
  fs.writeFileSync(join(base,'frontend/src/sample.ts'),'export const value = 1;');
  fs.writeFileSync(join(base,'genome/manifest.json'),JSON.stringify({schema_version:1,gene_hash_version:2,generation:1,body_interface_version:'1',protected_paths:['genome/**','frontend/**'],capability_contracts:{}}));
  const lineage=new LineageStore(join(system,'lineage/lineage.sqlite3'),{v23:true}),generation=lineage.createGeneration({id:'G0001',number:1,geneHash:readGenome(base).geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(system,'G0001');
  const validate=vi.fn(async(directory:string)=>{expect(fs.readFileSync(join(directory,'frontend/src/sample.ts'),'utf8')).toBe('export const value = 2;');expect(readGenome(directory).manifest.generation).toBe(2);});
  const runtime={validateRelease:validate,activeRelease:()=>base,quiesce:vi.fn(),finalDream:vi.fn(),smoke:vi.fn(),stop:vi.fn(),switchRelease:vi.fn(),start:vi.fn(),healthy:vi.fn(),resume:vi.fn()};
  const supervisor=new GenerationSupervisor(owner,system,releases,lineage,runtime,true);
  const body={schema:1,id:`code_${'a'.repeat(32)}`,worldId:'world_a',pixelId:'0_0_0',personName:'一苇',title:'Change application value',summary:'Actual 8765 source modification',baseGeneration:'G0001',baseRelease:'r1',files:[{path:'frontend/src/sample.ts',content:'export const value = 2;',baseHash:sourceHash('export const value = 1;')}],createdAt:Date.now()};
  const report={...body,hash:sourceHash(JSON.stringify(body))};
  const commands:string[]=[];
  const execute=async(_file:string,command:string,value:string)=>{commands.push(command);if(command==='submit')supervisor.submit(JSON.parse(fs.readFileSync(value,'utf8')));else if(command==='validate')await supervisor.validate(value);else throw new Error('Unexpected publication');};
  cleanups.push(()=>{supervisor.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,base,owner,lineage,report,supervisor,validate,runtime,commands,execute,config:{workspace:join(root,'workspace'),stateDirectory:owner},active:()=>({directory:base,generation})};
}
describe('independent Owner source review and upgrade preparation',()=>{
  it.each(['scripts/prepare-app-code.mjs','apps/server/src/owner_auth.ts','apps/server/src/OWNER_AUTH.ts','apps/server/src/services/app_code_policy.ts','apps/server/src/services/public_store.ts','packages/persistence/src/core_store.ts','packages/protocol/src/types/owner.ts'])('also denies the shared permission boundary through generic Gene patch submission: %s',path=>{
    expect(classifyChange([path])).toBe('ROOT');const f=fixture();const proposal=f.lineage.proposeGene('G0001','owner',{point:'test',reason:'test',effect:'test'},'test');f.lineage.decideProposal(proposal.id,'APPROVED');
    expect(()=>f.supervisor.submit({id:'bad_patch',base_generation:'G0001',base_release:'r1',proposal_id:proposal.id,patch:[{path,content:'bypass'}]})).toThrow('ROOT_OF_TRUST_CHANGE_FORBIDDEN');
  });
  it('builds and validates real candidate source while keeping the active release and approval untouched',async()=>{
    const f=fixture();const id=await prepareAppCode(f.root,'config',f.config,f.report.id,f.report.hash,f.execute,async()=>f.report,f.active);
    const candidate=f.supervisor.get(id);expect(candidate.state).toBe('VALIDATED');expect(candidate.approval_hash).toBeNull();expect(f.commands).toEqual(['submit','validate']);expect(f.validate).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(join(f.base,'frontend/src/sample.ts'),'utf8')).toBe('export const value = 1;');expect(f.lineage.activeGeneration()!.id).toBe('G0001');expect(f.runtime.switchRelease).not.toHaveBeenCalled();
    expect(candidate.request.app_code_report).toMatchObject({id:f.report.id,hash:f.report.hash,personName:'一苇'});
    expect(()=>f.supervisor.approve(id,'wrong')).toThrow('OWNER_CANDIDATE_HASH_CONFLICT');expect(f.supervisor.get(id).state).toBe('VALIDATED');
  });
  it('rejects a forged protected-file report even if its report hash is internally consistent',async()=>{
    const f=fixture(),{hash:_hash,...body}=f.report;const forged={...body,files:[{path:'apps/server/src/owner_auth.ts',content:'bypass',baseHash:null}]};const report={...forged,hash:sourceHash(JSON.stringify(forged))};
    await expect(prepareAppCode(f.root,'config',f.config,report.id,report.hash,f.execute,async()=>report,f.active)).rejects.toThrow('APP_CODE_PATH_DENIED');expect(f.commands).toEqual([]);expect(f.supervisor.list()).toEqual([]);
  });
  it('rejects changed report hashes and stale generations before creating a proposal or release',async()=>{
    const f=fixture();await expect(prepareAppCode(f.root,'config',f.config,f.report.id,'b'.repeat(64),f.execute,async()=>f.report,f.active)).rejects.toThrow('APP_CODE_REPORT_CHANGED');
    await expect(prepareAppCode(f.root,'config',f.config,f.report.id,f.report.hash,f.execute,async()=>f.report,()=>({...f.active(),generation:{id:'G0002',release_id:'r2'}}))).rejects.toThrow('APP_CODE_BASE_CHANGED');expect(f.commands).toEqual([]);
  });
  it('reads the report only after authenticating to the main service with a separate session',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:200,headers:{'set-cookie':'emergent_owner=internal; HttpOnly'}})).mockResolvedValueOnce(new Response('{"id":"report"}',{status:200}));
    expect(await readAppCodeReport({appUrl:'http://127.0.0.1:8765'},`code_${'a'.repeat(32)}`,'test-secret',fetcher)).toEqual({id:'report'});
    expect(fetcher.mock.calls[1][1].headers).toEqual({cookie:'emergent_owner=internal'});
    const denied=vi.fn().mockResolvedValue(new Response('{}',{status:401}));await expect(readAppCodeReport({appUrl:'http://127.0.0.1:8765'},`code_${'a'.repeat(32)}`,'wrong',denied)).rejects.toThrow('APP_CODE_OWNER_AUTH_FAILED');expect(denied).toHaveBeenCalledTimes(1);
  });
  it('reuses the internal read session so repeated report views cannot exhaust the Owner login limit',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:200,headers:{'set-cookie':'emergent_owner=internal; HttpOnly'}})).mockResolvedValueOnce(new Response('{}',{status:200})).mockResolvedValueOnce(new Response('{}',{status:200}));
    const session={};for(let n=0;n<2;n++)await readAppCodeReport({appUrl:'http://127.0.0.1:8765'},`code_${'a'.repeat(32)}`,'secret',fetcher,session);
    expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls.filter(c=>c[0].endsWith('/api/login'))).toHaveLength(1);
  });
  it('keeps every server module imported by the 8766 entry point outside the cell write catalogue',()=>{
    const visited=new Set<string>();
    const walk=(file:string)=>{if(visited.has(file))return;visited.add(file);const source=fs.readFileSync(file,'utf8');
      if(file.includes('/apps/server/dist/')||file.includes('\\apps\\server\\dist\\')){
        const relative=file.slice(resolve('apps/server/dist').length+1).replaceAll('\\','/').replace(/\.js$/,'.ts');expect(()=>appCodePath('apps/server/src/'+relative),relative).toThrow('APP_CODE_PATH_DENIED');
      }
      for(const match of source.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+\.(?:js|mjs))['"]/g)){const dependency=resolve(dirname(file),match[1]);if(fs.existsSync(dependency))walk(dependency);}
    };walk(resolve('scripts/upgrade-web.mjs'));
    expect(visited.size).toBeGreaterThan(10);
  });
});
