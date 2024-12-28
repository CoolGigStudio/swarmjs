import { BaseProvider, OpenAIChatProvider } from "./providers";
import { AgentConfig, TaskResult, Message, ProviderType, AgentTransition} from "./types";
import { DirectTaskHandler, TaskHandler } from "./task-handler";
import { MemoryManager } from "./memory/manager";
import { Memory } from "./memory";
import * as crypto from 'crypto';

export class SwarmEngine {
    private provider: BaseProvider;
    private toolRegistry: Map<string, (...args: any[]) => Promise<any>>;
    private agentRegistry: Map<string, AgentConfig>;
    private agentContexts: Map<string, Record<string, any>>;

    constructor(
        private provider_type: ProviderType,
        private config: Record<string, any>,
        public memoryManager: MemoryManager,
        public taskHandler: TaskHandler = new DirectTaskHandler(this)
    ) {
        this.provider = this.getProvider(provider_type);
        this.toolRegistry = new Map();
        this.agentRegistry = new Map();
        this.agentContexts = new Map();
        this.taskHandler = taskHandler;
    }

    async initialize(): Promise<void> {
        await this.provider.initialize(this.config);
    }

    registerAgent(agent_config: AgentConfig): void {
        this.agentRegistry.set(agent_config.name, agent_config);
        this.agentContexts.set(agent_config.name, {});
    }

    getAgentConfig(agent_name: string): AgentConfig | undefined {
        return this.agentRegistry.get(agent_name);
    }

    getAgentContext(agent_name: string): Record<string, any> {
        return this.agentContexts.get(agent_name) || {};
    }

    registerTool(name: string, func: (...args: any[]) => Promise<any>): void {
        this.toolRegistry.set(name, func);
    }

    async executeTool(tool_name: string, args: Record<string, any>): Promise<any> {
        const tool = this.toolRegistry.get(tool_name);
        if (!tool) {
            throw new Error(`Unknown tool: ${tool_name}`);
        }
        return tool(args);
    }

    async runAgent(
        agent_config: AgentConfig,
        messages: Message[]
    ): Promise<Message[]> {
        let currentMessages = messages;
        const allMessages: Message[] = [];
        
        while (true) {
            // Get relevant memories
            const memories = await this.memoryManager.getMemories(
                agent_config.name,
                'conversation',
                10
            );

            // Augment messages with memories
            const augmented_messages = this.augmentMessagesWithMemories(
                currentMessages, 
                memories
            );

            // Get completion from provider
            const completion = await this.provider.getCompletion(
                augmented_messages,
                agent_config.tools,
                agent_config
            );

            // Add completion messages to results
            allMessages.push(...completion.messages);

            // Handle tool calls if present
            const toolResults: Message[] = [];
            let hasToolCalls = false;

            for (const msg of completion.messages) {
                if (msg.tool_calls) {
                    hasToolCalls = true;
                    for (const tool_call of msg.tool_calls) {
                        const tool_result = await this.taskHandler.handleToolExecution(
                            tool_call.id,
                            {
                                tool_name: tool_call.function.name,
                                arguments: tool_call.function.arguments
                            }
                        );

                        const toolResultMessage: Message = {
                            role: 'tool',
                            content: String(tool_result.result),
                            tool_call_id: tool_call.id
                        };

                        toolResults.push(toolResultMessage);
                        allMessages.push(toolResultMessage);
                    }
                }
            }

            // Store conversation in memory
            for (const msg of [...completion.messages, ...toolResults]) {
                await this.memoryManager.addMemory(agent_config.name, {
                    content: msg,
                    timestamp: Date.now(),
                    source: 'conversation',
                    memory_type: 'conversation'
                });
            }

            // Check for completion or transition
            if (completion.isComplete) {
                if (completion.transition) {
                    // Handle transition...
                    const result = await this.taskHandler.handleTransition(
                        agent_config.name,
                        completion.transition
                    );
                    
                    const newAgent = this.getAgentConfig(completion.transition.to_agent);
                    if (!newAgent) {
                        throw new Error(`Unknown agent: ${completion.transition.to_agent}`);
                    }
                    agent_config = newAgent;
                    currentMessages = [{
                        role: 'user',
                        content: JSON.stringify(completion.transition.payload)
                    }];
                } else {
                    // Task complete
                    return allMessages;
                }
            } else if (hasToolCalls) {
                // Continue with tool results if there were tool calls
                currentMessages = toolResults;
            } else {
                // No tool calls, continue with completion messages
                currentMessages = completion.messages;
            }
        }
    }

    private getProvider(provider_type: ProviderType): BaseProvider {
        // Provider implementation will be in separate file
        switch (provider_type) {
            // case ProviderType.ANTHROPIC:
            //     return new AnthropicProvider();
            case ProviderType.OPENAI_CHAT:
                return new OpenAIChatProvider();
            // case ProviderType.OPENAI_ASSISTANT:
            //     return new OpenAIAssistantProvider();
            default:
                throw new Error(`Unknown provider type: ${provider_type}`);
        }
    }

    private augmentMessagesWithMemories(
        messages: Message[],
        memories: Memory[]
    ): Message[] {
        if (!memories.length) {
            return messages;
        }

        const memory_summary = "Previous context:\n" + 
            memories.map(memory => `- ${memory.content}`).join("\n");

        return [{
            role: 'system',
            content: memory_summary
        }, ...messages];
    }

    private checkForTransition(response: Message[]): AgentTransition | null {
        for (const msg of response) {
            try {
                const content = JSON.parse(msg.content);
                if (typeof content === 'object' && content?.to_agent) {
                    return {
                        to_agent: content.to_agent,
                        payload: content.payload || {},
                        preserve_memory: content.preserve_memory ?? true,
                        preserve_context: content.preserve_context ?? true
                    };
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    }
}