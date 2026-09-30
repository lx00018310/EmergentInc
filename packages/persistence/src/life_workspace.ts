import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { GenomeManifest, genomeManifest } from "@emergentinc/protocol";

export function readGenome(projectRoot: string): { manifest: GenomeManifest; geneHash: string } {
  const manifest = genomeManifest(JSON.parse(fs.readFileSync(path.join(projectRoot, "genome/manifest.json"), "utf8")));
  const hash = createHash("sha256");
  const files = new Set<string>();
  const walk = (relative: string) => {
    const absolute = path.join(projectRoot, relative);
    if (!fs.existsSync(absolute)) throw new Error("GENOME_PROTECTED_PATH_MISSING");
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("GENOME_SYMLINK_FORBIDDEN");
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (["node_modules", "dist", ".git"].includes(name) || name.endsWith(".tsbuildinfo")) continue;
        walk(`${relative}/${name}`);
      }
    } else if (stat.isFile()) files.add(relative);
    else throw new Error("GENOME_SPECIAL_FILE_FORBIDDEN");
  };
  for (const pattern of manifest.protected_paths) walk(pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern);
  for (const file of [...files].sort()) hash.update(file).update("\0").update(fs.readFileSync(path.join(projectRoot, file))).update("\0");
  return { manifest, geneHash: hash.digest("hex") };
}

export function generationDirectory(workspace: string, id: string) {
  if (!/^G\d{4,}$/.test(id)) throw new Error("INVALID_GENERATION_ID");
  return path.join(workspace, "generations", id);
}
export function writeGenerationPointer(workspace: string, id: string, pointerFile = path.join(workspace, "active-generation.json")) {
  generationDirectory(workspace, id);
  const file = pointerFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.next`;
  fs.writeFileSync(temp, JSON.stringify({ generation_id: id }), { flag: "wx", mode: 0o644 });
  // This contains only a generation ID. The app must read it even under the supervisor's 0077 umask.
  fs.chmodSync(temp, 0o644);
  fs.renameSync(temp, file);
}
