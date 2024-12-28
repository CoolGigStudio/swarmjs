import { Message, AgentConfig, ToolDefinition, CompletionResult } from '../types';

export interface BaseProvider {
    initialize(config: Record<string, any>): Promise<void>;
    getCompletion(
        messages: Message[],
        tools: ToolDefinition[],
        config: AgentConfig
    ): Promise<CompletionResult>;
}

