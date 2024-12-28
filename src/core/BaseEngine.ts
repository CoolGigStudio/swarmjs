// engines/BaseEngine.ts
import { 
    Message, 
    Tool, 
    ToolCall, 
    Response, 
    Result, 
    StreamChunk,
    EngineConfig, 
    Goal
  } from './types-old';
  import BaseAgent from './BaseAgent';
import BaseSwarm from './BaseSwarm';
  
  export abstract class BaseEngine {
    protected debug: boolean;
    protected maxTurns: number;
    protected stream: boolean;
    protected testMode: boolean;
    protected contextVariables: Record<string, any>;
    protected modelOverride?: string;
  
    constructor(config: EngineConfig = {}) {
      this.debug = config.debug || false;
      this.maxTurns = config.maxTurns || Infinity;
      this.stream = config.stream || false;
      this.testMode = config.testMode || false;
      this.contextVariables = config.contextVariables || {};
      this.modelOverride = config.modelOverride;
    }
  
    protected debugPrint(message: string, data?: any): void {
      if (this.debug) {
        console.log(`[DEBUG] ${message}`, data );
      }
    }
  
    abstract initialize(): Promise<void>;

    abstract executeAgent(
        agent: BaseAgent,
        goal: Goal,
        messages?: Message[]
      ): Promise<Response>;
    
      abstract executeSwarm(
        swarm: BaseSwarm,
        goal: Goal,
        messages?: Message[]
      ): Promise<Response>;
    
      abstract streamAgent(
        agent: BaseAgent,
        goal: Goal,
        messages?: Message[]
      ): AsyncGenerator<StreamChunk>;
    
      abstract streamSwarm(
        swarm: BaseSwarm,
        goal: Goal,
        messages?: Message[]
      ): AsyncGenerator<StreamChunk>;
    
    abstract createCompletion(
      agent: BaseAgent,
      messages: Message[],
      tools?: Tool[]
    ): Promise<any>;
  
    abstract handleToolCall(
      toolCall: ToolCall,
      agent: BaseAgent
    ): Promise<Result>;
  
    abstract handleToolCalls(
      toolCalls: ToolCall[],
      agent: BaseAgent
    ): Promise<Response>;
  
    abstract run(
      agent: BaseAgent,
      messages: Message[]
    ): Promise<Response>;
  
    abstract runAndStream(
      agent: BaseAgent,
      messages: Message[]
    ): AsyncGenerator<StreamChunk>;
  
    protected mergeChunk(message: Message, delta: Partial<Message>): void {
      if (delta.content) {
        message.content = (message.content ) + delta.content;
      }
      if (delta.tool_calls) {
        if (!message.tool_calls) {
          message.tool_calls = [];
        }
        delta.tool_calls.forEach((toolCall, index) => {
          if (!message.tool_calls![index]) {
            message.tool_calls![index] = {
              id: '',
              type: '',
              function: { name: '', arguments: '' }
            };
          }
          if (toolCall.function?.name) {
            message.tool_calls![index].function.name = toolCall.function.name;
          }
          if (toolCall.function?.arguments) {
            message.tool_calls![index].function.arguments += 
              toolCall.function.arguments;
          }
          if (toolCall.id) {
            message.tool_calls![index].id = toolCall.id;
          }
          if (toolCall.type) {
            message.tool_calls![index].type = toolCall.type;
          }
        });
      }
    }
  
    protected validateToolCall(toolCall: ToolCall, agent: BaseAgent): boolean {
      const toolName = toolCall.function.name;
      try {
        const args = JSON.parse(toolCall.function.arguments);
        const tool = agent.getTool(toolName);
        return !!tool;
      } catch (error) {
        this.debugPrint(`Invalid tool call: ${error}`);
        return false;
      }
    }
  
    protected async executeToolCall(
      toolCall: ToolCall,
      agent: BaseAgent
    ): Promise<any> {
      const toolName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      const tool = agent.getTool(toolName);
      
      if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
      }
  
      try {
        return await tool.function({
          ...args,
          contextVariables: this.contextVariables
        });
      } catch (error) {
        this.debugPrint(`Tool execution error: ${error}`);
        throw error;
      }
    }
  }