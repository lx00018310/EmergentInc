import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext } from "./context.js";

export type ToolHandler = (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  public register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  public get(name: string): RegisteredTool | null {
    return this.tools.get(name) || null;
  }

  public listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 将当前所有已启用的工具渲染为 Prompt 上下文目录
   */
  public renderCatalogForPrompt(): string {
    const lines = ["[TOOLS_CATALOG]", "当前环境已启用的可用工具规范如下："];
    for (const { definition } of this.tools.values()) {
      if (definition.enabled) {
        lines.push(`- **\`${definition.name}\`** (${definition.effect}): ${definition.description}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * 应用来自 tools.json 的启用与超时配置
   */
  public applyConfigOverrides(config: { tools?: Record<string, { enabled?: boolean; timeout_seconds?: number }> }): void {
    if (!config?.tools) return;
    for (const [name, cfg] of Object.entries(config.tools)) {
      const reg = this.tools.get(name);
      if (reg) {
        if (typeof cfg.enabled === "boolean") {
          reg.definition.enabled = cfg.enabled;
        }
        if (typeof cfg.timeout_seconds === "number") {
          reg.definition.timeout_seconds = cfg.timeout_seconds;
        }
      }
    }
  }
}
