import { OpenAI } from 'openai';
import crypto from 'crypto';

import {
  Swarm,
  SwarmConfig,
  Flow,
  AgentConfig,
  ToolDefinition,
  SwarmError,
  ToolParameter,
} from '../types';
import { DEFAULT_ASSISTANT_MODEL, DEFAULT_PLANNING_MODEL } from './constants';
import { PLANNING_PROMPT } from './prompts';
import dagStorage from '../tools/DAGStorage';

// Support for OpenAI Responses API
interface ResponsesAPIConfig {
  builtInTools?: ('web_search' | 'file_search' | 'code_interpreter')[];
}

interface SwarmData {
  agents: Map<string, AgentConfig>;
  tools: Map<string, ToolDefinition>;
  responsesConfig?: ResponsesAPIConfig;
}

interface FlowData extends Flow {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

/**
 * GptSwarm implementation using OpenAI's Responses API
 * This is a clean implementation that only uses the new Responses API
 */
export class GptSwarm implements Swarm {
  private client!: OpenAI;
  private swarmData: SwarmData | null = null;
  private flows: Map<string, FlowData> = new Map();
  private config!: SwarmConfig;
  private max_turns: number = 30;

  /**
   * Initialize the GptSwarm using OpenAI's Responses API
   */
  async init(
    config: SwarmConfig & { responsesAPI?: ResponsesAPIConfig }
  ): Promise<void> {
    try {
      this.config = config;
      this.client = new OpenAI({ apiKey: config.apiKey });

      this.config.id = crypto.randomUUID();

      const agents = new Map(
        (config.agents || []).map((agent) => [agent.name, agent])
      );

      // Add built-in tools after agents are set up
      config.tools = this.addBuiltinTools(config.tools || [], agents.size);
      
      const toolsMap = new Map(
        config.tools.map((tool) => [tool.function.name, tool])
      );

      this.swarmData = {
        agents,
        tools: toolsMap,
        responsesConfig: config.responsesAPI,
      };
    } catch (error) {
      throw this.handleAPIError(error);
    }
  }

  /**
   * Add built-in tools including switchAgent (only when multiple agents exist)
   */
  private addBuiltinTools(tools: ToolDefinition[], agentCount: number): ToolDefinition[] {
    const result = [...tools];
    
    // Only add switchAgent if there are multiple agents
    if (agentCount > 1) {
      result.push({
        type: 'function' as const,
        function: {
          name: 'switchAgent',
          description: 'Switch to another agent',
          parameters: {
            type: 'object' as const,
            properties: {
              agentName: {
                type: 'string',
                description: 'Name of the agent to switch to',
              },
            },
            required: ['agentName'],
          },
        },
        handler: (params: Record<string, ToolParameter>) =>
          Promise.resolve({ type: 'AGENT_SWITCH', to: params.agentName }),
      });
    }
    
    return result;
  }

  /**
   * Build tools array for Responses API
   */
  private buildResponsesAPITools(
    tools: ToolDefinition[],
    builtInTools?: ('web_search' | 'file_search' | 'code_interpreter')[]
  ): Array<any> {
    const responsesTools: Array<any> = [];

    // Add custom function tools for Responses API format (excluding switchAgent for single-agent scenarios)
    tools.forEach(({ function: fn }) => {
      // Skip switchAgent if we only have one agent
      if (fn.name === 'switchAgent' && this.swarmData && this.swarmData.agents.size <= 1) {
        return;
      }
      
      responsesTools.push({
        type: 'function',
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      });
    });

    // Add OpenAI built-in tools
    if (builtInTools) {
      builtInTools.forEach((tool) => {
        responsesTools.push({ type: tool });
      });
    }

    return responsesTools;
  }

  /**
   * Build system message for a specific agent
   */
  private buildAgentSystemMessage(agent: AgentConfig): string {
    return `You are ${agent.name}: ${agent.description}

${agent.systemMessage}

Available tools: ${agent.allowedTools.join(', ')}, switchAgent

Important instructions:
1. Follow the provided script step by step
2. Use the tools available to you to complete each step
3. Execute tools in sequence, not in parallel
4. Provide clear output for each step`;
  }

