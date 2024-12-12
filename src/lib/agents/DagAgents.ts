import { Agent, AgentFunction, Result } from "../../core/types";
import { BaseAgent } from "../../core/BaseAgent";
import {
    DAG_CREATION_INSTRUCTIONS,
    DAG_EXECUTION_WITH_PLAN_INSTRUCTIONS,
    META_DAG_INSTRUCTIONS,
    CREATE_DAG_DESCRIPTION,
    EXECUTE_DAG_DESCRIPTION,
    EXECUTE_SUBDAG_DESCRIPTION
} from './prompts';

interface DagTask {
    id: string;
    type: 'function' | 'subdag';
    functionName?: string;
    functionArgs?: Record<string, any>;
    subdag?: {
        goal: string;
        steps: DagTask[];
    };
    dependencies: string[];
}

// Meta DAG for standardized execution flow
const META_DAG: DagTask[] = [
    {
        id: 'createDag',
        type: 'function',
        functionName: 'createDagFunction',
        functionArgs: {
            goal: '{goal}'  // This will be replaced with the actual goal in constructor
        },
        dependencies: []
    },
    {
        id: 'executeDag',
        type: 'function',
        functionName: 'executeSubdagFunction',
        functionArgs: {
            nodeId: '$createDag'  // Uses the output from createDag as the nodeId
        },
        dependencies: ['createDag']
    }
];

export class DagCreationAgent extends BaseAgent {
    private dagCreated: boolean = false;
    private lastResponse: string = '';
    private createdDag: DagTask[] | null = null;

    constructor(goal: string, functions: AgentFunction[]) {
        const executeDAGFunction = async (dag: DagTask[]): Promise<Agent> => {
            console.log('execute_dag function called by LLM with plan');
            this.dagCreated = true;
            this.createdDag = dag;
            return new DagExecutionAgent(goal, functions, dag).getAgent();
        };

        Object.defineProperty(executeDAGFunction, 'description', {
            value: EXECUTE_DAG_DESCRIPTION
        });

        const functionMap = new Map<string, AgentFunction>();
        functions.forEach(f => {
            const sanitizedName = BaseAgent.sanitizeFunctionName(f.name);
            functionMap.set(sanitizedName, f);
        });

        const creationInstructions = DAG_CREATION_INSTRUCTIONS
            .replace('{goal}', goal)
            .replace('{functionList}', Array.from(functionMap.keys()).join(', '))
            .replace('{functionDescriptions}', BaseAgent.buildFunctionDescriptions(functions));

        const agent: Agent = {
            name: 'Assistant',
            model: 'gpt-4o',
            instructions: creationInstructions,
            functions: [executeDAGFunction],
            toolChoice: null,
            parallelToolCalls: true,
        };

        super(goal, functions, agent);
    }

    updateLastResponse(response: string) {
        this.lastResponse = response;
        console.log('Stored LLM response:', response);
    }

    shouldTransferManually(): boolean {
        return !this.dagCreated;
    }

    async nextAgent(): Promise<Agent | null> {
        if (this.dagCreated) {
            console.log('No manual transfer needed, execute_dag was called');
            return null;
        }

        console.log('Performing manual transfer using LLM response as plan');
        
        if (!this.lastResponse) {
            console.warn('No response available for manual transfer');
            return null;
        }

        try {
            const dag = JSON.parse(this.lastResponse) as DagTask[];
            return new DagExecutionAgent(this.goal, this.functions, dag).getAgent();
        } catch (e) {
            console.error('Failed to parse DAG from response:', e);
            return null;
        }
    }

    getCreatedDag(): DagTask[] | null {
        return this.createdDag;
    }
}

export class DagExecutionAgent extends BaseAgent {
    private dagSteps: DagTask[];
    private completedTasks: Set<string> = new Set();
    private currentSubdag: string | null = null;
    private executionResults: Map<string, any> = new Map();

