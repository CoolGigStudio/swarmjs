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

// Define agent configurations
const plannerConfig: AgentConfig = {
    name: 'planner',
    instructions: `You are a planning assistant that creates plans for greeting workflows.
    Your task is to plan the sequence of getting the current time and creating appropriate greetings.
    When you're done planning, create a transition to the executor agent with your plan.
    `,
    tools: [tools.getTime, tools.createGreeting],
    model: 'gpt-4o',
    provider_type: ProviderType.OPENAI_CHAT
};

const executorConfig: AgentConfig = {
    name: 'executor',
    instructions: `You are an execution assistant that follows plans for greeting workflows.
    Your task is to execute the plans by calling the appropriate tools in sequence.
    Ensure to use the results from previous tool calls when needed.
    `,
    tools: [tools.getTime, tools.createGreeting],
    model: 'gpt-4-o',
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

        // Initialize engine and register agents
        await engine.initialize();
        engine.registerAgent(plannerConfig);
        engine.registerAgent(executorConfig);

        // Register tools
        engine.registerTool(tools.getTime.name, tools.getTime.handler);
        engine.registerTool(tools.createGreeting.name, tools.createGreeting.handler);

        // Create initial message for planner
        const initialMessage: Message = {
            role: 'user',
            content: 'Create personalized greetings for John Doe.'
        };

        // Start with planner
        let result = await engine.taskHandler.handleTask(
            crypto.randomUUID(),
            {
                agent_config: plannerConfig,
                messages: [initialMessage]
            }
        );

        // Handle transitions until complete
        while (result.transition) {
            console.log('Transitioning to:', result.transition.to_agent);
            result = await engine.taskHandler.handleTransition(
                result.transition.to_agent,
                result.transition
            );
        }

        console.log('Final result:', result);

    } catch (error) {
        console.error('Error:', error);
    }
}

// Example usage with async/await
async function runGreetingExample() {
    await main();
}

runGreetingExample();