  /**
   * Execute a complete agent workflow using iterative agent loop pattern
   */
  async runOnce(
    agentName: string,
    goal: string,
    options: { script?: string } = {}
  ): Promise<string> {
    if (!this.swarmData)
      throw new SwarmError('Swarm not initialized', 'INITIALIZATION_ERROR');
    if (!this.swarmData.agents.has(agentName)) {
      throw new SwarmError(`Agent ${agentName} not found`, 'AGENT_ERROR');
    }

    try {
      // Generate script if not provided
      let script = options.script;
      if (!script) {
        script = await this.generateScript(goal);
      }

      // Initialize conversation history for agent loop
      const conversationHistory: string[] = [];
      
      // Use iterative agent loop with Responses API
      const clientAny = this.client as any;
      if (!clientAny.responses || typeof clientAny.responses.create !== 'function') {
        throw new SwarmError('Responses API not available in current OpenAI SDK version', 'API_ERROR');
      }
      
      return await this.runResponsesAPIAgentLoop(
        agentName,
        goal,
        script,
        conversationHistory
      );
    } catch (error) {
      throw this.handleAPIError(error);
    }
  }

  /**
   * Iterative agent loop for Responses API (like OpenAI Agents SDK)
   */
  private async runResponsesAPIAgentLoop(
    initialAgent: string,
    goal: string,
    script: string,
    conversationHistory: string[]
  ): Promise<string> {
    if (!this.swarmData) {
      throw new SwarmError('Swarm not initialized', 'INITIALIZATION_ERROR');
    }

    const clientAny = this.client as any;
    let currentAgent = initialAgent;
    let turn = 0;
    
    console.log(`🔄 Starting multi-agent workflow with ${currentAgent} agent...`);
    
    while (turn < this.max_turns) {
      
      // Get current agent configuration
      const agent = this.swarmData.agents.get(currentAgent);
      if (!agent) {
        throw new SwarmError(`Agent ${currentAgent} not found`, 'AGENT_ERROR');
      }

      // Build tools available to current agent (including switchAgent if multiple agents)
      const tools = this.buildResponsesAPITools(
        [...this.swarmData.tools.values()],
        this.swarmData.responsesConfig?.builtInTools
      );

      // Build system message for current agent
      const systemMessage = this.buildAgentSystemMessage(agent);
      
      // Prepare input message with script and conversation history
      let message = goal;
      if (script) {
        message = `${goal}\n\nExecute this script:\n${script}`;
      }
      
      let currentInput = `${systemMessage}\n\nUser: ${message}`;
      
      // Add conversation history if available
      if (conversationHistory.length > 0) {
        currentInput += '\n\nExecution Progress:\n' + conversationHistory.join('\n');
        currentInput += '\n\nBased on the script provided and the execution progress above, determine what step should be executed next. If all steps are complete, provide the final result without calling more tools.';
      }
      
      
      const response = await clientAny.responses.create({
        model: this.config.model || DEFAULT_ASSISTANT_MODEL,
        input: currentInput,
        tools: tools.length > 0 ? tools : undefined,
        temperature: this.config.temperature || 0.7,
        max_output_tokens: 4000,
      });
      
      
      // Check if we have function calls to process
      if (response.output && Array.isArray(response.output) && response.output.length > 0) {
        const functionCalls = response.output.filter(
          (item: any) => item.type === 'function_call' && item.status === 'completed'
        );
        
        if (functionCalls.length > 0) {
          
          // Execute all function calls and collect results
          let agentSwitched = false;
          for (const functionCall of functionCalls) {
            
            try {
              const args = JSON.parse(functionCall.arguments);
              
              // Handle switchAgent specially
              if (functionCall.name === 'switchAgent') {
                const targetAgent = args.agentName;
                console.log(`\n🔄 AGENT SWITCH: ${currentAgent} → ${targetAgent}`);
                console.log(`   Previous agent: ${currentAgent}`);
                console.log(`   New agent: ${targetAgent}`);
                
                if (!this.swarmData.agents.has(targetAgent)) {
                  throw new SwarmError(`Target agent ${targetAgent} not found`, 'AGENT_ERROR');
                }
                
                // Add switch to conversation history
                conversationHistory.push(`Agent Switch: ${currentAgent} → ${targetAgent}`);
                
                // Switch to new agent
                currentAgent = targetAgent;
                agentSwitched = true;
                console.log(`✅ Agent switch completed - now using ${currentAgent} agent\n`);
                break; // Continue with new agent in next iteration
              } else {
                // Handle regular tools
                const result = await this.executeResponsesAPITool(functionCall.name, args, currentAgent);
                
                // Add to conversation history
                conversationHistory.push(`Tool Call: ${functionCall.name}(${JSON.stringify(args)})`);
                conversationHistory.push(`Tool Result: ${result}`);
              }
              
            } catch (error) {
              console.error(`Error executing function ${functionCall.name}:`, error);
              const errorMsg = `${functionCall.name}: Error - ${error}`;
              conversationHistory.push(`Tool Error: ${errorMsg}`);
            }
          }
          
          // If agent switched, continue with new agent
          if (agentSwitched) {
            turn++;
            continue;
          }
          
          // Handle web search calls (built-in tools)
          const webSearchCalls = response.output.filter(
            (item: any) => item.type === 'web_search_call' && item.status === 'completed'
          );
          
          if (webSearchCalls.length > 0) {
            for (const webCall of webSearchCalls) {
              const query = webCall.action?.query || 'query not specified';
              conversationHistory.push(`Web Search: ${query}`);
            }
          }
          
          // Check if we've completed all DAG steps
          const completedSteps = this.analyzeDAGCompletion(conversationHistory, message);
          
          console.log(`📋 DAG Progress: ${Array.from(completedSteps.completedSteps).length}/${completedSteps.requiredSteps.length} steps completed`);
          console.log(`   Required: [${completedSteps.requiredSteps.join(', ')}]`);
          console.log(`   Completed: [${Array.from(completedSteps.completedSteps).join(', ')}]`);
          
          if (completedSteps.isComplete) {
            console.log('✅ Multi-agent workflow completed successfully');
            return completedSteps.finalResult;
          }
          
          turn++;
          continue;
        }
      }
      
      // No function calls - check for final output
      let finalOutput = '';
      
      // Check for direct text output
      if (response.output_text) {
        finalOutput = response.output_text;
      }
      
      // Check for message content in output
      if (response.output && Array.isArray(response.output)) {
        const messageOutputs = response.output.filter((item: any) => item.type === 'message');
        if (messageOutputs.length > 0) {
          const messageContents = messageOutputs.map((msg: any) => {
            if (msg.content && Array.isArray(msg.content)) {
              return msg.content
                .filter((part: any) => part.type === 'output_text')
                .map((part: any) => part.text)
                .join('\n');
            }
            return msg.content || '';
          }).filter((content: string) => content);
          
          if (messageContents.length > 0) {
            finalOutput = finalOutput ? `${finalOutput}\n${messageContents.join('\n')}` : messageContents.join('\n');
          }
        }
      }
      
      // Fallback to traditional response format
      if (!finalOutput && response.choices && response.choices[0]) {
        finalOutput = response.choices[0].message?.content || '';
      }
      
      // If we have final output and conversation history, combine them
      if (finalOutput && conversationHistory.length > 0) {
        const lastToolResult = conversationHistory[conversationHistory.length - 1];
        if (lastToolResult.startsWith('Tool Result:')) {
          return lastToolResult.replace('Tool Result: ', '');
        }
      }
      
      // Return final output if available
      if (finalOutput) {
        console.log('✅ Multi-agent workflow completed');
        return finalOutput;
      }
      
      // No function calls and no final output - something went wrong
      break;
    }
    
    if (turn >= this.max_turns) {
      throw new SwarmError('Agent loop reached maximum turns without completion', 'EXECUTION_ERROR');
    }
    
    // Return conversation history if no explicit final output
    return conversationHistory.length > 0 
      ? conversationHistory[conversationHistory.length - 1].replace('Tool Result: ', '')
      : 'Agent loop completed but no final output was generated.';
  }

