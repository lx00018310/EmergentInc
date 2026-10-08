import {it,expect,vi} from 'vitest';
import * as fs from 'node:fs';import{join,resolve,relative}from'node:path';import{DatabaseSync,backup}from'node:sqlite';import{snapshotDatabase}from'../../../supervisor/migration_runner.js';
vi.mock('node:sqlite',async importOriginal=>{const actual=await importOriginal<typeof import('node:sqlite')>();return {...actual,backup:vi.fn(actual.backup)};});
it.skipIf(process.platform!=='win32')('retries only Windows truncation failures and preserves committed facts',async()=>{
 fs.mkdirSync(resolve('cache'),{recursive:true});const root=fs.mkdtempSync(resolve('cache/snapshot-retry-')),source=join(root,'source.sqlite3'),target=join(root,'target.sqlite3'),db=new DatabaseSync(source);const mock=vi.mocked(backup);
 try{db.exec('CREATE TABLE facts(value); INSERT INTO facts VALUES(42)');mock.mockRejectedValueOnce(Object.assign(new Error('disk I/O error'),{errcode:1546}));await snapshotDatabase(source,target);expect(mock).toHaveBeenCalledTimes(2);const copy=new DatabaseSync(target,{readOnly:true});try{expect(copy.prepare('SELECT value FROM facts').get()!.value).toBe(42);}finally{copy.close();}expect(fs.readdirSync(root).some(n=>n.includes('.partial-'))).toBe(false);}
 finally{mock.mockClear();db.close();const r=relative(resolve('cache'),root);if(!r||r.startsWith('..'))throw Error('TEST_PATH_INVALID');await fs.promises.rm(root,{recursive:true,force:true});}
});
it('does not retry other snapshot failures or publish partial output',async()=>{
 fs.mkdirSync(resolve('cache'),{recursive:true});const root=fs.mkdtempSync(resolve('cache/snapshot-retry-')),source=join(root,'source.sqlite3'),target=join(root,'target.sqlite3'),db=new DatabaseSync(source);const mock=vi.mocked(backup);
 try{db.exec('CREATE TABLE facts(value)');mock.mockRejectedValueOnce(Object.assign(new Error('disk full'),{errcode:13}));await expect(snapshotDatabase(source,target)).rejects.toThrow('SNAPSHOT_DATABASE_FAILED');expect(mock).toHaveBeenCalledOnce();expect(fs.existsSync(target)).toBe(false);}
 finally{mock.mockClear();db.close();const r=relative(resolve('cache'),root);if(!r||r.startsWith('..'))throw Error('TEST_PATH_INVALID');await fs.promises.rm(root,{recursive:true,force:true});}
});

it.skipIf(process.platform!=='win32')('stops after five truncation failures without leaving a frozen file',async()=>{
 fs.mkdirSync(resolve('cache'),{recursive:true});const root=fs.mkdtempSync(resolve('cache/snapshot-retry-')),source=join(root,'source.sqlite3'),target=join(root,'target.sqlite3'),db=new DatabaseSync(source);const mock=vi.mocked(backup);
 try{db.exec('CREATE TABLE facts(value)');for(let n=0;n<5;n++)mock.mockRejectedValueOnce(Object.assign(new Error('disk I/O error'),{errcode:1546}));await expect(snapshotDatabase(source,target)).rejects.toThrow('SNAPSHOT_DATABASE_FAILED');expect(mock).toHaveBeenCalledTimes(5);expect(fs.existsSync(target)).toBe(false);expect(fs.readdirSync(root).some(n=>n.includes('.partial-'))).toBe(false);}
 finally{mock.mockClear();db.close();const r=relative(resolve('cache'),root);if(!r||r.startsWith('..'))throw Error('TEST_PATH_INVALID');await fs.promises.rm(root,{recursive:true,force:true});}
});
