import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { assertBossWorkspace, initializeBossWorkspace } from '../src/boss_workspace.js';
// @ts-expect-error local one-shot JavaScript CLI
import { exactDirectory, resetInventory, resetCli, destroyOldInstance, assertResetOffline, initializeDeletedWorkspace } from '../../../scripts/v34-reset-workspace.mjs';
import { WorldRegistryStore } from '@emergentinc/persistence';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-v34-')); roots.push(root);
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'old-orders.sqlite3'), 'old customer records');
  const external = path.join(root, 'owner_private/runtime'); fs.mkdirSync(external, { recursive: true });
  const configFile = path.join(external, 'owner-config.json');
  fs.writeFileSync(configFile, JSON.stringify({ ownerProjectRoot: root, workspace, stateDirectory: external, releases: path.join(external, 'releases'), activeReleaseFile: path.join(external, 'active-release.json') }));
  fs.writeFileSync(path.join(root, '.env'), 'EMERGENTINC_LOCAL_EVOLUTION_CONFIG=owner_private/runtime/owner-config.json');
  fs.writeFileSync(path.join(external, 'old-state.sqlite3'), 'old publication state');
  return { root, workspace, external, configFile };
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
describe('V34 explicit destructive reset', () => {
  it('defaults to a read-only preview and requires a target-bound confirmation', async () => {
    const { root, workspace } = fixture(); vi.spyOn(console, 'log').mockImplementation(() => {});
    await resetCli(root, ['--workspace', workspace]);
    expect(fs.readFileSync(path.join(workspace, 'old-orders.sqlite3'), 'utf8')).toContain('old customer');
    await expect(destroyOldInstance(root, resetInventory(root, workspace), 'yes')).rejects.toThrow('CONFIRMATION_REQUIRED');
  });
  it('rejects a running instance before touching files', async () => {
    const { root, workspace } = fixture(); const inventory = resetInventory(root, workspace);
    await expect(destroyOldInstance(root, inventory, `DELETE-BOSS-AFK-V34:${workspace}`, { offline: () => { throw new Error('V34_RESET_INSTANCE_RUNNING'); } })).rejects.toThrow('INSTANCE_RUNNING');
    expect(fs.existsSync(path.join(workspace, 'old-orders.sqlite3'))).toBe(true);
  });
  it('checks a live process lock without deleting anything',async()=>{
    const {root,workspace}=fixture();fs.mkdirSync(path.join(workspace,'runtime'));fs.writeFileSync(path.join(workspace,'runtime/instance.lock'),JSON.stringify({pid:process.pid}));
    await expect(assertResetOffline(root,resetInventory(root,workspace))).rejects.toThrow('INSTANCE_RUNNING');expect(fs.existsSync(path.join(workspace,'old-orders.sqlite3'))).toBe(true);
  });
  it('unlinks internal junctions and refuses external junction targets',async()=>{
    const {root,workspace}=fixture(),inside=path.join(workspace,'dependencies');fs.mkdirSync(inside);fs.writeFileSync(path.join(inside,'test.txt'),'old dependency');fs.symlinkSync(inside,path.join(workspace,'link'),process.platform==='win32'?'junction':'dir');
    expect(resetInventory(root,workspace).links).toBe(1);await destroyOldInstance(root,resetInventory(root,workspace),`DELETE-BOSS-AFK-V34:${workspace}`,{offline:async()=>{},initialize:(_root:string,target:string)=>initializeBossWorkspace(path.resolve(import.meta.dirname,'../../..'),target,{resetInProgress:true})});
    expect(fs.existsSync(path.join(workspace,'link'))).toBe(false);
    const other=fixture();fs.symlinkSync(root,path.join(other.workspace,'outside'),process.platform==='win32'?'junction':'dir');expect(()=>resetInventory(other.root,other.workspace)).toThrow('EXTERNAL_LINK');
  });
  it('retries a failed fresh initialization only after recorded complete deletion from an empty path',async()=>{
    const {root,workspace}=fixture();await expect(destroyOldInstance(root,resetInventory(root,workspace),`DELETE-BOSS-AFK-V34:${workspace}`,{offline:async()=>{},initialize:()=>{throw new Error('initializer unavailable');}})).rejects.toThrow('NEW_INITIALIZATION_FAILED');
    expect(fs.existsSync(workspace)).toBe(false);await initializeDeletedWorkspace(root,workspace,`DELETE-BOSS-AFK-V34:${workspace}`,(_root:string,target:string)=>initializeBossWorkspace(path.resolve(import.meta.dirname,'../../..'),target,{resetInProgress:true}));expect(assertBossWorkspace(workspace)?.format).toBe(34);
  });
  it('removes old data and external state physically, preserves config, creates no archive', async () => {
    const { root, workspace, external, configFile } = fixture(), inventory = resetInventory(root, workspace);
    await destroyOldInstance(root, inventory, `DELETE-BOSS-AFK-V34:${workspace}`, { offline: async () => {}, initialize: (_root: string, target: string) => initializeBossWorkspace(path.resolve(import.meta.dirname, '../../..'), target, { resetInProgress: true }) });
    expect(fs.existsSync(path.join(workspace, 'old-orders.sqlite3'))).toBe(false);
    expect(fs.readdirSync(external)).toEqual([path.basename(configFile)]);
    expect(assertBossWorkspace(workspace)?.format).toBe(34);
    expect(fs.readdirSync(root).sort()).toEqual(['.env', 'owner_private', 'workspace']);
    expect(() => resetInventory(root, workspace)).toThrow('NEW_INSTANCE_FORBIDDEN');
    const control = new WorldRegistryStore(path.join(workspace, 'system/control/control.sqlite3'));
    try { const gate = new OwnerAutomationGate(control); expect(gate.view().desiredMode).toBe('OFF'); expect(gate.budget.view().activatedAt).toBeNull(); expect(gate.goals.list()).toEqual([]); expect(control.worlds()).toEqual([]); } finally { control.close(); }
    expect(fs.existsSync(path.join(workspace, 'system/control/control.sqlite3.pre-v32.bak'))).toBe(false);
  });
  it('rejects old nonempty workspaces at startup and preserves new data across initialization', () => {
    const { root, workspace } = fixture(); expect(() => assertBossWorkspace(workspace)).toThrow('DESTRUCTIVE_RESET_REQUIRED');
    const empty = path.join(root, 'fresh'), project = path.resolve(import.meta.dirname, '../../..');
    const first = initializeBossWorkspace(project, empty);
    fs.writeFileSync(path.join(empty, 'private/new-deliverable.txt'), 'new business');
    expect(initializeBossWorkspace(project, empty)).toEqual(first);
    expect(fs.readFileSync(path.join(empty, 'private/new-deliverable.txt'), 'utf8')).toBe('new business');
  });
  it('rejects source/root/home/traversal and junction aliases', () => {
    const { root, workspace } = fixture();
    for (const target of [root, path.parse(root).root, os.homedir(), root + path.sep + '..' + path.sep + path.basename(root)]) expect(() => exactDirectory(target, root)).toThrow();
    if(process.env.SystemRoot)expect(()=>exactDirectory(path.join(process.env.SystemRoot,'System32'),root)).toThrow('PATH_FORBIDDEN');
    for(const name of ['apps','.git','node_modules']){fs.mkdirSync(path.join(root,name));expect(()=>exactDirectory(path.join(root,name),root)).toThrow('PATH_FORBIDDEN');}
    const alias = path.join(root, 'alias'); fs.symlinkSync(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => exactDirectory(alias, root)).toThrow('PATH_ALIAS');
  });
  it('keeps an incomplete-reset guard on deletion failure and never initializes mixed data', async () => {
    const { root, workspace } = fixture(), inventory = resetInventory(root, workspace), initialize = vi.fn();
    await expect(destroyOldInstance(root, inventory, `DELETE-BOSS-AFK-V34:${workspace}`, { offline: async () => {}, initialize, removeEntry: () => { throw new Error('locked'); } })).rejects.toThrow('DELETE_FAILED');
    expect(initialize).not.toHaveBeenCalled(); expect(() => assertBossWorkspace(workspace)).toThrow('RESET_INCOMPLETE');
  });
});
