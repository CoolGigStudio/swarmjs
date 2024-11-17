import 'dotenv/config';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { Swarm } from '../core/swarm';
import { Agent } from '../core/types';
import OpenAI from 'openai';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function processAndPrintStreamingResponse(response: AsyncGenerator<any, void, unknown>) {
  let content = '';
  let lastSender = '';

  for await (const chunk of response) {
    if ('sender' in chunk) {
      lastSender = chunk.sender;
    }

    if ('content' in chunk && chunk.content !== null) {
      if (!content && lastSender) {
        process.stdout.write(chalk.blue(`${lastSender}: `));
        lastSender = '';
      }
      process.stdout.write(chunk.content);
      content += chunk.content;
    }

    if ('toolCalls' in chunk && chunk.toolCalls) {
      for (const toolCall of chunk.toolCalls) {
        const name = toolCall.function?.name;
        if (!name) continue;
        console.log(chalk.magenta(`\n${lastSender}: ${name}()`));
      }
    }

    if ('delim' in chunk && chunk.delim === 'end' && content) {
      console.log(); // New line at end of response
      content = '';
    }
  }
}

async function runDemoLoop() {
  // Initialize OpenAI client
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Create a swarm instance
  const swarm = new Swarm(client);

  async function greet(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

  // Create a basic agent
  const agent: Agent = {
    name: 'Assistant',
    model: 'gpt-4o-mini',
    instructions: 'You are a helpful assistant.',
    functions: [greet],
    toolChoice: null,
    parallelToolCalls: true,
  };

  console.log(chalk.green('Starting SwarmJS CLI 🐝'));
  console.log(chalk.gray('Type your messages and press Enter. Press Ctrl+C to exit.\n'));

  const messages: any[] = [];

  while (true) {
    const userInput = await new Promise<string>((resolve) => {
      rl.question(chalk.gray('User: '), resolve);
    });

    if (userInput.trim().includes('quit!')) {
        console.log(chalk.yellow('\nGoodbye! 👋'));
        rl.close();
        process.exit(1);
    }
    messages.push({ role: 'user', content: userInput });

    const response = await swarm.run(
      agent,
      messages,
      {},  // context variables
      null, // model override
      true, // stream
      false // debug
    );

    if (Symbol.asyncIterator in Object(response)) {
      await processAndPrintStreamingResponse(response as AsyncGenerator<any, void, unknown>);
    }
  }
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log(chalk.yellow('\nGoodbye! 👋'));
  rl.close();
  process.exit(0);
});

// Run the REPL
runDemoLoop().catch((error) => {
  console.error(chalk.red('Error:'), error);
  process.exit(1);
});