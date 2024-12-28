import OpenAI from 'openai';
import { Message, AgentConfig, ToolDefinition, AgentTransition, CompletionResult } from '../types';
import { BaseProvider } from './base';

export class OpenAIChatProvider implements BaseProvider {
    private client!: OpenAI;

    async initialize(config: Record<string, any>): Promise<void> {
        this.client = new OpenAI({
            apiKey: config.apiKey
        });
    }

    async getCompletion(
        messages: Message[],
        tools: ToolDefinition[],
        config: AgentConfig
    ): Promise<CompletionResult> {
        if (!this.client) {
            throw new Error('OpenAIChatProvider not initialized');
        }

        // Format tools
        const formattedTools = tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));

        try {
            // Convert internal message format to OpenAI format
            const formattedMessages = messages.map(msg => {
                if (msg.tool_calls) {
                    return {
                        ...msg,
                        tool_calls: msg.tool_calls.map(tool => ({
                            id: tool.id,
                            type: 'function',
                            function: {
                                name: tool.function.name,
                                arguments: JSON.stringify(tool.function.arguments)
                            }
                        }))
                    };
                }
                // Include tool result messages with their original tool_call_id
                if (msg.role === 'tool' && msg.tool_call_id) {
                    return {
                        role: msg.role,
                        content: msg.content,
                        tool_call_id: msg.tool_call_id
                    };
                }
                return msg;
            });

            const response = await this.client.chat.completions.create({
                model: config.model,
                messages: formattedMessages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                tools: formattedTools,
                tool_choice: 'auto'
            });

            const choice = response.choices[0];
            
            const toolCalls = choice.message.tool_calls?.map(tool => ({
                id: tool.id,  // Preserve OpenAI's tool_call_id
                type: 'function',
                function: {
                    name: tool.function.name,
                    arguments: JSON.parse(tool.function.arguments)
                }
            }));

            const message: Message = {
                role: 'assistant',
                content: choice.message.content ,
                tool_calls: toolCalls
            };

            const transition = this.checkForTransition(message.content);
            const isComplete = !message.tool_calls || transition !== null;

            return {
                messages: [message],
                isComplete,
                transition: transition || undefined
            };
        } catch (error) {
            console.error('OpenAI Chat API Error:', error);
            throw new Error(`OpenAI Chat API error: ${error}`);
        }
    }

    private checkForTransition(content: string): AgentTransition | null {
        try {
            const parsed = JSON.parse(content);
            if (parsed && parsed.to_agent) {
                return {
                    to_agent: parsed.to_agent,
                    payload: parsed.payload || {},
                    preserve_memory: parsed.preserve_memory ?? true,
                    preserve_context: parsed.preserve_context ?? true
                };
            }
        } catch {
            // Not a JSON or not a transition
        }
        return null;
    }
}
