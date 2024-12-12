import { Agent, AgentFunction } from './types';

export abstract class BaseAgent {
    protected agent: Agent;
    protected goal: string;
    protected functions: AgentFunction[];

    constructor(goal: string, functions: AgentFunction[], agent: Agent) {
        this.goal = goal;
        this.functions = functions;
        this.agent = agent;
    }

    abstract shouldTransferManually(): boolean;
    abstract nextAgent(): Promise<Agent | null>;
    
    getAgent(): Agent {
        return this.agent;
    }

     // Make utility methods static so they can be used before super()
    public static sanitizeFunctionName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    public static buildFunctionDescriptions(functions: AgentFunction[]): string {
        return functions
            .map(f => ({
                name: this.sanitizeFunctionName(f.name),
                description: (f as any).description
            }))
            .map(f => `${f.name}: ${f.description}`)
            .join('\n');
    }
}