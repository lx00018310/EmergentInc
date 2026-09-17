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

  public getPricingForModel(modelName: string): ModelPricing {
    const models = this.pricingConfig.models || {};
    if (models[modelName]) {
      return models[modelName];
    }
    if (this.pricingConfig.default_pricing) {
      return this.pricingConfig.default_pricing;
    }
    // 默认回退价格
    return {
      input_cost_per_million: 1.5,
      output_cost_per_million: 6.0,
      cached_cost_per_million: 0.75,
      currency: "CNY",
    };
  }

  public calculateUsage(params: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens?: number;
  }): ModelUsage {
    const { model, promptTokens, completionTokens } = params;
    const cachedTokens = params.cachedTokens || 0;
    const nonCachedPromptTokens = Math.max(0, promptTokens - cachedTokens);

    const pricing = this.getPricingForModel(model);
    const inCost = (nonCachedPromptTokens * pricing.input_cost_per_million) / 1_000_000.0;
    const cachedCost = (cachedTokens * (pricing.cached_cost_per_million || pricing.input_cost_per_million * 0.5)) / 1_000_000.0;
    const outCost = (completionTokens * pricing.output_cost_per_million) / 1_000_000.0;

    const costCny = inCost + cachedCost + outCost;
    const actualTokens = promptTokens + completionTokens;

    return {
      promptTokens,
      completionTokens,
      cachedTokens,
      actualTokens,
      costCny: Math.round(costCny * 1000000) / 1000000, // 保留 6 位小数
    };
  }
}
