import BaseAgent from "./BaseAgent";

export interface Goal {
    description: string;
    successCriteria: string;
    context?: Record<string, any>;
  }
  
  export interface Tool {
    name: string;
    description: string;
    function: (...args: any[]) => Promise<any>;
    parameters: Record<string, any>;
    examples?: Record<string, any>[];
  }
  
  export interface Message {
    role: string;
    content: string;
    sender?: string;
    tool_calls?: ToolCall[];
  }
  
  export interface ToolCall {
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }
  
  export interface Response {
    messages: Message[];
    agent: BaseAgent | null;
    contextVariables: Record<string, any>;
  }
  
  export interface Result {
    value: string;
    agent?: BaseAgent;
    contextVariables?: Record<string, any>;
  }
  
  export interface StreamChunk {
    delim?: 'start' | 'end';
    content?: string;
    sender?: string;
    tool_calls?: ToolCall[];
    response?: Response;
  }
  
  export interface AssistantConfig {
    name: string;
    logFlag: boolean;
    tools: string[];
    model: string;
    instructions: string | ((context: Record<string, any>) => string);
  }
  
  export interface EngineConfig {
    debug?: boolean;
    maxTurns?: number;
    stream?: boolean;
    testMode?: boolean;
    contextVariables?: Record<string, any>;
    modelOverride?: string;
  }