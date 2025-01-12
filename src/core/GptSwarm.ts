import { OpenAI } from 'openai';
import crypto from 'crypto';
import {
  Swarm,
  SwarmConfig,
  Flow,
  AgentConfig,
  ToolDefinition,
  SwarmError,
  FunctionDefinition,
} from '../types';
import { DEFAULT_ASSISTANT_MODEL, DEFAULT_PLANNING_MODEL } from './constants';
import { RequiredActionFunctionToolCall } from 'openai/resources/beta/threads/runs/runs';
import {
  AGENT_SWITCHING_INSTRUCTIONS,
  DEFAULT_AGENT_SYSTEM_MESSAGE,
  PLANNING_PROMPT,
} from './prompts';

interface SwarmAssistantData {
  assistant: OpenAI.Beta.Assistant;
  agents: Map<string, AgentConfig>;
  tools: Map<string, ToolDefinition>;
}

interface FlowData extends Flow {
  threadId: string;
}

/** API Tool Definition (what gets sent to the API) */
export interface APIToolDefinition {
  type: 'function';
  function: FunctionDefinition;
}

/**
 * This swarm class implements the swarm with a single assistant.
 *   The agents are different roles that the assistant can assume during the execution.
 *   It is lightweight and simply use the chat history for the communication betwen the agents.
 *   It is mainly a sequential execution of the agents.
 */
export class GptSwarm implements Swarm {
  private client!: OpenAI;
  private swarmAssistant: SwarmAssistantData | null = null;
  private flows: Map<string, FlowData> = new Map();
  private config!: SwarmConfig;
  private max_turns: number = 30;

  /**
   * Initialize the GptSwarm with a single assistant
   */
  async init(config: SwarmConfig): Promise<void> {
    try {
      this.config = config;
      this.client = new OpenAI({ apiKey: config.apiKey });

      this.config.id = crypto.randomUUID();
      // Create a single assistant that can handle all agents
      // Question: how to handle the case where the assistant is already created? Is that possible in our case?
      // Note: the name should be unique for all unqiue assistants
      config.tools = this.addBuiltinTools(config.tools || []);
      const tools = this.buildAssistantTools(config.tools || []);
      const agents = new Map(
        (config.agents || []).map((agent) => [agent.name, agent])
      );

      const assistant = await this.client.beta.assistants.create({
        name: this.config.id,
        instructions: this.buildSystemMessage(config.agents || []),
        model: config.model || DEFAULT_ASSISTANT_MODEL,
        tools: tools,
      });

      const toolsMap = new Map(
        config.tools.map((tool) => [tool.function.name, tool])
      );

      this.swarmAssistant = {
        assistant,
        agents,
        tools: toolsMap,
      };
    } catch (error) {
      throw new SwarmError(
        'Failed to initialize GptSwarm',
        'INITIALIZATION_ERROR',
        { error }
      );
    }
  }

  private buildSystemMessage(agents: AgentConfig[]): string {
    const agentDescriptions = agents
      .map(
        (agent) => `
        When acting as ${agent.name}:
        ${agent.systemMessage}
        Available tools: ${[...agent.allowedTools, 'switchAgent'].join(', ')}
      `
      )
      .join('\n\n');

    return `You are a multi-agent assistant that can take on different agent roles.
    Before each interaction, you will be told which role to assume.
    You can switch to another role using the switchAgent tool.
    Here are your available roles and their instructions:
    
    ${agentDescriptions}
    
    Important notes:
    1. Always start your responses by confirming which role you are currently assuming.
    2. Only use the tools that are available to your current role.
    3. When you receive a AGENT_SWITCH instruction from a tool output, switch to the new agent and follow its instructions.
    4. You have to finish all the steps provided by the script.
    5. You have to call the tools in user preferred order in sequence instead of parallel.
    `;
  }

  private addBuiltinTools(tools: ToolDefinition[]): ToolDefinition[] {
    return [
      ...tools,
      {
        type: 'function',
        function: {
          name: 'switchAgent',
          description: 'Switch to another agent',
          parameters: {
            type: 'object',
            properties: {
              agentName: {
                type: 'string',
                description: 'Name of the agent to switch to',
              },
              currentStepNumber: {
                type: 'string',
                description: 'Current step number in the script',
              },
              lastOutput: {
                type: 'string',
                description: 'Last output from the previous agent',
              },
            },
            required: ['agentName', 'currentStepNumber', 'lastOutput'],
          },
        },
        handler: () =>
          Promise.resolve({ type: 'AGENT_SWITCH', to: 'agentName' }),
      },
    ];
  }