  /**
   * Analyze conversation history to determine if DAG execution is complete
   */
  private analyzeDAGCompletion(conversationHistory: string[], initialMessage: string): { isComplete: boolean; finalResult: string; completedSteps: Set<string>; requiredSteps: string[] } {
    // Extract the script from the initial message
    const scriptMatch = initialMessage.match(/Execute this script:\s*([\s\S]*?)$/);
    if (!scriptMatch) {
      console.log('❌ No script found in initial message');
      return { isComplete: false, finalResult: '', completedSteps: new Set(), requiredSteps: [] };
    }
    
    const script = scriptMatch[1].trim();
    const scriptLines = script.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//') && !line.startsWith('#'));
    
    // Parse DAG steps from script
    const dagSteps: { [key: string]: string } = {};
    const stepOrder: string[] = [];
    
    for (const line of scriptLines) {
      const match = line.match(/(\$\d+)\s*=\s*(.+)/);
      if (match) {
        const [, variable, operation] = match;
        dagSteps[variable] = operation;
        stepOrder.push(variable);
      }
    }
    
    
    // Check which steps have been completed based on conversation history
    const completedSteps = new Set<string>();
    const stepResults: { [key: string]: string } = {};
    
    for (let i = 0; i < conversationHistory.length; i++) {
      const historyEntry = conversationHistory[i];
      
      // Handle regular tool calls
      if (historyEntry.startsWith('Tool Call:')) {
        const toolResult = conversationHistory[i + 1];
        if (toolResult && toolResult.startsWith('Tool Result:')) {
          const toolName = historyEntry.match(/Tool Call: (\w+)/)?.[1];
          const result = toolResult.replace('Tool Result: ', '');
          
          // Match tool calls to DAG steps
          for (const [step, operation] of Object.entries(dagSteps)) {
            if (operation.includes(toolName || '') && !completedSteps.has(step)) {
              completedSteps.add(step);
              stepResults[step] = result;
              break;
            }
          }
        }
      }
      
      // Handle agent switches
      if (historyEntry.startsWith('Agent Switch:')) {
        // Match agent switches to DAG steps with switchAgent
        for (const [step, operation] of Object.entries(dagSteps)) {
          if (operation.includes('switchAgent') && !completedSteps.has(step)) {
            completedSteps.add(step);
            stepResults[step] = historyEntry;
            break;
          }
        }
      }
    }
    
    // Check if all steps are complete (excluding finish() step)
    const requiredSteps = stepOrder.filter(step => !dagSteps[step].includes('finish()'));
    const allStepsComplete = requiredSteps.every(step => completedSteps.has(step));
    
    
    if (allStepsComplete) {
      // Return the result of the last non-finish step
      const lastStep = requiredSteps[requiredSteps.length - 1];
      const finalResult = stepResults[lastStep] || conversationHistory[conversationHistory.length - 1]?.replace('Tool Result: ', '') || '';
      
      return { isComplete: true, finalResult, completedSteps, requiredSteps };
    }
    
    return { isComplete: false, finalResult: '', completedSteps, requiredSteps };
  }

