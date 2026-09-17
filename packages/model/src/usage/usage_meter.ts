import { ModelUsage } from "@emergentinc/protocol";

export interface ModelPricing {
  input_cost_per_million: number;
  output_cost_per_million: number;
  cached_cost_per_million?: number;
  currency?: string;
  effective_from?: string;
}

export interface PricingConfig {
  models: Record<string, ModelPricing>;
  default_pricing?: ModelPricing;
}

export class UsageMeter {
  constructor(private pricingConfig: PricingConfig) {}

  public getPricingForModel(modelName: string): ModelPricing | null {
    return this.pricingConfig.models?.[modelName] ?? this.pricingConfig.default_pricing ?? null;
  }

  public calculateUsage(params: { model: string } & Partial<ModelUsage>): ModelUsage {
    const token = (value: unknown): number | null =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const price = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    const promptTokens = token(params.promptTokens);
    const completionTokens = token(params.completionTokens);
    const cachedTokens = token(params.cachedTokens);
    const actualTokens = token(params.actualTokens) ??
      (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);
    const pricing = this.getPricingForModel(params.model);
    let costCny = price(params.costCny) ? params.costCny : null;
    // Missing currency retains the historical CNY configuration convention.
    // Missing cache counts are usable only when cache/non-cache rates are identical.
    const cacheKnown = cachedTokens !== null || pricing?.cached_cost_per_million === pricing?.input_cost_per_million;
    if (costCny === null && pricing && (!pricing.currency || pricing.currency.toUpperCase() === "CNY") &&
        promptTokens !== null && completionTokens !== null && cacheKnown &&
        (cachedTokens ?? 0) <= promptTokens &&
        price(pricing.input_cost_per_million) && price(pricing.output_cost_per_million) &&
        ((cachedTokens ?? 0) === 0 || price(pricing.cached_cost_per_million))) {
      const cached = cachedTokens ?? 0;
      const value = ((promptTokens - cached) * pricing.input_cost_per_million +
        cached * (pricing.cached_cost_per_million ?? 0) + completionTokens * pricing.output_cost_per_million) / 1_000_000;
      costCny = Math.round(value * 1_000_000) / 1_000_000;
    }
    return { promptTokens, completionTokens, cachedTokens, actualTokens, costCny };
  }
}
