// engines/AssistantEngine.ts
import { 
    Message, 
    Tool, 
    ToolCall, 
    Response, 
    Result, 
    StreamChunk, 
    EngineConfig,
    AssistantConfig, 
    Goal
  } from './types-old';
  import { BaseEngine } from './BaseEngine';
  import BaseAgent from './BaseAgent';
  import OpenAI from 'openai';
  import fs from 'fs/promises';
  import path from 'path';
import BaseSwarm from './BaseSwarm';
  
  interface AssistantToolDefinition {
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }
  
  interface StoredMessage {
    role: string;
    run_id: string;
    assistant_id: string;
    thread_id: string;
    created_at: number;
    content: string;
  }
  
  export class AssistantEngine extends BaseEngine {
    private client: OpenAI;
    private thread: any;
    private assistants: Map<string, any>;
    private toolDefinitions: Map<string, AssistantToolDefinition>;
    private conversationHistory: StoredMessage[];
  
    constructor(
      client: OpenAI,
      config: EngineConfig = {}
    ) {
      super(config);
      this.client = client;
      this.assistants = new Map();
      this.toolDefinitions = new Map();
      this.conversationHistory = [];
    }
  
    async initialize(): Promise<void> {
      await this.loadToolDefinitions();
      await this.createThread();
    }
  
    async executeAgent(
        agent: BaseAgent,
        goal: Goal,
        messages: Message[] = []
      ): Promise<Response> {
        await this.resetThread();
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
    
      async *streamAgent(): AsyncGenerator<StreamChunk> {
        throw new Error('Streaming is not supported with Assistant API');
      }
    
      async *streamSwarm(): AsyncGenerator<StreamChunk> {
        throw new Error('Streaming is not supported with Assistant API');
      }
    8613014

    private async createThread(): Promise<void> {
      this.thread = await this.client.beta.threads.create();
      this.debugPrint('Created thread:', this.thread.id);
    }
  
    private async resetThread(): Promise<void> {
      await this.createThread();
    }
  
    private async loadToolDefinitions(): Promise<void> {
      const toolsBasePath = 'tools';
      
      try {
        const toolDirs = await fs.readdir(toolsBasePath);
        
        for (const toolDir of toolDirs) {
          if (toolDir === '__pycache__') continue;
          
          const toolPath = path.join(toolsBasePath, toolDir, 'tool.json');
          try {
            const toolContent = await fs.readFile(toolPath, 'utf-8');
            const toolDef = JSON.parse(toolContent);
            this.toolDefinitions.set(toolDef.function.name, toolDef);
          } catch (error) {
            this.debugPrint(`Error loading tool definition from ${toolPath}:`, error);
          }
        }
      } catch (error) {
        this.debugPrint('Error loading tool definitions:', error);
      }
    }
  
    async loadAssistant(config: AssistantConfig): Promise<void> {
      const assistantTools = config.tools
        .map(toolName => this.toolDefinitions.get(toolName))
        .filter(tool => tool) as AssistantToolDefinition[];
  
      let assistant;
      try {
        // Check if assistant already exists
        const assistants = await this.client.beta.assistants.list();
        assistant = assistants.data.find(a => a.name === config.name);
  
        if (assistant) {
          // Update existing assistant
          assistant = await this.client.beta.assistants.update(assistant.id, {
            name: config.name,
            instructions: typeof config.instructions === 'function' 
              ? config.instructions(this.contextVariables)
              : config.instructions,
            tools: assistantTools,
            model: config.model
          });
        } else {
          // Create new assistant
          assistant = await this.client.beta.assistants.create({
            name: config.name,
            instructions: typeof config.instructions === 'function' 
              ? config.instructions(this.contextVariables)
              : config.instructions,
            tools: assistantTools,
            model: config.model
          });
        }
  
        this.assistants.set(config.name, assistant);
        this.debugPrint(`Assistant ${config.name} ${assistant ? 'updated' : 'created'}`);
      } catch (error) {
        this.debugPrint(`Error loading assistant ${config.name}:`, error);
        throw error;
      }
    }
  
    async createCompletion(
      agent: BaseAgent,
      messages: Message[],
      tools?: Tool[]
    ): Promise<any> {
      const assistant = this.assistants.get(agent.name);
      if (!assistant) {
        throw new Error(`No assistant found for agent: ${agent.name}`);
      }
  
      // Add message to thread
      const lastMessage = messages[messages.length - 1];
      await this.client.beta.threads.messages.create({
        thread_id: this.thread.id,
        role: "user",
        content: lastMessage.content
      });
  
      // Create and start the run
      const run = await this.client.beta.threads.runs.create({
        thread_id: this.thread.id,
        assistant_id: assistant.id
      });
  
      return this.monitorRun(run.id);
    }
  
    private async monitorRun(runId: string): Promise<any> {
      while (true) {
        const run = await this.client.beta.threads.runs.retrieve(
          this.thread.id,
          runId
        );
  
        switch (run.status) {
          case 'completed':
            return await this.client.beta.threads.messages.list(this.thread.id);
  
          case 'requires_action':
            await this.handleToolCalls(run.required_action.tool_calls, null);
            continue;
  
          case 'failed':
            throw new Error(`Run failed: ${run.last_error}`);
  
          case 'expired':
            throw new Error('Run expired');
  
          default:
            if (!this.testMode) {
              this.debugPrint('Waiting for run completion...');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  
    async handleToolCall(toolCall: any, agent: BaseAgent | null): Promise<Result> {
      const toolName = toolCall.function.name;
      const toolDir = path.join(process.cwd(), 'tools', toolName);
      const handlerPath = path.join(toolDir, 'handler.ts');
  
      try {
        // Dynamically import tool handler
        const toolModule = await import(handlerPath);
        const toolHandler = toolModule[`${toolName}_assistants`];
  
        const args = JSON.parse(toolCall.function.arguments);
        const handlerArgs = {
          tool_id: toolCall.id,
          ...args
        };
  
        this.debugPrint(`Running tool: ${toolName}`, handlerArgs);
        const result = await toolHandler(handlerArgs);
  
        await this.client.beta.threads.runs.submitToolOutputs(
          this.thread.id,
          toolCall.run_id,
          {
            tool_outputs: [{
              tool_call_id: toolCall.id,
              output: JSON.stringify({ result })
            }]
          }
        );
  
        return { value: JSON.stringify(result) };
      } catch (error) {
        this.debugPrint(`Error handling tool call: ${error}`);
        throw error;
      }
    }
  
    async handleToolCalls(
      toolCalls: ToolCall[],
      agent: BaseAgent | null
    ): Promise<Response> {
      const response: Response = {
        messages: [],
        agent: null,
        contextVariables: {}
      };
  
      for (const toolCall of toolCalls) {
        const result = await this.handleToolCall(toolCall, agent);
        
        response.messages.push({
          role: 'tool',
          content: result.value,
          sender: agent?.name
        });
  
        if (result.contextVariables) {
          response.contextVariables = {
            ...response.contextVariables,
            ...result.contextVariables
          };
        }
      }
  
      return response;
    }
  
    async run(
      agent: BaseAgent,
      messages: Message[]
    ): Promise<Response> {
      await this.resetThread();
  
      const completion = await this.createCompletion(
        agent,
        messages,
        agent.getTools()
      );
  
      const responseMessage = completion.data[0];
      
      // Store conversation history
      this.conversationHistory.push({
        role: responseMessage.role,
        run_id: responseMessage.run_id,
        assistant_id: responseMessage.assistant_id,
        thread_id: responseMessage.thread_id,
        created_at: responseMessage.created_at,
        content: responseMessage.content[0].text.value
      });
  
      return {
        messages: [{
          role: 'assistant',
          content: responseMessage.content[0].text.value,
          sender: agent.name
        }],
        agent,
        contextVariables: this.contextVariables
      };
    }
  
    async *runAndStream(
      agent: BaseAgent,
      messages: Message[]
    ): AsyncGenerator<StreamChunk> {
      // Assistant API doesn't support true streaming
      // Simulate streaming with the full response
      const response = await this.run(agent, messages);
      
      yield { delim: 'start' };
      
      const content = response.messages[0].content;
      // Simulate streaming by breaking content into chunks
      const chunks = content.match(/.{1,20}/g) || [];
      for (const chunk of chunks) {
        yield { content: chunk, sender: agent.name };
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      yield { delim: 'end' };
      yield { response };
    }
  
    async storeConversation(filename: string = 'threads/thread_data.json'): Promise<void> {
      try {
        let existingThreads: StoredMessage[][] = [];
        try {
          const content = await fs.readFile(filename, 'utf-8');
          existingThreads = JSON.parse(content);
        } catch (error) {
          // File doesn't exist or is empty
        }
  
        existingThreads.push(this.conversationHistory);
  
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, JSON.stringify(existingThreads, null, 2));
      } catch (error) {
        this.debugPrint('Error storing conversation:', error);
      }
    }
  }