import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LineageStore } from '../packages/persistence/dist/index.js';
import { verifyAppReport } from '../apps/server/dist/services/app_code_policy.js';
import { ownerEnvironment } from './local-release.mjs';
import { approvedWorldRelease } from './v23-approved-release.mjs';

// Only the independently authenticated Owner maintenance process calls this module.
export async function readAppCodeReport(config, id, secret, fetcher = fetch, session = {}) {
  if (!/^code_[a-f0-9]{32}$/.test(id)) throw new Error('APP_CODE_REPORT_INVALID');
  const read = cookie => fetcher(config.appUrl + '/api/owner/code-reports/' + id, {headers:{cookie},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(session.cookie){const response=await read(session.cookie);if(response.status!==401){if(!response.ok)throw new Error('APP_CODE_REPORT_UNAVAILABLE');return response.json();}session.cookie=undefined;}
  const login = await fetcher(config.appUrl + '/api/login', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret}),redirect:'error',signal:AbortSignal.timeout(10000) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if(!login.ok||!cookie)throw new Error('APP_CODE_OWNER_AUTH_FAILED');
  session.cookie=cookie;
  const response = await read(cookie);
  if(!response.ok)throw new Error('APP_CODE_REPORT_UNAVAILABLE');
  return response.json();
}
export async function prepareAppCode(root, configFile, config, id, exactReportHash, generation, readReport = readAppCodeReport, resolveActive = approvedWorldRelease) {
  if(!/^[a-f0-9]{64}$/.test(exactReportHash))throw new Error('APP_CODE_REPORT_CHANGED');
  const report = await readReport(config,id,ownerEnvironment(root).EMERGENTINC_OWNER_SECRET);
  const active = resolveActive(config.workspace,configFile);
  if(report.id!==id||report.hash!==exactReportHash)throw new Error('APP_CODE_REPORT_CHANGED');
  // Recheck protected paths, exact source hashes and base against the trusted active release.
  verifyAppReport(report,active.directory,String(active.generation.id),String(active.generation.release_id));
  const lineage=new LineageStore(path.join(config.workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  try {
    const candidateId=`app-code_${id.slice(5)}_${randomUUID().slice(0,8)}`;
    const manifest=JSON.parse(fs.readFileSync(path.join(active.directory,'genome/manifest.json'),'utf8'));
    manifest.generation=Number(lineage.db.prepare('SELECT MAX(generation_no)+1 n FROM generations').get().n);
    const proposal=lineage.proposeGene(String(active.generation.id),'owner',{point:`8765 source: ${report.title}`,reason:report.summary,effect:'Candidate source only; independent validation and exact-hash publication approval required'},`owner-code:${candidateId}`);
    lineage.decideProposal(proposal.id,'APPROVED');
    const request={id:candidateId,base_generation:report.baseGeneration,base_release:report.baseRelease,proposal_id:proposal.id,
      patch:[...report.files.map(({path,content})=>({path,content})),{path:'genome/manifest.json',content:JSON.stringify(manifest,null,2)+'\n'}],
      app_code_report:{id:report.id,hash:report.hash,title:report.title,reason:report.summary,personName:report.personName}};
    const file=path.join(config.stateDirectory,candidateId+'.request.json');fs.writeFileSync(file,JSON.stringify(request,null,2),{flag:'wx'});
    await generation(configFile,'submit',file);await generation(configFile,'validate',candidateId);return candidateId;
  } finally { lineage.close(); }
}
