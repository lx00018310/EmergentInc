import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Checked entries avoid Node's Windows non-ASCII cpSync failure and never follow Body symlinks. */
export function copyDirectoryNew(source:string,target:string){
  const relative=path.relative(path.resolve(source),path.resolve(target));
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('COPY_TARGET_WITHIN_SOURCE');
  const copy=(from:string,to:string)=>{if(fs.existsSync(to))throw new Error('COPY_TARGET_EXISTS');const stat=fs.lstatSync(from);
    if(stat.isSymbolicLink())throw new Error('COPY_SYMLINK_FORBIDDEN');if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from))copy(path.join(from,name),path.join(to,name));}
    else if(stat.isFile()){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}else throw new Error('COPY_SPECIAL_FILE_FORBIDDEN');};copy(source,target);
}

/** Trusted online snapshots, including committed WAL. Never restore Lineage over live history. */
export async function snapshotDatabase(source: string, target: string) {
  for (let attempt=0; ; attempt++) {
    try { return await snapshotDatabaseOnce(source,target); }
    catch (error) {
      const sqlite=(error as Error & {cause?:{error?:{errcode?:number}}}).cause?.error;
      // Windows can briefly retain a mapped file after its process exits (SQLITE_IOERR_TRUNCATE).
      if(process.platform!=='win32'||sqlite?.errcode!==1546||attempt===4)throw error;
      await new Promise(done=>setTimeout(done,100));
    }
  }
}

async function snapshotDatabaseOnce(source: string, target: string) {
  if (!existsSync(source) || existsSync(target)) throw new Error("SNAPSHOT_NEW_TARGET_REQUIRED");
  mkdirSync(dirname(target), { recursive: true });
  const temporary = target + '.partial-' + randomBytes(8).toString('hex');
  writeFileSync(temporary, "", { flag: "wx", mode: 0o600 });
  try {
    const db = new DatabaseSync(source);
    try { db.exec('PRAGMA query_only=ON'); await backup(db, temporary); } finally { db.close(); }
    const copied = new DatabaseSync(temporary, { readOnly: true });
    try {
      const check = copied.prepare("PRAGMA integrity_check").all();
      if (check.length !== 1 || check[0]!.integrity_check !== "ok") throw new Error("SNAPSHOT_INTEGRITY_FAILED");
    } finally { copied.close(); }
    const sha256 = createHash("sha256").update(readFileSync(temporary)).digest("hex");
    if (existsSync(target)) throw new Error("SNAPSHOT_NEW_TARGET_REQUIRED");
    fs.renameSync(temporary, target);
    writeFileSync(`${target}.manifest.json`, JSON.stringify({ source, sha256, created_at: Date.now() }), { flag: "wx", mode: 0o600 });
    return sha256;
  } catch (error) {
    throw new Error('SNAPSHOT_DATABASE_FAILED', { cause: { source, target, error } });
  } finally {
    // A failed backup must not become a frozen snapshot merely because an empty file exists.
    for (const file of [temporary, temporary+'-wal', temporary+'-shm']) if (existsSync(file)) fs.unlinkSync(file);
  }
}
