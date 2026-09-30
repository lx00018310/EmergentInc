import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { LineageStore } from "@emergentinc/persistence";
import { GenerationSupervisor } from "./generation_supervisor.js";
import { LinuxEvolutionConfig, LinuxEvolutionRuntime } from "./linux_runtime.js";

function lock(directory: string) {
  const file = path.join(directory, "evolution.lock"), token = randomUUID();
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8"), previous = JSON.parse(raw);
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error("INVALID_EVOLUTION_LOCK");
    try { process.kill(previous.pid, 0); throw new Error("EVOLUTION_ALREADY_RUNNING"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; }
    if (fs.readFileSync(file, "utf8") !== raw) throw new Error("EVOLUTION_LOCK_CHANGED"); fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
  return () => { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file); };
}
export async function runEvolutionCli(args: string[]) {
  let supervisor: GenerationSupervisor | undefined, lineage: LineageStore | undefined, unlock: (() => void) | undefined;
  try {
    if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("TRUSTED_ROOT_LINUX_REQUIRED");
    const [action, value, exactHash] = args;
    if (!["submit", "validate", "approve", "birth", "rollback", "recover", "show", "list", "post-rollback-dream"].includes(action ?? ""))
      throw new Error("Usage: generation-supervisor submit <request.json> | validate/birth/show <id> | approve <id> <exact-hash> | rollback <id> <reason> | recover | list");
    const configFile = process.env.EMERGENTINC_EVOLUTION_CONFIG ?? "/etc/emergentinc/evolution.json";
    const configStats = fs.statSync(configFile);
    if (configStats.uid !== 0 || configStats.mode & 0o077) throw new Error("EVOLUTION_CONFIG_MUST_BE_ROOT_PRIVATE");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8")) as LinuxEvolutionConfig & { stateDirectory: string };
    fs.mkdirSync(config.stateDirectory, { recursive: true, mode: 0o750 });
    const stateStats = fs.statSync(config.stateDirectory);
    if (stateStats.uid !== 0 || stateStats.mode & 0o027) throw new Error("EVOLUTION_STATE_MUST_BE_TRUSTED");
    unlock = lock(config.stateDirectory);
    lineage = new LineageStore(path.join(config.workspace, "lineage/lineage.sqlite3"));
    supervisor = new GenerationSupervisor(config.stateDirectory, config.workspace, config.releases, lineage, new LinuxEvolutionRuntime(config), true, config.activePointer);
    let result;
    if (action === "submit") result = supervisor.submit(JSON.parse(fs.readFileSync(path.resolve(value!), "utf8")));
    else if (action === "validate") result = await supervisor.validate(value!);
    else if (action === "approve") result = supervisor.approve(value!, exactHash!);
    else if (action === "birth") result = await supervisor.birth(value!);
    else if (action === "rollback") result = await supervisor.rollback(value!, exactHash!);
    else if (action === "recover") result = await supervisor.recover();
    else if (action === "post-rollback-dream") result = await supervisor.postRollbackDream(value!);
    else if (action === "show") result = supervisor.get(value!);
    else result = supervisor.list();
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error(e instanceof Error ? e.message : "EVOLUTION_FAILED"); process.exitCode = 1; }
  finally { supervisor?.close(); lineage?.close(); unlock?.(); }
}
