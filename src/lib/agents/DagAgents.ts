// dag.ts
import { Agent, AgentFunction, Result } from '../../core/types';
import { BaseAgent } from '../../core/BaseAgent';
import { Logger } from '../../utils/logging';
import {
    DAG_CREATION_INSTRUCTIONS,
    SUB_DAG_CREATION_INSTRUCTIONS,
    DAG_EXECUTION_INSTRUCTIONS,
    META_DAG_INSTRUCTIONS
} from './dag-prompts';

export interface DagTask {
    id: string;
    type: 'function' | 'subdag';
    functionName?: string;
    functionArgs?: Record<string, any>;
    subdag?: {
        goal: string;
        requiredFunctions: string[];
        isComplexTask: true;
    };
    dependencies: string[];
}

export class DagCreationAgent extends BaseAgent {
    protected createdDag: DagTask[] | null = null;
    protected dagExecuted: boolean = false;
    constructor(
        goal: string,
        functions: AgentFunction[],
        protected isSubDag: boolean = false,
        protected parentResults?: Map<string, any>
    ) {
        const executeDagFunction: AgentFunction = async (dag: DagTask[]): Promise<Result> => {
            return this.transferToDagExecution(dag);
        };
        Object.defineProperty(executeDagFunction, 'description', {
            value: 'Execute the provided newly created DAG. The argument must be a JSON array instead of a json string.',
            writable: false,
            configurable: false
        });

        const instructions = isSubDag ? 
            SUB_DAG_CREATION_INSTRUCTIONS : 
            DAG_CREATION_INSTRUCTIONS;

        const agent: Agent = {
            name: isSubDag ? 'SubDAG Creator' : 'DAG Creator',
            model: 'gpt-4o',
            instructions: instructions
                .replace('{goal}', goal)
                .replace('{functionList}', functions.map(f => BaseAgent.sanitizeFunctionName(f.name)).join(', '))
                .replace('{functionDescriptions}', BaseAgent.buildFunctionDescriptions(functions)),
            functions: [executeDagFunction],
            toolChoice: 'auto',
            parallelToolCalls: true
        };

        console.log('Planner agent:', agent);

        super(goal, functions, agent);
    }

    protected async transferToDagExecution(dag: DagTask[]): Promise<Result> {
        this.validateDag(dag);
        this.createdDag = dag;
        this.dagExecuted = true;
    
        console.log('Transfer to DAG execution:', dag);

        const agent = new DagExecutionAgent(
            this.goal,
            this.functions,
            dag,
            this.parentResults
        );
        
        return {
            value: 'DAG created successfully',
            agent: agent.getAgent(),
            contextVariables: {},
            instance: agent,
        };
    }

    protected validateDag(dag: DagTask[]): void {
        if (!Array.isArray(dag)) {
            throw new Error('DAG must be an array');
        }

        const taskIds = new Set<string>();
        const seen = new Set<string>();

        for (const task of dag) {
            if (!task.id || !task.type) {
                throw new Error(`Task missing required fields: ${JSON.stringify(task)}`);
            }

            if (taskIds.has(task.id)) {
                throw new Error(`Duplicate task ID: ${task.id}`);
            }
            taskIds.add(task.id);

            if (task.type === 'function') {
                if (!task.functionName) {
                    throw new Error(`Function task missing functionName: ${task.id}`);
                }
                if (!this.functions.some(f => f.name === task.functionName)) {
                    throw new Error(`Unknown function: ${task.functionName}`);
                }
            } else if (task.type === 'subdag') {
                if (!task.subdag?.goal || !task.subdag?.requiredFunctions) {
                    throw new Error(`Invalid subdag configuration: ${task.id}`);
                }
                for (const funcName of task.subdag.requiredFunctions) {
                    if (!this.functions.some(f => f.name === funcName)) {
                        throw new Error(`Unknown required function in subdag: ${funcName}`);
                    }
                }
            }
        }
    }

    public updateLastResponse(response: string): void {
        this.lastResponse = response;
    }

    public shouldTransferManually(): boolean {
        return !this.dagExecuted;
    }

    public async nextAgent(): Promise<BaseAgent | null> {
        if (!this.lastResponse) {
            return null;
        }

        try {
            const dag = JSON.parse(this.lastResponse) as DagTask[];
            return new DagExecutionAgent(
                this.goal,
                this.functions,
                dag,
                this.parentResults
            );
        } catch (e) {
            return null;
        }
    }

    public getCreatedDag(): DagTask[] | null {
        return this.createdDag;
    }

    public async createDag(): Promise<DagTask[]> {
        if (!this.createdDag) {
            throw new Error('DAG has not been created yet');
        }
        return this.createdDag;
    }
}

export class DagExecutionAgent extends BaseAgent {
    protected taskResults: Map<string, any> = new Map();
    protected completedTasks: Set<string> = new Set();
    protected currentTask: string | null = null;

