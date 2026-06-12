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

  public getAllSchemas(): any[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.schema
    }));
  }
}
