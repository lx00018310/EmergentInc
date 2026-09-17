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
}
