import { QianjiNarrativeSpec } from "@emergentinc/protocol";

export interface QianjiValidationError {
  path: string;
  message: string;
}

export type QianjiNarrativeValidation =
  | { valid: true; value: QianjiNarrativeSpec; errors: [] }
  | { valid: false; errors: QianjiValidationError[] };

const NARRATIVE_FIELDS = new Set([
  "displayName", "title", "roleLabel", "traits", "behaviorProfile", "flaw",
  "shortBio", "appearanceSpec", "portraitAsset", "contentRevision",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function validateQianjiNarrative(input: unknown): QianjiNarrativeValidation {
  const errors: QianjiValidationError[] = [];
  if (!isRecord(input)) return { valid: false, errors: [{ path: "narrative", message: "must be an object" }] };

  for (const key of Object.keys(input)) {
    if (!NARRATIVE_FIELDS.has(key)) errors.push({ path: "narrative." + key, message: "unknown field" });
  }

  const readText = (
    field: string,
    maximum: number,
    options: { required?: boolean; nullable?: boolean } = {},
  ): string | null => {
    const value = input[field];
    if (value === undefined) {
      if (options.required) errors.push({ path: "narrative." + field, message: "is required" });
      return null;
    }
    if (value === null && options.nullable) return null;
    if (typeof value !== "string") {
      errors.push({ path: "narrative." + field, message: "must be a string" });
      return null;
    }
    const length = codePointLength(value);
    if (options.required && !value.trim()) errors.push({ path: "narrative." + field, message: "must not be blank" });
    if (length > maximum) {
      errors.push({ path: "narrative." + field, message: "must be at most " + maximum + " Unicode code points" });
    }
    return value;
  };

  const displayName = readText("displayName", 80, { required: true });
  const title = readText("title", 80, { nullable: true });
  const roleLabel = readText("roleLabel", 80, { nullable: true });
  const flaw = readText("flaw", 500, { nullable: true });
  const shortBio = readText("shortBio", 2000, { nullable: true });
  const appearanceSpec = readText("appearanceSpec", 2000, { nullable: true });
  const contentRevision = readText("contentRevision", 100, { nullable: true });
  const portraitAsset = readText("portraitAsset", 128, { nullable: true });

  const traits: Record<string, number> = {};
  const rawTraits = input.traits;
  if (!isRecord(rawTraits)) {
    errors.push({ path: "narrative.traits", message: "must be an object of finite numbers from 0 to 1" });
  } else {
    const entries = Object.entries(rawTraits);
    if (entries.length > 16) errors.push({ path: "narrative.traits", message: "must contain at most 16 entries" });
    for (const [key, value] of entries) {
      if (!key || codePointLength(key) > 32) {
        errors.push({ path: "narrative.traits." + key, message: "key must contain 1-32 Unicode code points" });
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        errors.push({ path: "narrative.traits." + key, message: "must be a finite number from 0 to 1" });
      } else {
        traits[key] = value;
      }
    }
  }

  const behaviorProfile: string[] = [];
  if (!Array.isArray(input.behaviorProfile)) {
    errors.push({ path: "narrative.behaviorProfile", message: "must be an array of strings" });
  } else {
    if (input.behaviorProfile.length > 12) {
      errors.push({ path: "narrative.behaviorProfile", message: "must contain at most 12 entries" });
    }
    input.behaviorProfile.forEach((value, index) => {
      if (typeof value !== "string") {
        errors.push({ path: "narrative.behaviorProfile." + index, message: "must be a string" });
      } else if (codePointLength(value) > 300) {
        errors.push({ path: "narrative.behaviorProfile." + index, message: "must be at most 300 Unicode code points" });
      } else {
        behaviorProfile.push(value);
      }
    });
  }

  if (errors.length > 0 || displayName === null) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: {
      displayName,
      title,
      roleLabel,
      traits,
      behaviorProfile,
      flaw,
      shortBio,
      appearanceSpec,
      portraitAsset,
      contentRevision,
    },
  };
}