  private buildAssistantTools(
    tools: ToolDefinition[]
  ): Array<OpenAI.Beta.AssistantTool> {
    return [
      ...tools.map(
        ({ function: fn }): OpenAI.Beta.AssistantTool => ({
          type: 'function',
          function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters as unknown as OpenAI.FunctionParameters,
          },
        })
      ),
    ];
  }

  /**
   * Handle tool execution
   */
  private async handleToolCall(
    toolCall: RequiredActionFunctionToolCall,
    currentAgent: string
  ): Promise<unknown> {
    if (!this.swarmAssistant)
      throw new SwarmError('Assistant not initialized', 'INITIALIZATION_ERROR');

    // Handle built-in switchAgent tool
    if (toolCall.function.name === 'switchAgent') {
      console.log(`Switching agent to ${toolCall.function.arguments}`);
      const args = JSON.parse(toolCall.function.arguments);
      const newAgentName = args.agentName;
      const currentStepNumber = args.currentStepNumber;
      const lastOutput = args.lastOutput;
      if (!this.swarmAssistant.agents.has(newAgentName)) {
        throw new SwarmError(`Agent ${newAgentName} not found`, 'AGENT_ERROR');
      }

      // Return a special response indicating agent switch
      const switchAgentResponse = JSON.stringify({
        type: 'AGENT_SWITCH',
        from: currentAgent,
        to: newAgentName,
        timestamp: Date.now(),
        instructions: AGENT_SWITCHING_INSTRUCTIONS.replace(
          '{newAgentName}',
          newAgentName
        )
          .replace('{newAgentName}', newAgentName)
          .replace('{currentStepNumber}', currentStepNumber)
          .replace('{lastOutput}', lastOutput)
          .replace(
            '{agentInstructions}',
            this.swarmAssistant.agents.get(newAgentName)?.systemMessage ||
              DEFAULT_AGENT_SYSTEM_MESSAGE
          )
          .replace('{originalScript}', this.config.script || ''),
      });
      console.log('switchAgentResponse:', switchAgentResponse);
      return switchAgentResponse;
    }

    // Handle regular tools
    const agent = this.swarmAssistant.agents.get(currentAgent);
    if (!agent)
      throw new SwarmError(`Agent ${currentAgent} not found`, 'AGENT_ERROR');

    const tool: ToolDefinition | undefined = this.swarmAssistant.tools.get(
      toolCall.function.name
    );
    if (!tool) {
      throw new SwarmError(
        `Tool ${toolCall.function.name} not found`,
        'TOOL_ERROR'
      );
    }

    // Verify tool access
    if (!agent.allowedTools.includes(tool.function.name)) {
      throw new SwarmError(
        `Tool ${tool.function.name} not allowed for agent ${currentAgent}: ${agent.allowedTools}`,
        'TOOL_ERROR'
      );
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      return await tool.handler(args);
    } catch (error) {
      throw new SwarmError(
        `Failed to execute tool ${tool.function.name}`,
        'TOOL_ERROR',
        { error }
      );
    }
  }

  private async executeRun(
    thread: OpenAI.Beta.Thread,
    run: OpenAI.Beta.Threads.Run,
    currentAgent: string
  ): Promise<string> {
    if (!this.swarmAssistant)
      throw new SwarmError('Assistant not initialized', 'INITIALIZATION_ERROR');

    let turn = 0;
    while (turn < this.max_turns) {
      const runStatus = await this.client.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );

      switch (runStatus.status) {
        case 'requires_action':
          console.log(
            `Run requires action: ${JSON.stringify(runStatus.required_action)}`
          );
          if (runStatus.required_action?.submit_tool_outputs.tool_calls) {
            const toolCalls =
              runStatus.required_action.submit_tool_outputs.tool_calls;

            // Handle all tool calls
            const toolOutputs = await Promise.all(
              toolCalls.map(async (toolCall) => {
                const output = await this.handleToolCall(
                  toolCall,
                  currentAgent
                );
                console.log(`Tool output: ${output}`);

                // Check tool's output type
                try {
                  const parsedOutput = JSON.parse(output as string);
                  if (
                    parsedOutput &&
                    'type' in parsedOutput &&
                    'to' in parsedOutput
                  ) {
                    if (parsedOutput.type === 'AGENT_SWITCH') {
                      const newAgent =
                        (parsedOutput.to as string) ?? currentAgent;
                      currentAgent = newAgent;
                      console.log('currentAgent:', currentAgent);
                      console.log('parsedOutput:', parsedOutput);
                      return {
                        tool_call_id: toolCall.id,
                        output: String(parsedOutput),
                      };
                    }
                  }
                } catch (error) {
                  // Ignore parsing errors
                }

                return {
                  tool_call_id: toolCall.id,
                  output: String(output),
                };
              })
            );

            await this.client.beta.threads.runs.submitToolOutputs(
              thread.id,
              run.id,
              { tool_outputs: toolOutputs }
            );
          }
          break;

        case 'completed': {
          const response = await this.client.beta.threads.messages.list(
            thread.id
          );
          const messages = response.data;
          // messages.forEach((message) =>
          //   message.content.forEach((element) =>
          //     console.log('messages:', element)
          //   )
          // );
          const assistantMessage = messages.find(
            (msg) => msg.role === 'assistant' && msg.content
          );
          return assistantMessage?.content[0]?.type === 'text'
            ? assistantMessage.content[0].text.value
            : '';
        }
        case 'failed':
        case 'expired':
        case 'cancelled':
          throw new SwarmError(`Run ${runStatus.status}`, 'EXECUTION_ERROR', {
            runStatus,
          });

        default:
          await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      turn += 1;
    }

    throw new SwarmError('Max turns reached', 'EXECUTION_ERROR');
  }

  /**
   * Create a message specifying the agent role
   */
  private buildAgentMessage(agentName: string, message: string): string {
    return `Acting as: ${agentName}\n\n${message}`;
  }

  /**
   * Execute a one-shot interaction
   */
  async run(agentName: string, goal: string): Promise<string> {
    if (!this.swarmAssistant)
      throw new SwarmError('Assistant not initialized', 'INITIALIZATION_ERROR');
    if (!this.swarmAssistant.agents.has(agentName)) {
      throw new SwarmError(`Agent ${agentName} not found`, 'AGENT_ERROR');
    }

    try {
      const thread = await this.client.beta.threads.create();
      await this.client.beta.threads.messages.create(thread.id, {
        role: 'user',
        content: this.buildAgentMessage(agentName, goal),
      });

      const run = await this.client.beta.threads.runs.create(thread.id, {
        assistant_id: this.swarmAssistant.assistant.id,
      });

      const result = await this.executeRun(thread, run, agentName);

      // Clean up
      await this.client.beta.threads.del(thread.id);

      return result;
    } catch (error) {
      throw new SwarmError('Failed to execute run', 'EXECUTION_ERROR', {
        error,
      });
    }
  }

  /**
   * Create a new session
   */
  async createSession(agentName: string): Promise<Flow> {
    if (!this.swarmAssistant)
      throw new SwarmError('Assistant not initialized', 'INITIALIZATION_ERROR');
    if (!this.swarmAssistant.agents.has(agentName)) {
      throw new SwarmError(`Agent ${agentName} not found`, 'AGENT_ERROR');
    }

    try {
      const thread = await this.client.beta.threads.create();

      const flow: FlowData = {
        id: crypto.randomUUID(),
        threadId: thread.id,
        agentName,
        nodeResults: {},
        createdAt: new Date(),
      };

      this.flows.set(flow.id, flow);
      return flow;
    } catch (error) {
      throw new SwarmError('Failed to create session', 'EXECUTION_ERROR', {
        error,
      });
    }
  }

  /**
   * Continue an existing session
   */
  async runSession(
    flowId: string,
    userInput: string,
    options: { script?: string; continueFromPrevious?: boolean } = {}
  ): Promise<string> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new SwarmError(`Flow ${flowId} not found`, 'INVALID_FLOW');

    if (options && !options.script) {
      const agents = Array.from(this.swarmAssistant!.agents.values())
        .map((agent) => JSON.stringify(agent))
        .join(', ');
      const tools = Array.from(this.swarmAssistant!.tools.values())
        .map((tool) => JSON.stringify(tool))
        .join(', ');
      const toolsAllowedForAgents = Array.from(
        this.swarmAssistant!.agents.values()
      )
        .map((agent) => `${agent.name}: [${agent.allowedTools.join(', ')}]`)
        .join(', ');
      const prompt = PLANNING_PROMPT.replace('{goal}', userInput)
        .replace('{agents}', agents)
        .replace('{tools}', tools)
        .replace('{toolsAllowedForAgents}', toolsAllowedForAgents);
      console.log('prompt:', prompt);
      const model = this.config.planningModel || DEFAULT_PLANNING_MODEL;
      const temperature = model === 'o1-mini' ? 1 : 0;
      const response = await this.client.chat.completions.create({
        temperature,
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      const scriptContent = response.choices[0].message.content;
      if (!scriptContent) {
        throw new SwarmError(
          'Failed to generate script from input',
          'EXECUTION_ERROR'
        );
      }
      options.script = scriptContent;
      console.log('options.script:', options.script);
    }

    let message = userInput;
    if (options?.script) {
      message = `${userInput}\n\nExecute this script:\n${options.script}`;
      this.config.script = options.script;
    }
    console.log('message:', message);
    await this.client.beta.threads.messages.create(flow.threadId, {
      role: 'user',
      content: this.buildAgentMessage(flow.agentName, message),
    });

    const run = await this.client.beta.threads.runs.create(flow.threadId, {
      assistant_id: this.swarmAssistant!.assistant.id,
    });

    const result = await this.executeRun(
      { id: flow.threadId } as OpenAI.Beta.Thread,
      run,
      flow.agentName
    );

    // Update agent if switched
    const switchMatch = result.match(/AGENT_SWITCH.*?to":\s*"(\w+)"/);
    if (switchMatch) {
      flow.agentName = switchMatch[1];
    }

    return result;
  }

  /**
   * End a session
   */
  async endSession(flowId: string): Promise<void> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new SwarmError(`Flow ${flowId} not found`, 'INVALID_FLOW');

    try {
      await this.client.beta.threads.del(flow.threadId);
      this.flows.delete(flowId);
    } catch (error) {
      throw new SwarmError('Failed to delete thread', 'EXECUTION_ERROR', {
        error,
      });
    }
  }

  /**
   * Get session status
   */
  async getStatus(flowId: string): Promise<Flow> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new SwarmError(`Flow ${flowId} not found`, 'INVALID_FLOW');
    return flow;
  }

  /**
   * Run multiple sessions in parallel
   */
  async runBatch(
    runs: Array<{ agentName: string; goal: string; script?: string }>,
    options?: {
      batchSize?: number;
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<Array<{ id: string; result: string; error?: Error }>> {
    const batchSize = options?.batchSize || 10;
    const concurrency = options?.concurrency || 5;
    const results: Array<{ id: string; result: string; error?: Error }> = [];

    for (let i = 0; i < runs.length; i += batchSize) {
      const batch = runs.slice(i, i + batchSize);
      const batchPromises = batch.map(async (run) => {
        try {
          const flow = await this.createSession(run.agentName);
          const result = await this.runSession(flow.id, run.goal, {
            script: run.script,
          });
          await this.endSession(flow.id);

          return { id: flow.id, result };
        } catch (error) {
          return {
            id: `batch_${i}_error`,
            result: '',
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      });

      // Process batch with concurrency limit
      const batchResults = await Promise.all(
        batchPromises
          .reduce(
            (acc, promise) => {
              const lastBatch = acc[acc.length - 1];
              if (lastBatch.length < concurrency) {
                lastBatch.push(promise);
              } else {
                acc.push([promise]);
              }
              return acc;
            },
            [[]] as Promise<{ id: string; result: string; error?: Error }>[][]
          )
          .map((batch) => Promise.all(batch))
      );

      results.push(...batchResults.flat());

      if (options?.onProgress) {
        options.onProgress(Math.min(i + batchSize, runs.length), runs.length);
      }
    }

    return results;
  }
}
