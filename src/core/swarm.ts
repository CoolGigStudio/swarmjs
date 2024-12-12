import OpenAI from 'openai';
import { 
  ChatCompletionTool,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption
} from 'openai/resources/chat/completions';
import { FunctionDefinition, FunctionParameters } from 'openai/resources/shared';
import { Agent, Response, Result, AgentFunction } from './types';
import { debugPrint } from '../utils/debug';
import { functionToJson } from '../utils/function-parser';
import { mergeChunk } from '../utils/merge';

const CTX_VARS_NAME = 'contextVariables';

const DEBUG = process.env.DEBUG === 'true';

interface SafeFunctionDefinition extends FunctionDefinition {
  parameters: FunctionParameters & {
    properties: Record<string, unknown>;
  };
}

interface SafeChatCompletionTool extends Omit<ChatCompletionTool, 'function'> {
  function: SafeFunctionDefinition;
}

export class Swarm {
  private client: OpenAI;

  constructor(client?: OpenAI) {
    this.client = client || new OpenAI();
  }

  private async getChatCompletion(
    agent: Agent,
    history: any[],
    contextVariables: Record<string, any>,
    modelOverride: string | null,
    stream: boolean,
    debug: boolean
  ): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const instructions = typeof agent.instructions === 'function'
      ? agent.instructions(contextVariables)
      : agent.instructions;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: instructions },
      ...history
    ];
    
    debugPrint(debug, 'Getting chat completion for...:', messages);

    const tools: ChatCompletionTool[] = agent.functions.map(f => {
      // Get the tool with guaranteed parameter structure
      const rawTool = functionToJson(f);
      const tool = rawTool as SafeChatCompletionTool;
      
      // Type-safe parameter manipulation
      const properties = tool.function.parameters.properties;
      
      // Remove context variables if they exist
      if (CTX_VARS_NAME in properties) {
        delete properties[CTX_VARS_NAME];
      }

      // Handle required parameters
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
      model: modelOverride || agent.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream
    };

    // Handle tool_choice based on OpenAI's expected types
    if (tools.length > 0) {
      createParams.tool_choice = (agent.toolChoice ?? 'auto') as ChatCompletionToolChoiceOption;
    } else {
      createParams.tool_choice = 'none';
    }

    return this.client.chat.completions.create(createParams);
  }

  private handleFunctionResult(result: any, debug: boolean): Result {
    // Case 1: Already a Result object
    if (result && typeof result === 'object' && 'value' in result && 'agent' in result && 'contextVariables' in result) {
        return result as Result;
    }

    // Case 2: Agent object
    if (result && typeof result === 'object' && 'name' in result && 'model' in result) {
        return {
            value: JSON.stringify({ assistant: result.name }),
            agent: result as Agent,
            contextVariables: {}
        };
    }

    // Case 3: Handle other types with error checking
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
    const functionMap = new Map(
      functions.map(f => [f.name, f])
    );

    const partialResponse: Response = {
      messages: [],
      agent: null,
      contextVariables: {}
    };

    for (const toolCall of toolCalls) {
      console.log(`Tool call: ${JSON.stringify(toolCall)}`);
      // Add safe parsing of arguments
      const funName = toolCall.function.name;
      //debugPrint(debug, `Tool call name: ${funName}`);
      console.log(`Tool call name: ${funName}`);
      if (!functionMap.has(funName)) {
        debugPrint(debug, `Tool ${funName} not found in function map.`);
        partialResponse.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: funName,
          content: `Error: Tool ${funName} not found.`
        });
        continue;
      }

      const args = JSON.parse(toolCall.function.arguments);
      //debugPrint(debug, `Processing tool call: ${funName} with arguments`, args);
      console.log(`Processing tool call: ${funName} with arguments`, args);

      const func = functionMap.get(funName)!;
      if (func.toString().includes(CTX_VARS_NAME)) {
        args[CTX_VARS_NAME] = contextVariables;
      }

      console.log(`Calling function: ${func.name} with arguments: ${JSON.stringify(args)}`);
      const rawResult = await Promise.resolve(func(...Object.values(args)));
      const result = this.handleFunctionResult(rawResult, debug);

      console.log(`Tool call result: ${JSON.stringify(result)}`);
      partialResponse.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: funName,
        content: result.value
      });

      partialResponse.contextVariables = {
        ...partialResponse.contextVariables,
        ...result.contextVariables
      };

      if (result.agent) {
        partialResponse.agent = result.agent;
      }
    }

    return partialResponse;
  }

  async *runAndStream(
    agent: Agent,
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
        sender: agent.name,
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
          (delta as any).sender = activeAgent.name;
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
        if ('shouldTransferManually' in activeAgent) {
          const agent = activeAgent as unknown as { 
            shouldTransferManually: () => boolean;
            updateLastResponse?: (response: string) => void;
            nextAgent: () => Promise<Agent | null>;
          };
          
          if (agent.updateLastResponse) {
            agent.updateLastResponse(message.content || '');
          }
        
          if (agent.shouldTransferManually()) {
            debugPrint(debug, 'No tool calls, but manual transfer is required');
            const nextAgent = await agent.nextAgent();
            if (nextAgent) {
              debugPrint(debug, 'Transferring to next agent manually');
              activeAgent = nextAgent;
              continue;
            }
          }
        }
        debugPrint(debug, 'Ending turn.');
        break;
     }

      console.log(`Raw tool calls>>>>>>>: ${JSON.stringify(message.tool_calls)}`);
      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent.functions,
        ctxVars,
        debug
      );

      history.push(...partialResponse.messages);
      Object.assign(ctxVars, partialResponse.contextVariables);
      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    yield {
      response: {
        messages: history.slice(initLen),
        agent: activeAgent,
        contextVariables: ctxVars
      }
    };
  }

  async run(
    agent: Agent,
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

    while (history.length - initLen < maxTurns && activeAgent) {
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
      (message as any).sender = activeAgent.name;
      history.push(JSON.parse(JSON.stringify(message)));

      if (!message.tool_calls || !executeTools) {
        debugPrint(debug, 'Ending turn.');
        break;
      }

      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent.functions,
        ctxVars,
        debug
      );

      history.push(...partialResponse.messages);
      Object.assign(ctxVars, partialResponse.contextVariables);
      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    return {
      messages: history.slice(initLen),
      agent: activeAgent,
      contextVariables: ctxVars
    };
  }
}