// swarm.ts
import OpenAI from 'openai';
import { 
  ChatCompletionTool,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions';
import { FunctionDefinition, FunctionParameters } from 'openai/resources/shared';
import { BaseAgent } from './BaseAgent';
import { Agent, Response, Result, AgentFunction } from './types';
import { debugPrint } from '../utils/debug';
import { functionToJson } from '../utils/function-parser';
import { mergeChunk } from '../utils/merge';

const CTX_VARS_NAME = 'contextVariables';

interface SafeFunctionDefinition extends FunctionDefinition {
  parameters: FunctionParameters & {
    properties: Record<string, unknown>;
  };
}

interface SafeChatCompletionTool extends Omit<ChatCompletionTool, 'function'> {
  function: SafeFunctionDefinition;
}

type BaseAgentConstructor = new (
  goal: string, 
  functions: AgentFunction[], 
  agent: Agent
) => BaseAgent;

export class Swarm {
  private client: OpenAI;
  private idCounter: number = 0;
  // Use the constructor type instead of typeof BaseAgent
  private agentRegistry: Map<string, BaseAgentConstructor> = new Map();

  constructor(client?: OpenAI) {
      this.client = client || new OpenAI();
  }

  // Update the register method to use the constructor type
  public registerAgent(name: string, agentClass: BaseAgentConstructor) {
      this.agentRegistry.set(name, agentClass);
  }

  private createAgentInstance(agentConfig: Agent, currentAgent: BaseAgent): BaseAgent | null {
      const AgentClass = this.agentRegistry.get(agentConfig.name);
      if (!AgentClass) {
          debugPrint(true, `No agent class registered for name: ${agentConfig.name}`);
          return null;
      }
      return new AgentClass(currentAgent.goal, currentAgent.functions, agentConfig);
  }

  private generateToolCallId(): string {
    return `call_${(this.idCounter++).toString(36)}`.slice(0, 40);
  }

  private async getChatCompletion(
    agent: BaseAgent,
    history: ChatCompletionMessageParam[],
    contextVariables: Record<string, any>,
    modelOverride: string | null,
    stream: boolean,
    debug: boolean
  ): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const agentInfo = agent.getAgent();
    const instructions = typeof agentInfo.instructions === 'function'
      ? agentInfo.instructions(contextVariables)
      : agentInfo.instructions;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: instructions as string },
      ...history
    ];
    
    debugPrint(debug, 'Getting chat completion for...:', messages);

    const tools: ChatCompletionTool[] = agentInfo.functions.map(f => {
      const rawTool = functionToJson(f);
      const tool = rawTool as SafeChatCompletionTool;
      const properties = tool.function.parameters.properties;
      
      if (CTX_VARS_NAME in properties) {
        delete properties[CTX_VARS_NAME];
      }

      if (Array.isArray(tool.function.parameters.required)) {
        const required = tool.function.parameters.required;
        const contextVarIndex = required.indexOf(CTX_VARS_NAME);
        
        if (contextVarIndex !== -1) {
          required.splice(contextVarIndex, 1);
          if (required.length === 0) {
            delete tool.function.parameters.required;
          }
        }
      }

      return tool as ChatCompletionTool;
    });

    const createParams: ChatCompletionCreateParams = {
      model: modelOverride || agentInfo.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream
    };

    if (tools.length > 0) {
      createParams.tool_choice = agentInfo.toolChoice ?? 'auto';
    } else {
      createParams.tool_choice = 'none';
    }

    return this.client.chat.completions.create(createParams);
  }

  private handleFunctionResult(result: any, debug: boolean): Result {
    if (result && typeof result === 'object' && 'value' in result && 'agent' in result && 'contextVariables' in result) {
      return result as Result;
    }

    if (result && typeof result === 'object' && 'name' in result && 'model' in result) {
      return {
        value: JSON.stringify({ assistant: result.name }),
        agent: result as Agent,
        contextVariables: {}
      };
    }

    try {
      return {
        value: String(result),
        agent: null,
        contextVariables: {}
      };
    } catch (e) {
      const errorMessage = `Failed to cast response to string: ${result}. Make sure agent functions return a string or Result object. Error: ${e}`;
      debugPrint(debug, errorMessage);
      throw new TypeError(errorMessage);
    }
  }

  private async handleToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
    functions: AgentFunction[],
    contextVariables: Record<string, any>,
    debug: boolean
  ): Promise<Response> {
    const functionMap = new Map(functions.map(f => [f.name, f]));
    const partialResponse: Response = {
      messages: [],
      agent: null,
      contextVariables: {}
    };

    const toolCallPromises = toolCalls.map(async toolCall => {
      const originalId = toolCall.id;
      console.log(`Processing tool call:`, {
        id: originalId,
        name: toolCall.function.name,
        args: toolCall.function.arguments
      });

      if (!functionMap.has(toolCall.function.name)) {
        debugPrint(debug, `Tool ${toolCall.function.name} not found in function map.`);
        return {
          message: {
            role: 'tool' as const,
            tool_call_id: originalId,
            name: toolCall.function.name,
            content: `Error: Tool ${toolCall.function.name} not found.`
          },
          result: null
        };
      }

      try {
        const args = JSON.parse(toolCall.function.arguments);
        const func = functionMap.get(toolCall.function.name)!;

        if (func.toString().includes(CTX_VARS_NAME)) {
          args[CTX_VARS_NAME] = contextVariables;
        }

        const rawResult = await Promise.resolve(func(...Object.values(args)));
        const result = this.handleFunctionResult(rawResult, debug);

        return {
          message: {
            role: 'tool' as const,
            tool_call_id: originalId,
            name: toolCall.function.name,
            content: result.value
          },
          result
        };
      } catch (error) {
        console.error(`Error executing function ${toolCall.function.name}:`, error);
        return {
          message: {
            role: 'tool' as const,
            tool_call_id: originalId,
            name: toolCall.function.name,
            content: `Error executing function: ${error instanceof Error ? error.message : String(error)}`
          },
          result: null
        };
      }
    });

    const results = await Promise.all(toolCallPromises);

    for (const { message, result } of results) {
      partialResponse.messages.push(message);
      
      if (result?.agent) {
        partialResponse.agent = result.agent;
      }
      
      if (result?.contextVariables) {
        partialResponse.contextVariables = {
          ...partialResponse.contextVariables,
          ...result.contextVariables
        };
      }
    }

    return partialResponse;
  }

  async *runAndStream(
    agent: BaseAgent,
    messages: any[],
    contextVariables: Record<string, any> = {},
    modelOverride: string | null = null,
    debug: boolean = false,
    maxTurns: number = Infinity,
    executeTools: boolean = true
  ): AsyncGenerator<any, void, unknown> {
    let activeAgent = agent;
    const ctxVars = { ...contextVariables };
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < maxTurns) {
      const message: Record<string, any> = {
        content: '',
        sender: activeAgent.getAgent().name,
        role: 'assistant',
        function_call: null,
        tool_calls: {}
      };

      const completion = await this.getChatCompletion(
        activeAgent,
        history,
        ctxVars,
        modelOverride,
        true,
        debug
      );

      yield { delim: 'start' };

      for await (const chunk of completion as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        const delta = chunk.choices[0].delta;
        if (delta.role === 'assistant') {
          (delta as any).sender = activeAgent.getAgent().name;
        }
        yield delta;
        mergeChunk(message, delta as any);
      }

      yield { delim: 'end' };

      message.tool_calls = Object.values(message.tool_calls);
      if (!message.tool_calls.length) {
        message.tool_calls = null;
      }

      debugPrint(debug, 'Received completion:', message);
      history.push(message);

      if (!message.tool_calls || !executeTools) {
        debugPrint(debug, 'LLM trying to end turn, activeAgent:', activeAgent.getAgent());
        if (activeAgent.shouldTransferManually()) {
          debugPrint(debug, 'Agent requested manual transfer');
          activeAgent.updateLastResponse(message.content || '');
          const nextAgent = await activeAgent.nextAgent();
          if (nextAgent) {
            debugPrint(debug, 'Transferring to next agent manually');
            activeAgent = nextAgent;
          }
        }
        
        debugPrint(debug, 'Ending turn.');
        break;
      }

      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent.getAgent().functions,
        ctxVars,
        debug
      );

      history.push(...partialResponse.messages);
      Object.assign(ctxVars, partialResponse.contextVariables);
      if (partialResponse.agent) {
        const newAgent = this.createAgentInstance(partialResponse.agent, activeAgent);
        if (newAgent) {
          activeAgent = newAgent;
        }
      }
    }

    yield {
      response: {
        messages: history.slice(initLen),
        agent: activeAgent.getAgent(),
        contextVariables: ctxVars
      }
    };
  }

  async run(
    agent: BaseAgent,
    messages: any[],
    contextVariables: Record<string, any> = {},
    modelOverride: string | null = null,
    stream: boolean = false,
    debug: boolean = false,
    maxTurns: number = Infinity,
    executeTools: boolean = true
  ): Promise<Response | AsyncGenerator<any, void, unknown>> {
    if (stream) {
      return this.runAndStream(
        agent,
        messages,
        contextVariables,
        modelOverride,
        debug,
        maxTurns,
        executeTools
      );
    }

    let activeAgent = agent;
    const ctxVars = { ...contextVariables };
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < maxTurns) {
      const completion = await this.getChatCompletion(
        activeAgent,
        history,
        ctxVars,
        modelOverride,
        false,
        debug
      ) as OpenAI.Chat.Completions.ChatCompletion;

      const message = completion.choices[0].message;
      debugPrint(debug, 'Received completion:', message);
      (message as any).sender = activeAgent.getAgent().name;
      history.push(JSON.parse(JSON.stringify(message)));

      if (!message.tool_calls || !executeTools) {
        debugPrint(debug, 'LLM trying to end turn, activeAgent:', activeAgent.getAgent());
        if (activeAgent.shouldTransferManually()) {
          debugPrint(debug, 'Agent requested manual transfer');
          activeAgent.updateLastResponse(message.content || '');
          const nextAgent = await activeAgent.nextAgent();
          if (nextAgent) {
            debugPrint(debug, 'Transferring to next agent manually');
            activeAgent = nextAgent as BaseAgent;
            continue;
          }
        }
        
        debugPrint(debug, 'Ending turn.');
        break;
      }

      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent.getAgent().functions,
        ctxVars,
        debug
      );

      history.push(...partialResponse.messages);
      Object.assign(ctxVars, partialResponse.contextVariables);
      if (partialResponse.agent) {
        const newAgent = this.createAgentInstance(partialResponse.agent, activeAgent);
        if (newAgent) {
          activeAgent = newAgent;
        }
      }
    }

    return {
      messages: history.slice(initLen),
      agent: activeAgent.getAgent(),
      contextVariables: ctxVars
    };
  }
}