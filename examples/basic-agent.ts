import { Swarm, Agent } from '../src';
import OpenAI from 'openai';

async function main() {
  // Initialize OpenAI client with your API key
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Create a new swarm instance
  const swarm = new Swarm(client);

  // Define a simple function that the agent can use
  async function greet(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

  // Create an agent
  const agent: Agent = {
    name: 'Greeter',
    model: 'gpt-4',
    instructions: 'You are a friendly greeting agent.',
    functions: [greet],
    toolChoice: null,
    parallelToolCalls: true,
  };

  // Run a conversation
  const response = await swarm.run(
    agent,
    [{ role: 'user', content: 'Can you greet John?' }],
    {},
    null,
    false,
    true
  );

  console.log('Response:', response);
}

main().catch(console.error);