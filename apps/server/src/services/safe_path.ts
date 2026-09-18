import * as path from "node:path";
import * as fs from "node:fs";

export function validatePathSegment(value: string): void {
  if (!value || value === "." || value === ".." || /[\\/:%\x00-\x1f]/.test(value) || /[. ]$/.test(value)) {
    throw Object.assign(new Error("Invalid path segment"), { statusCode: 400 });
  }
}

function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Object.assign(new Error("PATH_TRAVERSAL_FORBIDDEN"), { statusCode: 403 });
  }
}

/** Check both lexical containment and existing real paths (including symlinks). */
export function containedPath(root: string, ...segments: string[]): string {
  segments.forEach(validatePathSegment);
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...segments);
  assertContained(absoluteRoot, target);
  let current = absoluteRoot;
  for (const segment of ["", ...segments]) {
    if (segment) current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw Object.assign(new Error("Symbolic links are not permitted in file routes"), { statusCode: 403 });
    }
  }
  if (fs.existsSync(absoluteRoot)) {
    const realRoot = fs.realpathSync(absoluteRoot);
    let existing = target;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    assertContained(realRoot, fs.realpathSync(existing));
  }
  return target;
}
