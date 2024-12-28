// greeting-agents.ts
import * as crypto from 'crypto';
import { SwarmEngine } from '../core/SwarmEngine';
import { ProviderType, AgentConfig, Message } from '../core/types';
import { LocalMemoryBackend, MemoryManager } from '../core/memory';

// Define tool functions
const tools = {
    getTime: {
        name: 'getTime',
        description: 'Get the current time',
        handler: async () => {
            const date = new Date();
            date.setFullYear(date.getFullYear() - 1); // Subtract 1 year
            date.setHours(date.getHours() - 6); // Subtract 6 hours
            return date.toISOString();
        },
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    createGreeting: {
        name: 'createGreeting',
        description: 'Create a greeting message using name and time',
        handler: async (args: { name: string; givenTime: string }) => {
            const { name, givenTime } = args;
            const hour = new Date(givenTime).getHours();
            let timeOfDay = 'morning';
            if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
            if (hour >= 17) timeOfDay = 'evening';
            return `Good Jolly ${timeOfDay}, ${name}! It's currently ${givenTime}.`;
        },
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The name of the person to greet'
                },
                givenTime: {
                    type: 'string',
                    description: 'The time to use in the greeting'
                }
            },
            required: ['name', 'givenTime']
        }
    }
};

// Define single agent configuration
const greetingAgentConfig: AgentConfig = {
    name: 'greeter',
    instructions: `You are a friendly greeting assistant that creates personalized greetings.
    To create a greeting:
    1. First, get the current time using the getTime tool
    2. Then, use the createGreeting tool with the person's name and the time
    Always maintain a cheerful and welcoming tone.`,
    tools: [tools.getTime, tools.createGreeting],
    model: 'gpt-4o',
    provider_type: ProviderType.OPENAI_CHAT
};

async function main() {
    try {
        // Initialize SwarmEngine
        const engine = new SwarmEngine(
            ProviderType.OPENAI_CHAT,
            {
                apiKey: process.env.OPENAI_API_KEY 
            },
            new MemoryManager(new LocalMemoryBackend())
        );

        // Initialize engine and register agent
        await engine.initialize();
        engine.registerAgent(greetingAgentConfig);

        // Register tools
        engine.registerTool(tools.getTime.name, tools.getTime.handler);
        engine.registerTool(tools.createGreeting.name, tools.createGreeting.handler);

        // Create initial message
        const initialMessage: Message = {
            role: 'user',
            content: 'Create a personalized greeting for John Doe.'
        };

        // Run the greeting agent
        const result = await engine.taskHandler.handleTask(
            crypto.randomUUID(),
            {
                agent_config: greetingAgentConfig,
                messages: [initialMessage]
            }
        );

        console.log('Result:', JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the example
async function runGreetingExample() {
    await main();
}

runGreetingExample();