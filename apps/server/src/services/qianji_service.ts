import { CoreStore } from "@emergentinc/persistence";
import { QianjiBinding, QianjiProfile } from "@emergentinc/protocol";

export interface ExistingPixelIdentityInput {
  pixelId: string;
  incarnation: number;
}

export interface ExistingPixelIdentityMigrationResult {
  createdProfiles: QianjiProfile[];
  createdBindings: QianjiBinding[];
  reusedBindings: QianjiBinding[];
}

export class QianjiService {
  constructor(private readonly store: CoreStore) {}

  public migrateExistingPixels(inputs: ExistingPixelIdentityInput[]): ExistingPixelIdentityMigrationResult {
    return this.store.transaction(() => {
      const result: ExistingPixelIdentityMigrationResult = {
        createdProfiles: [],
        createdBindings: [],
        reusedBindings: [],
      };
      const seen = new Set<string>();
      for (const input of inputs) {
        if (!input.pixelId.trim() || !Number.isSafeInteger(input.incarnation) || input.incarnation < 1) {
          throw new Error(`Invalid existing Pixel identity input: ${input.pixelId}`);
        }
        if (seen.has(input.pixelId)) throw new Error(`Duplicate Pixel identity input: ${input.pixelId}`);
        seen.add(input.pixelId);

        const current = this.store.qianji.getCurrentBindingByPixel(input.pixelId);
        if (current) {
          if (current.incarnation !== input.incarnation) {
            throw new Error(`Existing binding incarnation conflicts for ${input.pixelId}`);
          }
          result.reusedBindings.push(current);
          continue;
        }

        const profile = this.store.qianji.createProfile({
          careerStatus: "active",
          narrative: {
            displayName: `未命名千机 ${input.pixelId}`,
            title: null,
            roleLabel: null,
            traits: {},
            behaviorProfile: [],
            flaw: null,
            shortBio: null,
            appearanceSpec: null,
            portraitAsset: null,
            contentRevision: null,
          },
        });
        const binding = this.store.qianji.createBinding({
          qianjiId: profile.qianjiId,
          pixelId: input.pixelId,
          incarnation: input.incarnation,
        });
        result.createdProfiles.push(profile);
        result.createdBindings.push(binding);
      }
      return result;
    });
  }
}
