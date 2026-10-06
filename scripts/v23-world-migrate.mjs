import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { CoreStore, WorldRegistryStore, LineageStore, CurrentStore, readGenome, writeGenerationPointer } from '../packages/persistence/dist/index.js';
import { WorldRegistryService } from '../apps/server/dist/services/world_registry_service.js';
import {workspaceManifest} from './v23-migration-dry-run.mjs';
import { copyTreeNew } from './local-upgrade.mjs';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote=x=>'"'+x.replaceAll('"','""')+'"';
/** Stage 1 rehearsal creates a NEW V23 workspace; source V22 and its attribution remain intact. */
export async function migrateV23Copy(stage0Directory,destination,projectRoot=path.resolve('.')) {
  const report=JSON.parse(fs.readFileSync(path.join(stage0Directory,'report.json'),'utf8'));
  if(!report.sourceUnchanged||report.stage!==0||report.rehearsal.conflicts.length)throw new Error('VERIFIED_STAGE0_WITHOUT_CONFLICTS_REQUIRED');
  if(fs.existsSync(destination))throw new Error('V23_MIGRATION_NEW_DESTINATION_REQUIRED');
  const base=fs.realpathSync(stage0Directory),target=path.resolve(destination);
  if(target===base||target.startsWith(base+path.sep))throw new Error('V23_MIGRATION_DESTINATION_MUST_BE_SEPARATE');
  for(const database of report.backup.databases)if(sha(path.join(base,'backup/snapshots',database.source))!==database.snapshotHash)throw new Error('V23_BACKUP_INTEGRITY_FAILED');
  const raw=path.join(base,'backup/raw'),snapshots=path.join(base,'backup/snapshots');
  if(createHash('sha256').update(JSON.stringify(workspaceManifest(raw))).digest('hex')!==report.backup.rawManifestHash)throw new Error('V23_RAW_BACKUP_INTEGRITY_FAILED');
  copyTreeNew(raw,path.join(target,'system/legacy/v22/raw'));
  copyTreeNew(snapshots,path.join(target,'system/legacy/v22/snapshots'));
  fs.mkdirSync(path.join(target,'system/lineage'),{recursive:true});
  fs.copyFileSync(path.join(snapshots,'lineage/lineage.sqlite3'),path.join(target,'system/lineage/lineage.sqlite3'),fs.constants.COPYFILE_EXCL);
  if(fs.existsSync(path.join(raw,'assets')))copyTreeNew(path.join(raw,'assets'),path.join(target,'assets'));
  const lineage=new LineageStore(path.join(target,'system/lineage/lineage.sqlite3'),{v23:true});
  const control=new WorldRegistryStore(path.join(target,'system/control/control.sqlite3'));
  const original=new DatabaseSync(path.join(snapshots,'ledger/v9_core.sqlite3'),{readOnly:true});
  let projection;
  try {
    control.transaction(()=>{
      control.db.exec('PRAGMA defer_foreign_keys=ON;');
      for(const table of ['qianji_profiles','qianji_narrative_revisions','qianji_bindings','qianji_draws','world_events','gacha_model_calls','gacha_images']){
        const columns=original.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>c.name);
        const rows=original.prepare(`SELECT * FROM ${quote(table)}`).all();
        const insert=control.db.prepare(`INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
        for(const row of rows)insert.run(...columns.map(c=>row[c]));
      }
      if(control.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('V23_IDENTITY_FOREIGN_KEYS_REQUIRE_REVIEW');
    });
    const genome=readGenome(projectRoot).manifest,registry=new WorldRegistryService(target,control,lineage,genome.body_interface_version);
    writeGenerationPointer(path.join(target,'system'),lineage.activeGeneration().id);
    const round=JSON.parse(fs.readFileSync(path.join(raw,'live/world_state.json'),'utf8')).round;
    for(const proposed of report.rehearsal.worlds){
      const binding=report.inventory.currentBindings.find(b=>b.qianji_id===proposed.qianjiId);
      const account=original.prepare('SELECT * FROM pixel_accounts WHERE pixel_id=?').get(binding.pixel_id);
      registry.create(control.qianji.getProfile(proposed.qianjiId).narrative,{qianjiId:proposed.qianjiId,worldId:proposed.worldId,
        existingProfile:true,pixelId:binding.pixel_id,pixelDirectory:path.join(raw,'live/pixels',binding.pixel_id),artifactDirectory:path.join(raw,'live/artifacts',binding.pixel_id),account,round});
    }
    const generation=lineage.activeGeneration();writeGenerationPointer(path.join(target,'system'),generation.id);
    // Administrative compatibility projection has no World working state or skills. World Currents are authoritative.
    projection=new CurrentStore(path.join(target,'system/generations',String(generation.id),'current.sqlite3'));projection.initialize(generation,genome.body_interface_version);fs.mkdirSync(path.join(target,'system/generations',String(generation.id),'body/skills'),{recursive:true});
    const receipt={schema:1,phase:'REHEARSED',v22Baseline:report.baseline,sourceManifestHash:report.sourceManifestHash,
      legacyHistory:'READ_ONLY_UNREASSIGNED',worlds:registry.list(),activeGeneration:generation.id,
      controlRuntimeTables:control.db.prepare("SELECT (SELECT COUNT(*) FROM runs)+(SELECT COUNT(*) FROM messages)+(SELECT COUNT(*) FROM model_calls) n").get().n};
    fs.mkdirSync(path.join(target,'migration/v23'),{recursive:true});fs.writeFileSync(path.join(target,'migration/v23/receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(target,'workspace-layout.json'),JSON.stringify({version:23,schema:1,migrationReceipt:'migration/v23/receipt.json'}),{flag:'wx'});
    return receipt;
  } finally {projection?.close();original.close();control.close();lineage.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {const [source,destination]=process.argv.slice(2);if(!source||!destination)throw new Error('Usage: v23-world-migrate <verified-stage0-directory> <new-V23-workspace>');console.log(JSON.stringify(await migrateV23Copy(source,destination),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
