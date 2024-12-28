
import { Tool, Goal } from './types-old';

export default abstract class BaseAgent {
    protected name: string;
    protected description: string;
    protected workflowPlan: string; // JSON structure as string for LLM consumption
    protected tools: Map<string, Tool>;
  
    constructor(name: string, description: string, workflowPlan: string) {
      this.name = name;
      this.description = description;
      this.workflowPlan = workflowPlan;
      this.tools = new Map();
    }
  
    abstract pursueGoal(goal: Goal): Promise<any>;
  
    addTools(tools: Tool[]): void {
      tools.forEach(tool => this.tools.set(tool.name, tool));
    }
  
    getToolSchemas(): Record<string, any>[] {
      return Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
    }

    getTools(): Map<string, Tool> {
      return this.tools;
    }

    getTool(name: string): Tool | undefined {
      return this.tools.get(name);
    }

    getName(): string {
      return this.name;
    }
  }
