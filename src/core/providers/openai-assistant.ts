import OpenAI from 'openai';
import { Message, AgentConfig, ToolDefinition } from '../types';
import { BaseProvider } from './base';

export class OpenAIAssistantProvider implements BaseProvider {
    private client!: OpenAI;
    private assistants: Map<string, string> = new Map();

    async initialize(config: Record<string, any>): Promise<void> {
        this.client = new OpenAI({
            apiKey: config.apiKey
        });
    }

    async getCompletion(
        messages: Message[],
        tools: ToolDefinition[],
        config: AgentConfig
    ): Promise<Message[]> {
        try {
            // Get or create assistant
            let assistantId = this.assistants.get(config.name);
            if (!assistantId) {
                const assistant = await this.client.beta.assistants.create({
                    name: config.name,
                    instructions: config.instructions,
                    model: config.model,
                    tools: tools.map(tool => ({
                        type: 'function',
                        function: {
                            name: tool.name,
                            description: tool.description,
                            parameters: tool.parameters
                        }
                    }))
                });
                assistantId = assistant.id;
                this.assistants.set(config.name, assistantId);
            }

            // Create thread
            const thread = await this.client.beta.threads.create();

            // Add messages to thread
            for (const msg of messages) {
                await this.client.beta.threads.messages.create(
                    thread.id,
                    {
                        role: msg.role as any,
                        content: msg.content
                    }
                );
            }

            // Run assistant
            const run = await this.client.beta.threads.runs.create(
                thread.id,
                {
                    assistant_id: assistantId
                }
            );

            // Wait for completion
            const response = await this.waitForCompletion(thread.id, run.id);
            
            // Convert to standard Message format
            return response.map(msg => ({
                role: msg.role as 'assistant' | 'user',
                content: msg.content[0].text.value,
                tool_calls: msg.tool_calls?.map(tool => ({
                    id: tool.id,
                    name: tool.function.name,
                    arguments: JSON.parse(tool.function.arguments)
                }))
            }));

        } catch (error) {
            console.error('OpenAI Assistant API Error:', error);
            throw new Error(`OpenAI Assistant API error: ${error}`);
        }
    }

    private async waitForCompletion(threadId: string, runId: string): Promise<OpenAI.Beta.Threads.Messages> {
        let status: string;
        do {
            const run = await this.client.beta.threads.runs.retrieve(
                threadId,
                runId
            );
            status = run.status;

            if (status === 'failed') {
                throw new Error('Assistant run failed');
            }

            if (status !== 'completed') {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } while (status !== 'completed');

        // Get messages
        const messages = await this.client.beta.threads.messages.list(threadId);
        return messages;
    }
}