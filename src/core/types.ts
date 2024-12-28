// types.ts
export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolCall {
    id: string;
    type: string;
    function: {
        name: string;
        arguments: Record<string, any>;
    };
}

export interface AgentConfig {
    name: string;
    instructions: string;
    tools: ToolDefinition[];
    model: string;
    provider_type: ProviderType;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

export enum ProviderType {
    ANTHROPIC = 'anthropic',
    OPENAI_CHAT = 'openai_chat',
    OPENAI_ASSISTANT = 'openai_assistant'
}

export interface AgentTransition {
    to_agent: string;
    payload: Record<string, any>;
    preserve_memory: boolean;
    preserve_context: boolean;
}

export interface TaskResult {
    task_id: string;
    result: any;
    transition?: AgentTransition;
    metadata?: Record<string, any>;
}

export interface CompletionResult {
    messages: Message[];
    isComplete: boolean;
    transition?: AgentTransition;
}

export interface ToolResult {
    tool_id: string;
    result: any;
    metadata?: Record<string, any>;
}