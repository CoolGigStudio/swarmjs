import { Agent, AgentFunction } from "../../core/types";
import {
    DAG_CREATION_INSTRUCTIONS,
    DAG_EXECUTION_INSTRUCTIONS,
    DAG_EXECUTION_WITH_PLAN_INSTRUCTIONS,
    TRANSFER_AGENT_DESCRIPTION
} from './prompts';

class DagSwarm {
    private dagCreationAgent: Agent;
    private dagExecutionAgent: Agent;
    private readonly goal: string;
    private readonly functions: AgentFunction[];

    constructor(goal: string, functions: AgentFunction[]) {
        this.goal = goal;
        this.functions = functions;

        // Create function map with sanitized names
        const functionMap = new Map<string, AgentFunction>();
        this.functions.forEach(f => {
            const sanitizedName = this.sanitizeFunctionName(f.name);
            functionMap.set(sanitizedName, f);
        });

        // Initialize the execution agent first
        this.dagExecutionAgent = {
            name: 'Assistant',
            model: 'gpt-4o',
            instructions: DAG_EXECUTION_INSTRUCTIONS,
            functions: [...functionMap.values()],
            toolChoice: null,
            parallelToolCalls: true,
        };

        // Create the transfer function
        const transfer_to_dag_execution_agent = async (dag: any): Promise<Agent> => {
            console.log('Transferring to execution agent with DAG:', JSON.stringify(dag, null, 2));
            const parsedDag = typeof dag === 'string' ? JSON.parse(dag) : dag;
            
            const executionInstructions = DAG_EXECUTION_WITH_PLAN_INSTRUCTIONS
                .replace('{dagSteps}', JSON.stringify(parsedDag, null, 2))
                .replace('{functionList}', Array.from(functionMap.keys()).join(', '));

            return {
                ...this.dagExecutionAgent,
                instructions: executionInstructions
            };
        };

        // Add description to transfer function
        Object.defineProperty(transfer_to_dag_execution_agent, 'description', {
            value: TRANSFER_AGENT_DESCRIPTION
        });

        // Initialize the DAG creation agent
        const creationInstructions = DAG_CREATION_INSTRUCTIONS
            .replace('{goal}', this.goal)
            .replace('{functionList}', Array.from(functionMap.keys()).join(', '))
            .replace('{functionDescriptions}', this.buildFunctionDescriptions());

        this.dagCreationAgent = {
            name: 'Assistant',
            model: 'gpt-4o',
            instructions: creationInstructions,
            functions: [transfer_to_dag_execution_agent as AgentFunction],
            toolChoice: null,
            parallelToolCalls: true,
        };
    }

    private sanitizeFunctionName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    private buildFunctionDescriptions(): string {
        return this.functions
            .map(f => ({
                name: this.sanitizeFunctionName(f.name),
                description: (f as any).description
            }))
            .map(f => `${f.name}: ${f.description}`)
            .join('\n');
    }

    getDagCreationAgent(): Agent {
        return this.dagCreationAgent;
    }

    getDagExecutionAgent(): Agent {
        return this.dagExecutionAgent;
    }
}

export default DagSwarm;