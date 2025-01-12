/** Base types */
export type ToolParameter = string | number | boolean | object | Array<any>;
export type ToolResult = unknown;

/** Agent configuration */
export interface AgentConfig {
  name: string;
  description: string;
  systemMessage: string;
  allowedTools: string[];
  model?: string;
  config?: Record<string, unknown>;
}

/** Function Parameter Properties */
export interface FunctionParameterProperties {
  type: string;
  description?: string;
  enum?: string[];
  items?: {
    type: string;
    enum?: string[];
  };
}

/** Function Parameters */
export interface FunctionParameters {
  type: 'object';
  properties: Record<string, FunctionParameterProperties>;
  required?: string[];
}

/** Function Definition */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: FunctionParameters;
}

/** Tool Definition */
export interface ToolDefinition {
  type: 'function';
  function: FunctionDefinition;
  handler: (params: Record<string, ToolParameter>) => Promise<ToolResult>;
  examples?: string[]; // Optional field for documentation
}

/** Framework configuration */
export interface SwarmConfig {
  id?: string;
  agents: AgentConfig[];
  tools: ToolDefinition[];
  model?: string;
  planningModel?: string;
  apiKey?: string;
  script?: string;
  options?: {
    maxConcurrentSessions?: number;
    toolTimeout?: number;
    debug?: boolean;
  };
}

/** Session state */
export interface Flow {
  id: string;
  agentName: string;
  nodeResults: Record<string, ToolResult>;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

/** Main framework interface */
export interface Swarm {
  init(config: SwarmConfig): Promise<void>;
  run(agentName: string, goal: string): Promise<ToolResult>;
  createSession(agentName: string): Promise<Flow>;
  runSession(
    flowId: string,
    userInput: string,
    options?: {
      script?: string;
      continueFromPrevious?: boolean;
    }
  ): Promise<ToolResult>;
  endSession(flowId: string): Promise<void>;
  getStatus(flowId: string): Promise<Flow>;
  runBatch(
    runs: Array<{
      agentName: string;
      goal: string;
      script?: string;
    }>,
    options?: {
      batchSize?: number;
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<
    Array<{
      id: string;
      result: ToolResult;
      error?: Error;
    }>
  >;
}

/** Framework errors */
export class SwarmError extends Error {
  constructor(
    message: string,
    public code:
      | 'INITIALIZATION_ERROR'
      | 'INVALID_FLOW'
      | 'AGENT_ERROR'
      | 'TOOL_ERROR'
      | 'EXECUTION_ERROR'
      | 'CONCURRENCY_ERROR',
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SwarmError';
  }
}