    constructor(
        goal: string,
        functions: AgentFunction[],
        protected dag: DagTask[],
        protected parentResults?: Map<string, any>
    ) {
        const agent: Agent = {
            name: 'DAG Executor',
            model: 'gpt-4o',
            instructions: DAG_EXECUTION_INSTRUCTIONS
                .replace('{dagStructure}', JSON.stringify(dag, null, 2))
                .replace('{functionList}', functions.map(f => BaseAgent.sanitizeFunctionName(f.name)).join(', ')),
            functions: functions,
            toolChoice: 'auto',
            parallelToolCalls: true
        };

        console.log('Execution agent:', agent);

        super(goal, functions, agent);
    }

    protected resolveArguments(args: Record<string, any>): Record<string, any> {
        const resolved: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(args)) {
            if (typeof value === 'string') {
                if (value.startsWith('$parent.')) {
                    const parentTaskId = value.slice(8);
                    if (!this.parentResults?.has(parentTaskId)) {
                        throw new Error(`Parent result not found: ${parentTaskId}`);
                    }
                    resolved[key] = this.parentResults.get(parentTaskId);
                } else if (value.startsWith('$')) {
                    const taskId = value.slice(1);
                    if (!this.taskResults.has(taskId)) {
                        throw new Error(`Task result not found: ${taskId}`);
                    }
                    resolved[key] = this.taskResults.get(taskId);
                } else {
                    resolved[key] = value;
                }
            } else {
                resolved[key] = value;
            }
        }
        
        return resolved;
    }

    protected getSubsetOfFunctions(functionNames: string[]): AgentFunction[] {
        const subset = this.functions.filter(f => functionNames.includes(f.name));
        if (subset.length !== functionNames.length) {
            const missing = functionNames.filter(
                name => !this.functions.some(f => f.name === name)
            );
            throw new Error(`Missing required functions: ${missing.join(', ')}`);
        }
        return subset;
    }

    protected async executeTask(task: DagTask): Promise<any> {
        this.currentTask = task.id;

        try {
            if (!task.dependencies.every(depId => this.completedTasks.has(depId))) {
                throw new Error(`Dependencies not met for task: ${task.id}`);
            }

            let result;
            if (task.type === 'subdag' && task.subdag) {
                const subFunctions = this.getSubsetOfFunctions(task.subdag.requiredFunctions);
                const subCreator = new DagCreationAgent(
                    task.subdag.goal,
                    subFunctions,
                    true,
                    this.taskResults
                );
                
                const subDag = await subCreator.createDag();
                const subExecutor = new DagExecutionAgent(
                    task.subdag.goal,
                    subFunctions,
                    subDag,
                    this.taskResults
                );
                
                result = await subExecutor.execute();
            } else if (task.type === 'function' && task.functionName) {
                const func = this.functions.find(f => f.name === task.functionName);
                if (!func) {
                    throw new Error(`Function not found: ${task.functionName}`);
                }

                const args = this.resolveArguments(task.functionArgs || {});
                result = await func(args);
            }

            this.taskResults.set(task.id, result);
            this.completedTasks.add(task.id);
            return result;
        } finally {
            this.currentTask = null;
        }
    }

    public async execute(): Promise<Map<string, any>> {
        for (const task of this.dag) {
            await this.executeTask(task);
        }
        return this.taskResults;
    }

    public shouldTransferManually(): boolean {
        return false;
    }

    public async nextAgent(): Promise<BaseAgent | null> {
        return null;
    }

    updateLastResponse(response: string): void {
        this.lastResponse = response;
        this.logger.debug('Execution agent updated response:', response);
    }
}

export class MetaDagCoordinator extends BaseAgent {
    private creationAgent: DagCreationAgent | null = null;
    private executionAgent: DagExecutionAgent | null = null;
    private state: 'CREATING' | 'EXECUTING' = 'CREATING';

    constructor(goal: string, functions: AgentFunction[]) {
        // Initial agent setup with meta-DAG instructions
        const agent: Agent = {
            name: 'MetaDAG Coordinator',
            model: 'gpt-4',
            instructions: META_DAG_INSTRUCTIONS.replace('{goal}', goal),
            functions,
            toolChoice: 'auto',
            parallelToolCalls: true
        };
        
        super(goal, functions, agent);
        this.creationAgent = new DagCreationAgent(goal, functions);
    }

    shouldTransferManually(): boolean {
        if (this.state === 'CREATING') {
            return this.creationAgent?.shouldTransferManually() ?? false;
        } else {
            return this.executionAgent?.shouldTransferManually() ?? false;
        }
    }

    async nextAgent(): Promise<BaseAgent | null> {
        const dag = this.creationAgent?.getCreatedDag();
        if (dag) {
            this.executionAgent = new DagExecutionAgent(this.goal, this.functions, dag);
            return this.executionAgent as BaseAgent;
        }
        return null;
    }

    updateLastResponse(response: string): void {
        this.lastResponse = response;
        // Delegate to current active agent
        if (this.state === 'CREATING' && this.creationAgent) {
            this.creationAgent.updateLastResponse(response);
        } else if (this.state === 'EXECUTING' && this.executionAgent) {
            this.executionAgent.updateLastResponse(response);
        }
        this.logger.debug('Meta coordinator updated response:', response);
    }

    getAgent(): Agent {
        if (this.state === 'CREATING') {
            return this.creationAgent?.getAgent() ?? super.getAgent();
        } else {
            return this.executionAgent?.getAgent() ?? super.getAgent();
        }
    }
}