  /**
   * Handle function calls returned directly from Responses API
   */
  private async handleResponsesAPIFunctionCalls(
    functionCalls: any[]
  ): Promise<string> {
    const results: string[] = [];
    
    for (const functionCall of functionCalls) {
      console.log('Processing function call:', JSON.stringify(functionCall, null, 2));
      
      // Handle web_search_call format (new Responses API format)
      if (functionCall.type === 'web_search_call' && functionCall.status === 'completed') {
        // Web search results are handled in the message content, so we don't need to process them separately
        // Just log that the search was executed (this won't be shown to user due to debug filtering)
        console.log(`Web search executed: ${functionCall.action?.query || 'query not specified'}`);
      }
      // Handle traditional function_call format
      else if (functionCall.type === 'function_call' && functionCall.status === 'completed') {
        // For built-in tools like web_search, the result might be in the function call object itself
        if (['web_search', 'file_search', 'code_interpreter'].includes(functionCall.name)) {
          // Check if there's a result field in the function call
          if (functionCall.result) {
            results.push(`${functionCall.name}: ${functionCall.result}`);
          } else if (functionCall.output) {
            results.push(`${functionCall.name}: ${functionCall.output}`);
          } else {
            // The result might be embedded in the response structure
            results.push(`${functionCall.name}: Built-in tool executed (result may be in response text)`);
          }
        } else {
          // Handle custom tools
          try {
            const args = JSON.parse(functionCall.arguments);
            const result = await this.executeResponsesAPITool(functionCall.name, args);
            results.push(`${functionCall.name}: ${result}`);
          } catch (error) {
            console.error(`Error executing function ${functionCall.name}:`, error);
            results.push(`${functionCall.name}: Error - ${error}`);
          }
        }
      }
      // Handle message format (seems to be part of the Responses API)
      else if (functionCall.type === 'message') {
        if (functionCall.content && Array.isArray(functionCall.content)) {
          functionCall.content.forEach((contentPart: any) => {
            if (contentPart.type === 'output_text' && contentPart.text) {
              results.push(contentPart.text);
            }
          });
        } else if (functionCall.content) {
          results.push(functionCall.content);
        }
      }
    }
    
    return results.join('\n');
  }

