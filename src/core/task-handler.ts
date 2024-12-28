import { AgentTransition, TaskResult, ToolResult } from "./types";
import { SwarmEngine } from "./SwarmEngine";

export interface TaskHandler {
    handleTask(task_id: string, payload: Record<string, any>): Promise<TaskResult>;
    handleToolExecution(tool_id: string, payload: Record<string, any>): Promise<ToolResult>;
    handleTransition(from_agent: string, transition: AgentTransition): Promise<TaskResult>;
}

export class DirectTaskHandler implements TaskHandler {
    constructor(private engine: SwarmEngine) {}

    async handleTask(task_id: string, payload: Record<string, any>): Promise<TaskResult> {
        const { agent_config, messages } = payload;
        const result = await this.engine.runAgent(agent_config, messages);
        return {
            task_id,
            result,
            metadata: { timestamp: new Date().toISOString() }
        };
    }

    async handleToolExecution(tool_id: string, payload: Record<string, any>): Promise<ToolResult> {
        const { tool_name, arguments: args } = payload;
        const result = await this.engine.executeTool(tool_name, args);
        return {
            tool_id,
            result,
            metadata: { timestamp: new Date().toISOString() }
        };
    }

    async handleTransition(from_agent: string, transition: AgentTransition): Promise<TaskResult> {
        const target_agent = this.engine.getAgentConfig(transition.to_agent);
        if (!target_agent) {
            throw new Error(`Unknown agent: ${transition.to_agent}`);
        }

        // Transfer memory if needed
        if (transition.preserve_memory) {
            await this.transferMemory(from_agent, transition.to_agent);
        }

        // Create new task for target agent
        const new_task_id = crypto.randomUUID();
        return this.handleTask(new_task_id, {
            agent_config: target_agent,
            messages: [{
                role: 'user',
                content: JSON.stringify(transition.payload)
            }],
            context: transition.preserve_context 
                ? this.engine.getAgentContext(from_agent) 
                : {}
        });
    }

    private async transferMemory(from_agent: string, to_agent: string): Promise<void> {
        const memories = await this.engine.memoryManager.getMemories(from_agent);
        for (const memory of memories) {
            await this.engine.memoryManager.addMemory(to_agent, {
                ...memory,
                timestamp: Date.now(),
                source: `transition_from_${from_agent}`
            });
        }
    }
}