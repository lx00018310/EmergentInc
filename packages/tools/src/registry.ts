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
    const lines = ["## Available Tools", "当前环境已启用的可用工具列表及参数格式如下："];
    for (const { definition } of this.tools.values()) {
      if (definition.enabled) {
        let paramsDesc = "{}";
        if (definition.input_schema && definition.input_schema.properties) {
          const props = Object.entries(definition.input_schema.properties)
            .map(([k, v]: [string, any]) => `${k}${definition.input_schema.required?.includes(k) ? " (必填)" : ""}: ${v.description || v.type}`)
            .join(", ");
          paramsDesc = props ? `{ ${props} }` : "{}";
        }
        lines.push(`- **\`${definition.name}\`** (${definition.effect}): ${definition.description} -> 示例参数: \`${paramsDesc}\``);
      }
    }
    return lines.join("\n");
  }

}