  /**
   * Execute a tool for Responses API format
   */
  private async executeResponsesAPITool(toolName: string, args: any, currentAgent?: string): Promise<string> {
    if (!this.swarmData) {
      throw new SwarmError('Swarm not initialized', 'INITIALIZATION_ERROR');
    }

    // Handle built-in tools (these are executed by OpenAI, not by us)
    if (['web_search', 'file_search', 'code_interpreter'].includes(toolName)) {
      // Built-in tools are handled by OpenAI - we should not execute them locally
      // This should not happen in the Responses API workflow
      return `Built-in ${toolName} tool was executed by OpenAI`;
    }

    const tool = this.swarmData.tools.get(toolName);
    if (!tool) {
      throw new SwarmError(`Tool ${toolName} not found`, 'TOOL_ERROR');
    }

    // Verify tool access for agent if agent is specified
    if (currentAgent) {
      const agent = this.swarmData.agents.get(currentAgent);
      if (agent && !agent.allowedTools.includes(toolName) && toolName !== 'switchAgent') {
        throw new SwarmError(
          `Tool ${toolName} not allowed for agent ${currentAgent}`,
          'TOOL_ERROR'
        );
      }
    }

    try {
      const result = await tool.handler(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      throw new SwarmError(
        `Failed to execute tool ${toolName}`,
        'TOOL_ERROR',
        { error }
      );
    }
  }

  /**
   * Handle tool calls in Responses API format
   */
  private async handleToolCallsInResponse(
    toolCalls: any[],
    systemMessage: string,
    userMessage: string,
    tools: any[],
    currentAgent: string
  ): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ];

    let turn = 0;
    while (turn < this.max_turns) {
      // Execute all tool calls
      const toolResults = await Promise.all(
        toolCalls.map(async (toolCall: any) => {
          const result = await this.executeToolCall(toolCall, currentAgent);
          // console.log(`Tool ${toolCall.function.name} result:`, result); // Debug output
          return {
            tool_call_id: toolCall.id,
            role: 'tool' as const,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          };
        })
      );

      // Add tool results to conversation
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: toolCalls,
      });
      messages.push(...toolResults);

