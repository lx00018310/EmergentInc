import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CurrentStore, LineageStore, SqliteDatabase, readGenome, generationDirectory, writeGenerationPointer } from "@emergentinc/persistence";
import { lifeId, lifeText } from "@emergentinc/protocol";
import { GeneRequest, GeneCandidate, EvolutionRuntime } from "./protocol.js";
import { ReleaseBuilder, releaseHash, evolutionHash } from "./release_builder.js";
import { snapshotDatabase,copyDirectoryNew } from "./migration_runner.js";
import { GenerationMigrator } from "./generation_migrator.js";

/** Installed administrator implementation. Its DB and approvals must be inaccessible to the app user. */
export class GenerationSupervisor {
  private db: SqliteDatabase;
  private busy = false;
  private builder: ReleaseBuilder;
  constructor(readonly directory: string, readonly workspace: string, readonly releases: string,
    readonly lineage: LineageStore, readonly runtime: EvolutionRuntime, exclusiveEvolutionLockHeld: true,
    readonly activePointer = path.join(workspace, "active-generation.json")) {
    if (!exclusiveEvolutionLockHeld) throw new Error("EVOLUTION_LOCK_REQUIRED");
    this.builder = new ReleaseBuilder(releases);
    this.db = new SqliteDatabase(path.join(directory, "evolution.sqlite3"));
    this.db.transaction(() => {
      const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
      if (version === 1) return;
      if (version !== 0 || this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)
        throw new Error("UNSUPPORTED_EVOLUTION_SCHEMA");
      this.db.exec(`CREATE TABLE candidates(id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
        directory TEXT NOT NULL, state TEXT NOT NULL, candidate_json TEXT, approval_hash TEXT, approved_at INTEGER,
        target_generation TEXT, previous_release TEXT, phase TEXT, failure_reason TEXT, created_at INTEGER NOT NULL);
        CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT NOT NULL REFERENCES candidates(id),
          kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
        PRAGMA user_version=1;`);
    });
  }
  close() { if (this.busy) throw new Error("EVOLUTION_BUSY"); this.db.close(); }
  get(id: string): Record<string, any> {
    const c = this.db.prepare("SELECT * FROM candidates WHERE id=?").get(id);
    if (!c) throw new Error("GENE_CANDIDATE_NOT_FOUND");
    return { ...c, request: JSON.parse(String(c.request_json)), candidate: c.candidate_json ? JSON.parse(String(c.candidate_json)) : null };
  }
  list() { return this.db.prepare("SELECT id,state,approval_hash,target_generation,phase,failure_reason,created_at FROM candidates ORDER BY created_at DESC").all(); }
  private event(id: string, kind: string, payload: unknown = {}) {
    const row=this.db.prepare("INSERT INTO events(candidate_id,kind,payload,created_at) VALUES(?,?,?,?)").run(id, kind, JSON.stringify(payload), Date.now());
    if(this.runtime.worlds){const target=this.db.prepare('SELECT target_generation FROM candidates WHERE id=?').get(id)?.target_generation;
      const generation=target&&this.lineage.db.prepare('SELECT id FROM generations WHERE id=?').get(target)?String(target):String(this.lineage.activeGeneration()!.id);
      this.lineage.lifeEvent(generation,kind,{candidateId:id,...payload as object},`evolution:${id}:${row.lastInsertRowid}`,undefined,(payload as any)?.worldId);
    }
  }
  private base(request: GeneRequest) {
    const active = this.lineage.activeGeneration();
    if (!active || active.id !== request.base_generation || active.release_id !== request.base_release) throw new Error("CANDIDATE_BASE_CONFLICT");
    if (this.runtime.activeRelease && this.runtime.activeRelease() !== fs.realpathSync(path.join(this.releases, active.release_id)))
      throw new Error("ACTIVE_TRUSTED_RELEASE_CONFLICT");
    if (!fs.existsSync(this.activePointer) || JSON.parse(fs.readFileSync(this.activePointer, "utf8")).generation_id !== active.id ||
        readGenome(path.join(this.releases, active.release_id)).geneHash !== active.gene_hash) throw new Error("ACTIVE_TRUSTED_RELEASE_CONFLICT");
    const proposal = this.lineage.proposal(request.proposal_id);
    if (!proposal.owner_decided_at || proposal.generation_id !== active.id || !["APPROVED", "IMPLEMENTING", "CANDIDATE_READY"].includes(proposal.state))
      throw new Error("OWNER_PROPOSAL_DIRECTION_APPROVAL_REQUIRED");
    return active;
  }
  submit(request: GeneRequest) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    lifeId(request?.id); lifeId(request.base_generation); lifeId(request.base_release); lifeId(request.proposal_id);
    if (request.owner_release) throw new Error("OWNER_RELEASE_REQUIRES_LOCAL_OWNER_ENTRY");
    this.base(request);
    const requestHash = evolutionHash(request), existing = this.db.prepare("SELECT id FROM candidates WHERE id=?").get(request.id);
    if (existing) { const c = this.get(request.id); if (c.request_hash !== requestHash) throw new Error("GENE_IDEMPOTENCY_CONFLICT"); return c; }
    const directory = this.builder.create(path.join(this.releases, request.base_release), request.id, request.patch);
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO candidates(id,request_hash,request_json,directory,state,created_at) VALUES(?,?,?,?,'SUBMITTED',?)")
        .run(request.id, requestHash, JSON.stringify(request), directory, Date.now());
      this.event(request.id, "gene_candidate_submitted", { patchHash: evolutionHash(request.patch) });
    });
    this.lineage.db.prepare("UPDATE gene_proposals SET state='IMPLEMENTING' WHERE id=?").run(request.proposal_id);
    return this.get(request.id);
  }
  /** Explicit installed Owner CLI only; normal Gene submission still forbids Root changes. */
  submitOwnerRelease(request: GeneRequest) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    lifeId(request.id); lifeId(request.base_generation); lifeId(request.base_release); lifeId(request.proposal_id);
    const owner = request.owner_release;
    if (!owner || request.patch.length || !/^[a-f0-9]{40}$/.test(owner.source_commit) || !/^[a-f0-9]{64}$/.test(owner.release_hash))
      throw new Error("INVALID_OWNER_RELEASE");
    lifeText(owner.reason, 1000); this.base(request);
    const requestHash = evolutionHash(request), existing = this.db.prepare("SELECT id FROM candidates WHERE id=?").get(request.id);
    if (existing) { const c = this.get(request.id); if (c.request_hash !== requestHash) throw new Error("GENE_IDEMPOTENCY_CONFLICT"); return c; }
    const directory = path.join(this.releases, request.id);
    if (fs.realpathSync(directory) !== directory || releaseHash(directory) !== owner.release_hash) throw new Error("OWNER_RELEASE_INTEGRITY_CONFLICT");
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO candidates(id,request_hash,request_json,directory,state,created_at) VALUES(?,?,?,?,'SUBMITTED',?)")
        .run(request.id, requestHash, JSON.stringify(request), directory, Date.now());
      this.event(request.id, "owner_software_release_submitted", owner);
    });
    this.lineage.db.prepare("UPDATE gene_proposals SET state='IMPLEMENTING' WHERE id=?").run(request.proposal_id);
    return this.get(request.id);
  }
  private nextNumber() { return Number(this.lineage.db.prepare("SELECT COALESCE(MAX(generation_no),0)+1 n FROM generations").get()!.n); }
  async validate(id: string) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    const c = this.get(id), base = this.base(c.request);
    if (["VALIDATED", "APPROVED"].includes(c.state)) { this.checked(c); return c; }
    if (c.state !== "SUBMITTED") throw new Error("GENE_NOT_VALIDATABLE");
    this.busy = true;
    try {
      await this.runtime.validateRelease(c.directory); // Fixed trusted sequence: typecheck, test, build.
      const genome = readGenome(c.directory);
      if (genome.geneHash === base.gene_hash) throw new Error("GENE_HASH_MUST_CHANGE");
      if (genome.manifest.generation !== this.nextNumber()) throw new Error("GENOME_GENERATION_NUMBER_CONFLICT");
      const bound = { id, base_generation: c.request.base_generation, base_release: c.request.base_release,
        proposal_id: c.request.proposal_id, patch_hash: evolutionHash(c.request.patch), gene_hash: genome.geneHash,
        candidate_release_hash: releaseHash(c.directory), release_id: id, ...(c.request.owner_release ? {owner_release: c.request.owner_release} : {}) };
      const candidate: GeneCandidate = { ...bound, candidate_hash: evolutionHash(bound), directory: c.directory };
      this.db.transaction(() => {
        this.db.prepare("UPDATE candidates SET state='VALIDATED',candidate_json=? WHERE id=?").run(JSON.stringify(candidate), id);
        this.event(id, "gene_candidate_validated", candidate);
      });
      this.lineage.db.prepare("UPDATE gene_proposals SET state='CANDIDATE_READY',candidate_hash=? WHERE id=?")
        .run(candidate.candidate_hash, candidate.proposal_id);
      return this.get(id);
    } catch (e) {
      this.event(id, "gene_validation_failed", { reason: e instanceof Error ? e.message : "VALIDATION_FAILED" }); throw e;
    } finally { this.busy = false; }
  }
  private checked(c: Record<string, any>): GeneCandidate {
    const candidate = c.candidate as GeneCandidate | null;
    if (evolutionHash(c.request) !== c.request_hash || evolutionHash(candidate?.owner_release ?? null) !== evolutionHash(c.request.owner_release ?? null))
      throw new Error("GENE_CANDIDATE_INTEGRITY_CONFLICT");
    if (!candidate || candidate.directory !== c.directory || candidate.release_id !== c.id ||
        candidate.patch_hash !== evolutionHash(c.request.patch) || candidate.gene_hash !== readGenome(c.directory).geneHash ||
        candidate.candidate_release_hash !== releaseHash(c.directory)) throw new Error("GENE_CANDIDATE_INTEGRITY_CONFLICT");
    const { candidate_hash, directory: _directory, ...bound } = candidate;
    if (candidate_hash !== evolutionHash(bound) || candidate.base_generation !== c.request.base_generation ||
        candidate.base_release !== c.request.base_release || candidate.proposal_id !== c.request.proposal_id)
      throw new Error("GENE_CANDIDATE_INTEGRITY_CONFLICT");
    return candidate;
  }
  approve(id: string, exactHash: string) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    const c = this.get(id), candidate = this.checked(c); this.base(c.request);
    if (exactHash !== candidate.candidate_hash) throw new Error("OWNER_CANDIDATE_HASH_CONFLICT");
    if (!["VALIDATED", "APPROVED"].includes(c.state)) throw new Error("GENE_NOT_APPROVABLE");
    this.lineage.db.prepare("UPDATE gene_proposals SET candidate_hash=? WHERE id=?").run(exactHash, candidate.proposal_id);
    if (c.state === "APPROVED" && c.approval_hash === exactHash) return c;
    this.db.transaction(() => {
      this.db.prepare("UPDATE candidates SET state='APPROVED',approval_hash=?,approved_at=? WHERE id=?").run(exactHash, Date.now(), id);
      this.event(id, "owner_exact_candidate_approved", { candidateHash: exactHash });
    });
    return this.get(id);
  }
  private phase(id: string, phase: string) {
    this.db.prepare("UPDATE candidates SET phase=? WHERE id=?").run(phase, id); this.event(id, phase);
  }
  async birth(id: string) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    const c = this.get(id);
    if (c.state === "BORN") return c;
    const candidate = this.checked(c), previous = this.base(c.request);
    if (c.state !== "APPROVED" || c.approval_hash !== candidate.candidate_hash) throw new Error("OWNER_EXACT_CANDIDATE_APPROVAL_REQUIRED");
    if (this.lineage.proposal(candidate.proposal_id).candidate_hash !== candidate.candidate_hash) throw new Error("GENE_PROPOSAL_CANDIDATE_CONFLICT");
    if (this.db.prepare("SELECT id FROM candidates WHERE state IN ('BIRTHING','ROLLING_BACK')").get()) throw new Error("EVOLUTION_RECOVERY_REQUIRED");
    const number = this.nextNumber(), generation = `G${String(number).padStart(4, "0")}`;
    const genome = readGenome(candidate.directory).manifest;
    if (genome.generation !== number) throw new Error("GENOME_GENERATION_NUMBER_CONFLICT");
    this.busy = true;
    const snapshots = path.join(this.directory, "snapshots", id), newDirectory = generationDirectory(this.workspace, generation);
    let current: CurrentStore | undefined, old: CurrentStore | undefined, quiesced = false, switching = false, runningChecked = false;
    try {
      await this.runtime.checkRunning?.(previous.id); runningChecked = true;
      await this.runtime.quiesce(); quiesced = true;
      await snapshotDatabase(this.lineage.db.dbPath, path.join(snapshots, "lineage-before.sqlite3"));
      if(this.runtime.worlds){
        await snapshotDatabase(path.join(this.workspace,'control/control.sqlite3'),path.join(snapshots,'control-before.sqlite3'));
        const paymentFile=path.join(this.workspace,'payment/payment.sqlite3');
        if(fs.existsSync(paymentFile))await snapshotDatabase(paymentFile,path.join(snapshots,'payment-before.sqlite3'));
      }
      const oldDirectory = generationDirectory(this.workspace, previous.id);
      await snapshotDatabase(path.join(oldDirectory, "current.sqlite3"), path.join(snapshots, "current-before.sqlite3"));
      if (!c.request.owner_release) await this.runtime.finalDream();
      // Persist intent before creating either the generation row or its Current DB.
      this.db.prepare("UPDATE candidates SET state='BIRTHING',target_generation=?,previous_release=?,phase='MIGRATING' WHERE id=?")
        .run(generation, previous.release_id, id);
      const target = this.lineage.createGeneration({ id: generation, number, parentId: previous.id, geneHash: candidate.gene_hash, releaseId: id });
      this.lineage.db.prepare("UPDATE gene_proposals SET target_generation_id=? WHERE id=?").run(generation, candidate.proposal_id);
      current = new CurrentStore(path.join(newDirectory, "current.sqlite3")); current.initialize(target, genome.body_interface_version);
      old = new CurrentStore(path.join(snapshots, "current-before.sqlite3"),{readOnly:true});
      new GenerationMigrator().migrate(old, current, path.join(oldDirectory, "body/skills"), path.join(newDirectory, "body/skills"));
      old.close(); old = undefined; current.close(); current = undefined;
      await this.runtime.prepareCurrent?.(newDirectory);
      const worlds=this.runtime.worlds?.()??[];
      this.event(id,'world_migration_planned',{total:worlds.length});
      for(const world of worlds){
        lifeId(world.id);
        try{
          const oldWorld=path.join(world.directory,'generations',previous.id),nextWorld=path.join(world.directory,'generations',generation);
          const snapshot=path.join(snapshots,'worlds',world.id,'current-before.sqlite3');await snapshotDatabase(path.join(oldWorld,'current.sqlite3'),snapshot);
          const from=new CurrentStore(snapshot,{readOnly:true}),to=new CurrentStore(path.join(nextWorld,'current.sqlite3'));
          try{to.initialize(target,genome.body_interface_version);new GenerationMigrator().migrate(from,to,path.join(oldWorld,'body/skills'),path.join(nextWorld,'body/skills'));}
          finally{from.close();to.close();}
          await this.runtime.prepareCurrent?.(nextWorld);
          this.event(id,'world_current_migrated',{worldId:world.id,generation});
        }catch(error){this.event(id,'world_current_migration_failed',{worldId:world.id,reason:error instanceof Error?error.message:'WORLD_MIGRATION_FAILED'});throw error;}
      }

      if (c.request.owner_release) {
        const files: {file:string;sha256:string}[] = [];
        const walk = (directory:string) => { for (const name of fs.readdirSync(directory)) {
          const file=path.join(directory,name); if(fs.statSync(file).isDirectory())walk(file);
          else if(name.endsWith('.sqlite3'))files.push({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
        }}; walk(snapshots);
        this.lineage.lifeEvent(previous.id, "OWNER_MAINTENANCE_DREAM_DEFERRED", {
          candidateId:id, reason:c.request.owner_release.reason, source_generation:previous.id, snapshots:files,
          policy:"RAW_FACTS_RETAINED_NO_MODEL_NO_COMPLETED_DREAM"
        }, `owner-maintenance-dream:${id}`);
      }
      // Entirely separate workspace: cloned Lineage, cloned Current, no private credentials.
      const testWorkspace = path.join(this.directory, "candidate-workspaces", id);
      const testSystem=this.runtime.worlds?path.join(testWorkspace,'system'):testWorkspace;
      const testLineagePath = path.join(testSystem, "lineage/lineage.sqlite3");
      await snapshotDatabase(this.lineage.db.dbPath, testLineagePath);
      const testLineage = new LineageStore(testLineagePath);
      try { testLineage.db.transaction(() => {
        testLineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE state='ACTIVE'").run();
        testLineage.db.prepare("UPDATE generations SET state='ACTIVE' WHERE id=?").run(generation);
      }); } finally { testLineage.close(); }
      const testGeneration = generationDirectory(testSystem, generation);
      await snapshotDatabase(path.join(newDirectory, "current.sqlite3"), path.join(testGeneration, "current.sqlite3"));
      copyDirectoryNew(path.join(newDirectory, "body"), path.join(testGeneration, "body"));
      writeGenerationPointer(testSystem, generation);
      if(this.runtime.worlds){
        await snapshotDatabase(path.join(this.workspace,'control/control.sqlite3'),path.join(testSystem,'control/control.sqlite3'));
        const paymentFile=path.join(this.workspace,'payment/payment.sqlite3');
        if(fs.existsSync(paymentFile))await snapshotDatabase(paymentFile,path.join(testSystem,'payment/payment.sqlite3'));
        for(const world of worlds){const copied=path.join(testWorkspace,'worlds',world.id);
          copyDirectoryNew(path.join(world.directory,'live'),path.join(copied,'live'));
          fs.copyFileSync(path.join(world.directory,'world.json'),path.join(copied,'world.json'),fs.constants.COPYFILE_EXCL);
          await snapshotDatabase(path.join(world.directory,'ledger/v9_core.sqlite3'),path.join(copied,'ledger/v9_core.sqlite3'));
          const nextWorld=path.join(world.directory,'generations',generation),testWorld=path.join(copied,'generations',generation);
          await snapshotDatabase(path.join(nextWorld,'current.sqlite3'),path.join(testWorld,'current.sqlite3'));
          copyDirectoryNew(path.join(nextWorld,'body'),path.join(testWorld,'body'));
        }
        fs.writeFileSync(path.join(testWorkspace,'workspace-layout.json'),JSON.stringify({schema:1,version:23,candidate:true}),{flag:'wx'});
      }
      this.phase(id, "CANDIDATE_SMOKE");
      await this.runtime.smoke(candidate.directory, testWorkspace, generation);
      this.checked(this.get(id)); // Smoke must not alter any approved artifact.
      switching = true; this.phase(id, "SWITCHING");
      await this.runtime.stop();
      await this.runtime.switchRelease(candidate.directory);
      writeGenerationPointer(this.workspace, generation, this.activePointer);
      this.phase(id, "STARTING");
      await this.runtime.start(); await this.runtime.healthy(generation);
      this.lineage.db.transaction(() => {
        this.lineage.db.prepare("UPDATE generations SET state='RETIRED',retired_at=? WHERE id=?").run(Date.now(), previous.id);
        this.lineage.db.prepare("UPDATE generations SET state='ACTIVE',born_at=? WHERE id=?").run(Date.now(), generation);
        this.lineage.db.prepare("UPDATE gene_proposals SET state='BORN' WHERE id=?").run(candidate.proposal_id);
        this.lineage.remember(generation, "generation_birth", { point: `${generation} 成功接管，${previous.id} 退休`, reason: "准确候选批准、部分迁移与启动检查通过",
          effect: "Lineage 没有回滚；新 Current 开始记录下一代" }, `birth:${generation}`, undefined, 4);
        this.lineage.lifeEvent(generation, "generation_birth", { previous: previous.id, release: id }, `birth-event:${generation}`);
      });
      await this.runtime.resume();
      this.db.prepare("UPDATE candidates SET state='BORN',phase='COMPLETED' WHERE id=?").run(id);
      this.event(id, "generation_born", { generation });
      return this.get(id);
    } catch (e) {
      current?.close(); current = undefined; old?.close(); old = undefined;
      const reason = e instanceof Error ? e.message : "BIRTH_FAILED";
      if (!runningChecked) { this.event(id, "publication_blocked", { reason }); throw e; }
      this.db.prepare("UPDATE candidates SET failure_reason=? WHERE id=?").run(reason, id);
      if (switching || this.get(id).state === "BIRTHING") await this.restore(id, reason, "FAILED");
      else {
        this.lineage.db.prepare("UPDATE gene_proposals SET state='FAILED' WHERE id=?").run(candidate.proposal_id);
        if (quiesced) await this.runtime.resume();
        this.db.prepare("UPDATE candidates SET state='FAILED',phase='FAILED' WHERE id=?").run(id);
      }
      throw e;
    } finally { current?.close(); old?.close(); this.busy = false; }
  }
  private async restore(id: string, reason: string, state: "FAILED" | "ROLLED_BACK") {
    const c = this.get(id), generation = String(c.target_generation), previous = this.lineage.generation(c.request.base_generation);
    reason = c.failure_reason ?? reason;
    if (["MIGRATING", "CANDIDATE_SMOKE"].includes(c.phase)) {
      if (this.lineage.activeGeneration()?.id !== previous.id ||
          JSON.parse(fs.readFileSync(this.activePointer, "utf8")).generation_id !== previous.id)
        throw new Error("PRE_SWITCH_RECOVERY_CONFLICT");
      this.db.prepare("UPDATE candidates SET failure_reason=? WHERE id=?").run(reason, id);
      this.lineage.db.transaction(() => {
        if (this.lineage.db.prepare("SELECT id FROM generations WHERE id=?").get(generation)) {
          this.lineage.db.prepare("UPDATE generations SET state='FAILED',failure_reason=? WHERE id=?").run(reason, generation);
          this.lineage.remember(generation, "generation_failure", { point: `${generation} 未出生`, reason: reason.slice(0, 1000),
            effect: `${previous.id} 继续运行；候选 Current 保留` }, `birth-failed:${generation}`, undefined, 4);
        }
        this.lineage.db.prepare("UPDATE gene_proposals SET state='FAILED' WHERE id=?").run(c.request.proposal_id);
      });
      // The old release was never stopped. No new Current is required to abandon a partial migration.
      await this.runtime.resume();
      this.db.prepare("UPDATE candidates SET state='FAILED',phase='RESTORED' WHERE id=?").run(id);
      this.event(id, "generation_abandoned_before_switch", { generation, previous: previous.id });
      return;
    }
    this.db.prepare("UPDATE candidates SET state='ROLLING_BACK',phase='STOPPING',failure_reason=? WHERE id=?").run(reason, id);
    this.runtime.checkRollback?.(path.join(this.releases, previous.release_id));
    await this.runtime.stop();
    await this.runtime.prepareRollback?.(path.join(this.releases, previous.release_id));
    const frozen = path.join(this.directory, "frozen", `${generation}-${id}`, "current.sqlite3");
    const frozenHash = fs.existsSync(frozen)?createHash('sha256').update(fs.readFileSync(frozen)).digest('hex'):await snapshotDatabase(path.join(generationDirectory(this.workspace, generation), "current.sqlite3"), frozen);
    const frozenWorlds:{worldId:string;file:string;sha256:string}[]=[];
    for(const world of this.runtime.worlds?.()??[]){
      const file=path.join(world.directory,'generations',generation,'current.sqlite3');if(fs.existsSync(file)){
        const target=path.join(this.directory,'frozen',`${generation}-${id}`,'worlds',world.id,'current.sqlite3');
        const sha256=fs.existsSync(target)?createHash('sha256').update(fs.readFileSync(target)).digest('hex'):await snapshotDatabase(file,target);
        frozenWorlds.push({worldId:world.id,file:target,sha256});
      }
    }
    // Never invoke Dream during emergency recovery and never restore Lineage from a backup.
    const prior=this.lineage.db.prepare('SELECT payload FROM life_events WHERE source_ref=?').get(`post-rollback:${generation}`);
    this.lineage.lifeEvent(generation, "POST_ROLLBACK_DREAM_REQUIRED", prior?JSON.parse(String(prior.payload)):{ frozen_current: frozen, sha256: frozenHash, worlds:frozenWorlds, reason }, `post-rollback:${generation}`);
    await this.runtime.switchRelease(path.join(this.releases, previous.release_id));
    if(this.runtime.worlds){
      const control=new SqliteDatabase(path.join(this.workspace,'control/control.sqlite3'));
      try { for(const world of this.runtime.worlds()){
        if(fs.existsSync(path.join(world.directory,'generations',previous.id,'current.sqlite3')))continue;
        const identity=JSON.parse(fs.readFileSync(path.join(world.directory,'world.json'),'utf8'));
        if(identity.created_generation!==generation)throw new Error('PREVIOUS_WORLD_CURRENT_MISSING');
        control.prepare('INSERT OR IGNORE INTO world_recovery_blocks VALUES(?,?,?,?)').run(world.id,generation,'WORLD_CREATED_AFTER_RESTORED_GENERATION',Date.now());
        this.lineage.lifeEvent(generation,'world_generation_recovery_required',{worldId:world.id,restored:previous.id},`world-recovery:${world.id}:${generation}`,undefined,world.id);
      }} finally {control.close();}
    }
    writeGenerationPointer(this.workspace, previous.id, this.activePointer);
    this.lineage.db.transaction(() => {
      this.lineage.db.prepare("UPDATE generations SET state=?,failure_reason=? WHERE id=?").run(state, reason, generation);
      this.lineage.db.prepare("UPDATE generations SET state='ACTIVE',retired_at=NULL WHERE id=?").run(previous.id);
      this.lineage.remember(generation, "generation_rollback", { point: `${generation} 已回退到 ${previous.id}`,
        reason: reason.slice(0, 1000), effect: "代码与 Current 恢复；Lineage 保留，失败 Current 已冻结，待恢复后整理" }, `rollback:${generation}`, undefined, 5);
      this.lineage.db.prepare("UPDATE gene_proposals SET state='FAILED' WHERE id=?").run(c.request.proposal_id);
    });
    await this.runtime.start(); await this.runtime.healthy(previous.id); await this.runtime.resume();
    this.db.prepare("UPDATE candidates SET state=?,phase='RESTORED',failure_reason=? WHERE id=?").run(state, reason, id);
    this.event(id, "generation_restored", { generation, previous: previous.id, frozenHash });
  }
  async rollback(id: string, reason: string) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    lifeText(reason, 1000);
    const c = this.get(id);
    if (c.state === "ROLLED_BACK") return c;
    if (c.state !== "BORN" || this.lineage.activeGeneration()?.id !== c.target_generation) throw new Error("GENERATION_NOT_ACTIVE");
    this.busy = true;
    try {
      this.runtime.checkRollback?.(path.join(this.releases, c.request.base_release));
      await this.runtime.quiesce();
      try { this.runtime.checkRollback?.(path.join(this.releases, c.request.base_release)); } catch (e) { await this.runtime.resume(); throw e; }
      await this.restore(id, reason, "ROLLED_BACK"); return this.get(id); } finally { this.busy = false; }
  }
  async recover() {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    this.busy = true;
    try {
      for (const row of this.db.prepare("SELECT id FROM candidates WHERE state IN ('BIRTHING','ROLLING_BACK') ORDER BY created_at").all())
        await this.restore(String(row.id), "INTERRUPTED_BIRTH_RECOVERY", "FAILED");
      await this.runtime.checkRunning?.(this.lineage.activeGeneration()!.id);
      return this.list();
    } finally { this.busy = false; }
  }
  async postRollbackDream(id: string) {
    if (this.busy) throw new Error("EVOLUTION_BUSY");
    const candidate = this.get(id);
    if (!["FAILED", "ROLLED_BACK"].includes(candidate.state) || !candidate.target_generation || !this.runtime.postRollbackDream)
      throw new Error("POST_ROLLBACK_DREAM_NOT_AVAILABLE");
    const pending = this.lineage.db.prepare("SELECT * FROM life_events WHERE source_ref=?").get(`post-rollback:${candidate.target_generation}`);
    if (!pending) throw new Error("FROZEN_CURRENT_NOT_FOUND");
    const snapshot = JSON.parse(String(pending.payload));
    const buffer = fs.readFileSync(snapshot.frozen_current);
    if (createHash("sha256").update(buffer).digest("hex") !== snapshot.sha256) throw new Error("FROZEN_CURRENT_HASH_CONFLICT");
    const frozen = new DatabaseSync(snapshot.frozen_current, { readOnly: true });
    try {
      const last = this.lineage.db.prepare("SELECT to_cursor FROM dream_runs WHERE generation_id=? AND status='COMPLETED' ORDER BY finished_at DESC LIMIT 1").get(candidate.target_generation);
      const cursor = last ? JSON.parse(String(last.to_cursor)).current : 0;
      const facts:unknown[] = frozen.prepare("SELECT sequence,kind,pixel_id,payload FROM current_events WHERE sequence>? ORDER BY sequence DESC LIMIT 40").all(cursor).reverse()
        .map(r => ({ sequence: r.sequence, kind: r.kind, pixel_id: r.pixel_id, payload: String(r.payload).slice(0, 300) }));
      for(const world of snapshot.worlds??[]){
        if(createHash('sha256').update(fs.readFileSync(world.file)).digest('hex')!==world.sha256)throw new Error('FROZEN_WORLD_HASH_CONFLICT');
        const db=new DatabaseSync(world.file,{readOnly:true});try{
          const worldCursor=last?Number(JSON.parse(String(last.to_cursor)).worlds?.[world.worldId]??0):0;
          for(const row of db.prepare('SELECT sequence,kind,pixel_id,payload FROM current_events WHERE sequence>? ORDER BY sequence LIMIT 40').all(worldCursor))
            if(facts.length<40)facts.push({...row,payload:String(row.payload).slice(0,300),world_id:world.worldId});
        }finally{db.close();}
      }
      this.busy = true;
      await this.runtime.postRollbackDream({ source_generation: candidate.target_generation, sha256: snapshot.sha256, facts });
    } finally { frozen.close(); this.busy = false; }
  }
}
