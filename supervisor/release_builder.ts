import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { lifeId } from "@emergentinc/protocol";
import { GenePatchFile, classifyChange } from "./protocol.js";

export const evolutionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const excluded = new Set([".git", "node_modules", "workspace", "owner_private", "cache", ".env", ".codex", ".agents", ".aws"]);
const sourceRoots = new Set(["apps", "packages", "frontend", "genome", "scripts", "supervisor", "deploy", "resources", "tests", "docs",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.base.json", "vitest.config.ts", "vitest.workspace.ts", "README.md", "README_CN.md", "AGENTS.md", "LICENSE",
  "EmergentInc_UI.bat", "EmergentInc_UI.ps1", "EmergentInc_UI.sh", "EmergentInc_Upgrade.bat"]);
export function releaseHash(root: string) {
  const hash = createHash("sha256"), absoluteRoot = fs.realpathSync(root);
  const walk = (relative: string) => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(absolute), inside = path.relative(absoluteRoot, target);
      if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("RELEASE_EXTERNAL_SYMLINK_FORBIDDEN");
      hash.update(relative).update("\0link\0").update(fs.readlinkSync(absolute)).update("\0");
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) walk(relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) hash.update(relative).update("\0file\0").update(fs.readFileSync(absolute)).update("\0");
    else throw new Error("RELEASE_SPECIAL_FILE_FORBIDDEN");
  };
  walk(""); return hash.digest("hex");
}
export class ReleaseBuilder {
  constructor(readonly releasesDirectory: string) {}
  create(base: string, id: string, patch: GenePatchFile[]) {
    lifeId(id);
    if (!Array.isArray(patch) || !patch.length || patch.length > 100 || new Set(patch.map(p => p.path)).size !== patch.length)
      throw new Error("INVALID_GENE_PATCH");
    if (classifyChange(patch.map(p => p.path)) === "ROOT") throw new Error("ROOT_OF_TRUST_CHANGE_FORBIDDEN");
    if (classifyChange(patch.map(p => p.path)) !== "GENE") throw new Error("GENE_CHANGE_REQUIRED");
    for (const file of patch) {
      if (typeof file.path !== "string" || !/^[a-zA-Z0-9_./\-\u0080-\uffff]+$/.test(file.path) ||
          file.path.startsWith("/") || file.path.split("/").some(p => !p || p === "." || p === ".." || excluded.has(p) || p === "dist") ||
          !sourceRoots.has(file.path.split("/")[0]!) ||
          file.path.endsWith(".tsbuildinfo") || (file.content !== null && (typeof file.content !== "string" || Buffer.byteLength(file.content) > 1000000)))
        throw new Error("INVALID_GENE_PATCH_PATH");
    }
    const destination = path.join(this.releasesDirectory, id);
    if (fs.existsSync(destination)) throw new Error("RELEASE_TARGET_MUST_BE_NEW");
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const copy = (relative: string) => {
      const source = path.join(base, relative), stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error("BASE_SOURCE_SYMLINK_FORBIDDEN");
      const target = path.join(destination, relative);
      if (stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        for (const name of fs.readdirSync(source)) {
          if (!relative && !sourceRoots.has(name)) continue;
          if (excluded.has(name) || name === "dist" || name.endsWith(".tsbuildinfo") || /\.(log|pem|key|sqlite3|sqlite3-wal|sqlite3-shm)$/.test(name)) continue;
          copy(relative ? `${relative}/${name}` : name);
        }
      } else if (stat.isFile()) fs.copyFileSync(source, target);
      else throw new Error("BASE_SPECIAL_FILE_FORBIDDEN");
    };
    copy("");
    for (const file of patch) {
      const target = path.join(destination, file.path);
      if (file.content === null) fs.unlinkSync(target);
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content); }
    }
    return destination;
  }
}
