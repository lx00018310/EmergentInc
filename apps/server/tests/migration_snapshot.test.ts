import {it,expect} from 'vitest';
import * as fs from 'node:fs';import{join,resolve,relative}from'node:path';import{DatabaseSync}from'node:sqlite';import{snapshotDatabase}from'../../../supervisor/migration_runner.js';
it('retains committed WAL facts and publishes only a complete new snapshot',async()=>{
 const root=fs.mkdtempSync(resolve('cache/snapshot-test-')),source=join(root,'source.sqlite3'),target=join(root,'frozen.sqlite3'),db=new DatabaseSync(source);
 try{db.exec('PRAGMA journal_mode=WAL; CREATE TABLE facts(value); INSERT INTO facts VALUES(42)');const hash=await snapshotDatabase(source,target),copy=new DatabaseSync(target,{readOnly:true});try{expect(copy.prepare('SELECT value FROM facts').get()!.value).toBe(42);}finally{copy.close();}expect(JSON.parse(fs.readFileSync(target+'.manifest.json','utf8')).sha256).toBe(hash);await expect(snapshotDatabase(source,target)).rejects.toThrow('SNAPSHOT_NEW_TARGET_REQUIRED');expect(fs.readdirSync(root).some(n=>n.includes('.partial-'))).toBe(false);}
 finally{db.close();const r=relative(resolve('cache'),root);if(!r||r.startsWith('..'))throw Error('TEST_PATH_INVALID');await fs.promises.rm(root,{recursive:true,force:true});}
});
it('leaves no empty frozen file after backup failure and permits a corrected source to be snapshotted',async()=>{
 const root=fs.mkdtempSync(resolve('cache/snapshot-test-')),source=join(root,'source.sqlite3'),target=join(root,'frozen.sqlite3');
 try{fs.writeFileSync(source,'invalid sqlite bytes');await expect(snapshotDatabase(source,target)).rejects.toThrow('SNAPSHOT_DATABASE_FAILED');expect(fs.existsSync(target)).toBe(false);expect(fs.readdirSync(root)).toEqual(['source.sqlite3']);fs.unlinkSync(source);const db=new DatabaseSync(source);db.exec('CREATE TABLE facts(value); INSERT INTO facts VALUES(7)');db.close();await snapshotDatabase(source,target);const copy=new DatabaseSync(target,{readOnly:true});try{expect(copy.prepare('SELECT value FROM facts').get()!.value).toBe(7);}finally{copy.close();}}
 finally{const r=relative(resolve('cache'),root);if(!r||r.startsWith('..'))throw Error('TEST_PATH_INVALID');await fs.promises.rm(root,{recursive:true,force:true});}
});