    constructor(goal: string, functions: AgentFunction[], dagSteps: DagTask[]) {
        const createDagFunction: AgentFunction = async (args: { goal: string }) => {
            const creationAgent = new DagCreationAgent(args.goal, functions);
            return {
                value: 'DAG creation agent initialized',
                agent: creationAgent.getAgent(),
                contextVariables: {}
            };
        };
        Object.defineProperty(createDagFunction, 'description', {
            value: CREATE_DAG_DESCRIPTION
        });

        // Bind the execute subdag function to this instance
        const executeSubdagFunction: AgentFunction = async (args: { nodeId: string }) => {
            const task = this.findTask(args.nodeId);
            if (!task || task.type !== 'subdag' || !task.subdag) {
                throw new Error(`Invalid subdag task: ${args.nodeId}`);
            }

            this.currentSubdag = args.nodeId;
            const executionAgent = new DagExecutionAgent(
                task.subdag.goal,
                functions,
                task.subdag.steps
            );

            return {
                value: `Executing subdag for ${args.nodeId}`,
                agent: executionAgent.getAgent(),
                contextVariables: {}
            };
        };
        Object.defineProperty(executeSubdagFunction, 'description', {
            value: EXECUTE_SUBDAG_DESCRIPTION
        });

        const enhancedFunctions: AgentFunction[] = [
            ...functions,
            createDagFunction,
            executeSubdagFunction
        ];

        const executionInstructions = DAG_EXECUTION_WITH_PLAN_INSTRUCTIONS
            .replace('{goal}', goal)
            .replace('{dagSteps}', JSON.stringify(dagSteps, null, 2))
            .replace('{functionList}', enhancedFunctions.map(f => f.name).join(', '));

        const agent: Agent = {
            name: 'Assistant',
            model: 'gpt-4o',
            instructions: executionInstructions,
            functions: enhancedFunctions,
            toolChoice: null,
            parallelToolCalls: true,
        };

        super(goal, functions, agent);
        this.dagSteps = dagSteps;
    }

    private findTask(taskId: string): DagTask | null {
        return this.dagSteps.find(task => task.id === taskId) || null;
    }

    private getExecutableTasks(): string[] {
        return this.dagSteps
            .filter(task => 
                !this.completedTasks.has(task.id) &&
                task.dependencies.every(depId => this.completedTasks.has(depId))
            )
            .map(task => task.id);
    }

    private resolveArguments(args: Record<string, any>): Record<string, any> {
        const resolved: Record<string, any> = {};
        for (const [key, value] of Object.entries(args)) {
            if (typeof value === 'string' && value.startsWith('$')) {
                const taskId = value.slice(1);
                if (!this.executionResults.has(taskId)) {
                    throw new Error(`Result not found for task: ${taskId}`);
                }
                resolved[key] = this.executionResults.get(taskId);
            } else {
                resolved[key] = value;
            }
        }
        return resolved;
    }

    markTaskCompleted(taskId: string, result: any) {
        this.completedTasks.add(taskId);
        this.executionResults.set(taskId, result);
        if (this.currentSubdag === taskId) {
            this.currentSubdag = null;
        }
    }

    shouldTransferManually(): boolean {
        return this.getExecutableTasks().length > 0 && !this.currentSubdag;
    }

    async nextAgent(): Promise<Agent | null> {
        if (this.isCompleted()) {
            return null;
        }

        const executableTasks = this.getExecutableTasks();
        if (executableTasks.length === 0) {
            return null;
        }

        const nextTaskId = executableTasks[0];
        const task = this.findTask(nextTaskId)!;

        if (task.type === 'subdag' && task.subdag) {
            this.currentSubdag = task.id;
            return new DagCreationAgent(task.subdag.goal, this.functions).getAgent();
        }

        return this.getAgent();
    }

    isCompleted(): boolean {
        return this.completedTasks.size === this.dagSteps.length;
    }
}

export class MetaDagExecutionAgent extends DagExecutionAgent {
    constructor(goal: string, functions: AgentFunction[]) {
        const metaInstructions = META_DAG_INSTRUCTIONS.replace('{goal}', goal);
        
        super(goal, functions, META_DAG);

        // Override instructions with meta-DAG specific ones
        this.agent.instructions = metaInstructions;
    }
}