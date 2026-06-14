import { BuiltTool } from './tool.factory';
import { Logger } from '../utils/logger';

export class ToolRegistry {
  private tools: Map<string, BuiltTool> = new Map();

  public register(tool: BuiltTool) {
    if (this.tools.has(tool.name)) {
      Logger.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    Logger.info(`[ToolRegistry] Registered tool: ${tool.name} (Destructive: ${tool.isDestructive})`);
  }

  public getTool(name: string): BuiltTool | undefined {
    return this.tools.get(name);
  }

  /** Remove a tool (e.g. when an MCP server is disconnected). No-op if absent. */
  public unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** All registered tool names — used to advertise dynamic (MCP) tools in the prompt. */
  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  public getAllSchemas(): any[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema
    }));
  }
}
