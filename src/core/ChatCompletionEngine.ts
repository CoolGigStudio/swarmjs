// engines/ChatCompletionEngine.ts
import { Message, Tool, ToolCall, Response, Result, StreamChunk, EngineConfig, Goal } from './types-old';
import { BaseEngine } from './BaseEngine';
import BaseAgent from './BaseAgent';
import OpenAI from 'openai';
import BaseSwarm from './BaseSwarm';

export class ChatCompletionEngine extends BaseEngine {
  private client: OpenAI;

  constructor(client: OpenAI, config: EngineConfig = {}) {
    super(config);
    this.client = client;
  }

  async initialize(): Promise<void> {
    // No initialization needed for Chat API
  }

  async executeAgent(
    agent: BaseAgent,
    goal: Goal,
    messages: Message[] = []
  ): Promise<Response> {
    const goalMessage = {
      role: 'user',
      content: `Goal: ${goal.description}\nSuccess Criteria: ${goal.successCriteria}`
    };
    return this.run(agent, [goalMessage, ...messages]);
  }

  async executeSwarm(
    swarm: BaseSwarm,
    goal: Goal,
    messages: Message[] = []
  ): Promise<Response> {
    let currentAgent = swarm.getInitialAgent();
    let allMessages = messages;
    let history = [];
    
    while (currentAgent) {
      const response = await this.executeAgent(currentAgent, goal, allMessages);
      history.push(...response.messages);
      allMessages = history;
      currentAgent = response.agent;
    }

    return {
      messages: history,
      agent: null,
      contextVariables: this.contextVariables
    };
  }

  async *streamAgent(
    agent: BaseAgent,
    goal: Goal,
    messages: Message[] = []
  ): AsyncGenerator<StreamChunk> {
    const goalMessage = {
      role: 'user',
      content: `Goal: ${goal.description}\nSuccess Criteria: ${goal.successCriteria}`
    };
    yield* this.runAndStream(agent, [goalMessage, ...messages]);
  }

  async *streamSwarm(
    swarm: BaseSwarm,
    goal: Goal,
    messages: Message[] = []
  ): AsyncGenerator<StreamChunk> {
    let currentAgent = swarm.getInitialAgent();
    let allMessages = messages;

    while (currentAgent) {
      for await (const chunk of this.streamAgent(currentAgent, goal, allMessages)) {
        if ('response' in chunk) {
          allMessages = [...allMessages, ...chunk.response.messages];
          currentAgent = chunk.response.agent;
        }
        yield chunk;
      }
    }
  }

  async createCompletion(
    agent: BaseAgent,
    messages: Message[],
    tools?: Tool[]
  ): Promise<any> {
    const instructions = typeof agent.instructions === 'function' 
      ? agent.instructions(this.contextVariables)
      : agent.instructions;

    const systemMessage = { role: "system", content: instructions };
    const allMessages = [systemMessage, ...messages];

    const toolSchemas = tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));

    this.debugPrint('Creating completion with messages:', allMessages);

    const createParams: any = {
      model: this.modelOverride || agent.model,
      messages: allMessages,
      tools: toolSchemas || undefined,
      tool_choice: agent.toolChoice,
      stream: this.stream,
    };

    if (tools) {
      createParams.parallel_tool_calls = agent.parallelToolCalls;
    }

    return await this.client.chat.completions.create(createParams);
  }

  async run(
    agent: BaseAgent,
    messages: Message[]
  ): Promise<Response> {
    if (this.stream) {
      const generator = this.runAndStream(agent, messages);
      let lastResponse: Response | undefined;
      for await (const chunk of generator) {
        if ('response' in chunk) {
          lastResponse = chunk.response;
        }
      }
      return lastResponse!;
    }

    let activeAgent = agent;
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < this.maxTurns && activeAgent) {
      const completion = await this.createCompletion(
        activeAgent,
        history,
        activeAgent.getTools()
      );

      const message = completion.choices[0].message;
      this.debugPrint('Received completion:', message);

      message.sender = activeAgent.name;
      history.push(JSON.parse(JSON.stringify(message)));

      if (!message.tool_calls) {
        this.debugPrint('No tool calls, ending turn.');
        break;
      }

      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent
      );

      history.push(...partialResponse.messages);
      this.contextVariables = {
        ...this.contextVariables,
        ...partialResponse.contextVariables
      };

      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    return {
      messages: history.slice(initLen),
      agent: activeAgent,
      contextVariables: this.contextVariables
    };
  }

  async *runAndStream(
    agent: BaseAgent,
    messages: Message[]
  ): AsyncGenerator<StreamChunk> {
    let activeAgent = agent;
    const history = [...messages];
    const initLen = messages.length;

    while (history.length - initLen < this.maxTurns) {
      let message: Message = {
        content: '',
        sender: agent.name,
        role: 'assistant',
        tool_calls: []
      };

      const completion = await this.createCompletion(
        activeAgent,
        history,
        activeAgent.getTools()
      );

      yield { delim: 'start' };

      for await (const chunk of completion) {
        const delta = chunk.choices[0].delta;
        if (delta.role === 'assistant') {
          delta.sender = activeAgent.name;
        }
        yield delta;
        this.mergeChunk(message, delta);
      }

      yield { delim: 'end' };

      if (!message.tool_calls?.length) {
        this.debugPrint('No tool calls, ending turn.');
        break;
      }

      const partialResponse = await this.handleToolCalls(
        message.tool_calls,
        activeAgent
      );

      history.push(...partialResponse.messages);
      this.contextVariables = {
        ...this.contextVariables,
        ...partialResponse.contextVariables
      };

      if (partialResponse.agent) {
        activeAgent = partialResponse.agent;
      }
    }

    yield {
      response: {
        messages: history.slice(initLen),
        agent: activeAgent,
        contextVariables: this.contextVariables
      }
    };
  }

  async handleToolCall(
    toolCall: ToolCall,
    agent: BaseAgent
  ): Promise<Result> {
    try {
      const result = await this.executeToolCall(toolCall, agent);
      
      if (result instanceof BaseAgent) {
        return {
          value: JSON.stringify({ assistant: result.name }),
          agent: result
        };
      }
      
      if (typeof result === 'object' && 'value' in result) {
        return result as Result;
      }

      return { value: String(result) };
    } catch (error) {
      this.debugPrint(`Error handling tool call: ${error}`);
      throw error;
    }
  }

  async handleToolCalls(
    toolCalls: ToolCall[],
    agent: BaseAgent
  ): Promise<Response> {
    const response: Response = {
      messages: [],
      agent: null,
      contextVariables: {}
    };

    for (const toolCall of toolCalls) {
      if (!this.validateToolCall(toolCall, agent)) {
        this.debugPrint(`Invalid tool call: ${toolCall.function.name}`);
        response.messages.push({
          role: 'tool',
          content: `Error: Tool ${toolCall.function.name} not found.`,
          sender: agent.name
        });
        continue;
      }

      const result = await this.handleToolCall(toolCall, agent);
      
      response.messages.push({
        role: 'tool',
        content: result.value,
        sender: agent.name
      });

      if (result.contextVariables) {
        response.contextVariables = {
          ...response.contextVariables,
          ...result.contextVariables
        };
      }

      if (result.agent) {
        response.agent = result.agent;
      }
    }

    return response;
  }
}