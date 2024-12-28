import Anthropic from '@anthropic-ai/sdk';
import { Message, AgentConfig, ToolDefinition } from '../types';
import { BaseProvider } from './base';

export class AnthropicProvider implements BaseProvider {
    private client!: Anthropic;

    async initialize(config: Record<string, any>): Promise<void> {
        this.client = new Anthropic({
            apiKey: config.apiKey
        });
    }

    async getCompletion(
        messages: Message[],
        tools: ToolDefinition[],
        config: AgentConfig
    ): Promise<Message> {
        // Convert messages to Anthropic format
        const formattedMessages = messages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
        }));

        // Format tools for Anthropic
        const formattedTools = tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));

        try {
            const response = await this.client.messages.create({
                model: config.model,
                max_tokens: 4096,
                messages: formattedMessages,
                tools: formattedTools,
            });

            // Convert Anthropic response to standard Message format
            return {
                role: 'assistant',
                content: response.content[0].text,
                tool_calls: response.tool_calls?.map(tool => ({
                    id: tool.id,
                    name: tool.function.name,
                    arguments: JSON.parse(tool.function.arguments)
                }))
            };
        } catch (error) {
            console.error('Anthropic API Error:', error);
            throw new Error(`Anthropic API error: ${error}`);
        }
    }
}