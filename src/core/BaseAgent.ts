import { Agent, AgentFunction } from './types';
import { Logger } from '../utils/logging';

export abstract class BaseAgent {
    protected readonly agent: Agent;
    public readonly goal: string;
    public readonly functions: AgentFunction[];
    protected readonly logger: Logger;
    protected lastResponse: string = '';

    constructor(goal: string, functions: AgentFunction[], agent: Agent) {
        this.goal = goal;
        this.functions = functions;
        this.agent = agent;
        this.logger = Logger.getInstance();
    }

    abstract shouldTransferManually(): boolean;
    abstract nextAgent(): Promise<BaseAgent | null>;
    abstract updateLastResponse(response: string): void; 
    
    public getAgent(): Agent {
        return this.agent;
    }

    public static sanitizeFunctionName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    public static buildFunctionDescriptions(functions: AgentFunction[]): string {
        return functions
            .map(f => ({
                name: this.sanitizeFunctionName(f.name),
                description: (f as { description?: string }).description || 'No description provided'
            }))
            .map(f => `${f.name}: ${f.description}`)
            .join('\n');
    }

    protected validateFunction(func: AgentFunction): void {
        if (typeof func !== 'function') {
            throw new Error('Invalid function provided');
        }
    }
}