      // Get next response
      const response = await this.client.chat.completions.create({
        model: this.config.model || DEFAULT_ASSISTANT_MODEL,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: this.config.temperature || 0.7,
        max_tokens: 4000,
      });

      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage) break;

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        toolCalls = assistantMessage.tool_calls;
        turn++;
        continue;
      }

      return assistantMessage.content || '';
    }

    throw new SwarmError('Max turns reached', 'EXECUTION_ERROR');
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(toolCall: any, currentAgent: string): Promise<unknown> {
    if (!this.swarmData)
      throw new SwarmError('Swarm not initialized', 'INITIALIZATION_ERROR');

    const toolName = toolCall.function.name;
    
    // Handle built-in tools (these return actual results from OpenAI)
    if (['web_search', 'file_search', 'code_interpreter'].includes(toolName)) {
      // OpenAI handles these natively, the results come back in the response
      const args = JSON.parse(toolCall.function.arguments);
      return `OpenAI ${toolName} executed successfully with query: ${JSON.stringify(args)}`;
    }

    // Handle custom tools
    const tool = this.swarmData.tools.get(toolName);
    if (!tool) {
      throw new SwarmError(`Tool ${toolName} not found`, 'TOOL_ERROR');
    }

    // Verify tool access for agent
    const agent = this.swarmData.agents.get(currentAgent);
    if (agent && !agent.allowedTools.includes(toolName) && toolName !== 'switchAgent') {
      throw new SwarmError(
        `Tool ${toolName} not allowed for agent ${currentAgent}`,
        'TOOL_ERROR'
      );
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
      return await tool.handler(args);
    } catch (error) {
      throw new SwarmError(
        `Failed to execute tool ${toolName}`,
        'TOOL_ERROR',
        { error }
      );
    }
  }

  /**
   * Create a new session
   */
  async createSession(agentName: string): Promise<Flow> {
    if (!this.swarmData)
      throw new SwarmError('Swarm not initialized', 'INITIALIZATION_ERROR');
    if (!this.swarmData.agents.has(agentName)) {
      throw new SwarmError(`Agent ${agentName} not found`, 'AGENT_ERROR');
    }

    const flow: FlowData = {
      id: crypto.randomUUID(),
      messages: [],
      agentName,
      nodeResults: {},
      createdAt: new Date(),
    };

    this.flows.set(flow.id, flow);
    return flow;
  }

  /**
   * Continue running an existing session
   */
  async runSession(
    flowId: string,
    goal: string,
    options: { script?: string } = {}
  ): Promise<string> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new SwarmError(`Flow ${flowId} not found`, 'INVALID_FLOW');

    return await this.runOnce(flow.agentName, goal, options);
  }

  /**
   * End a session
   */
  async endSession(flowId: string): Promise<void> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new SwarmError(`Flow ${flowId} not found`, 'INVALID_FLOW');
    this.flows.delete(flowId);
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
   * Generate script using Responses API
   */
  public async generateScript(goal: string): Promise<string> {
    if (!this.swarmData)
      throw new SwarmError('Swarm not initialized', 'INITIALIZATION_ERROR');

    const agents = Array.from(this.swarmData.agents.values())
      .map((agent) => JSON.stringify(agent))
      .join(', ');
    const tools = Array.from(this.swarmData.tools.values())
      .map((tool) => JSON.stringify(tool))
      .join(', ');
    const toolsAllowedForAgents = Array.from(this.swarmData.agents.values())
      .map((agent) => `${agent.name}: [${agent.allowedTools.join(', ')}]`)
      .join(', ');
    
    const prompt = PLANNING_PROMPT.replace('{goal}', goal)
      .replace('{agents}', agents)
      .replace('{tools}', tools)
      .replace('{toolsAllowedForAgents}', toolsAllowedForAgents);

    const model = this.config.planningModel || DEFAULT_PLANNING_MODEL;
    const temperature = model === 'o1-mini' || model === 'o1' ? 1 : 0;
    
    const response = await this.client.chat.completions.create({
      temperature,
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
    });

    const scriptContent = response.choices[0].message.content;
    if (!scriptContent) {
      throw new SwarmError(
        'Failed to generate script from input',
        'EXECUTION_ERROR'
      );
    }

    if (this.config.options?.saveDags) {
      await dagStorage.saveDag({
        id: crypto.randomUUID(),
        script: scriptContent,
        metadata: {
          goal: goal,
          model,
          temperature,
          apiMode: 'responses',
        },
        timestamp: new Date().toISOString(),
      });
    }

    return scriptContent;
  }

  /**
   * Run multiple sessions in parallel
   */
  async runBatch(
    runs: Array<{ agentName: string; goal: string; script?: string }>
  ): Promise<Array<{ id: string; result: string; error?: Error }>> {
    const results: Array<{ id: string; result: string; error?: Error }> = [];

    for (const run of runs) {
      try {
        const result = await this.runOnce(run.agentName, run.goal, {
          script: run.script,
        });
        results.push({ id: crypto.randomUUID(), result });
      } catch (error) {
        results.push({
          id: crypto.randomUUID(),
          result: '',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return results;
  }

  /**
   * Enhanced error handling for API changes
   */
  private handleAPIError(error: any): SwarmError {
    if (error?.status === 429) {
      return new SwarmError('Rate limit exceeded', 'RATE_LIMIT_ERROR', { error });
    }
    if (error?.status === 400 && error?.error?.message?.includes('model')) {
      return new SwarmError('Invalid model specified', 'MODEL_ERROR', { error });
    }
    if (error?.status === 401) {
      return new SwarmError('Invalid API key', 'AUTHENTICATION_ERROR', { error });
    }
    
    return new SwarmError('API request failed', 'API_ERROR', { error });
  }

  /**
   * Get available built-in tools for current configuration
   */
  getAvailableBuiltInTools(): string[] {
    const tools = [];
    if (this.swarmData?.responsesConfig?.builtInTools) {
      tools.push(...this.swarmData.responsesConfig.builtInTools);
    }
    return tools;
  }

  /**
   * Check if using Responses API (always true for this implementation)
   */
  isUsingResponsesAPI(): boolean {
    return true;
  }
}