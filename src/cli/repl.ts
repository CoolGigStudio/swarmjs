import 'dotenv/config';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { Swarm } from '../core/swarm';
import { Agent, AgentFunction } from '../core/types';
import OpenAI from 'openai';

// Debug mode configuration
const DEBUG = process.env.DEBUG === 'true';

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

async function greet(names: string, time: string): Promise<string> {
  // if (!Array.isArray(names)) {
  //   names = [names]; // Convert single name to array if needed
  // }
  // // Limit array length and string lengths to avoid ID length issues
  // names = names.slice(0, 5).map(name => String(name).slice(0, 20));
  // return names.map(name => `Good ${time}, ${name}!`);
  return `Good ${time}, ${names}!`;
}

async function getTime(timeZone: string | { timeZone: string } = '+00:00'): Promise<string> {
  const date = new Date();
  let hour: number;
  
  // Handle the case where timeZone is passed as an object
  const tzString = typeof timeZone === 'object' ? timeZone.timeZone : timeZone;

  // Handle IANA timezone names (e.g., "America/New_York")
  if (tzString.includes('/')) {
    try {
      const options = { timeZone: tzString, hour: 'numeric', hour12: false };
      hour = parseInt(new Intl.DateTimeFormat('en-US', options).format(date));
    } catch (error) {
      throw new Error("Invalid IANA timezone name");
    }
  } else {
    // Convert timezone string to offset in minutes
    const tzParts = tzString.match(/^([+-])(\d{2}):?(\d{2})?$/);
    if (!tzParts) {
      throw new Error("Invalid timezone format. Expected +HH:MM or -HH:MM");
    }
    
    const sign = tzParts[1] === '+' ? -1 : 1;
    const hours = parseInt(tzParts[2]);
    const minutes = tzParts[3] ? parseInt(tzParts[3]) : 0;
    const requestedOffset = sign * (hours * 60 + minutes);
    
    // Calculate hour in requested timezone
    const offsetDiff = requestedOffset + date.getTimezoneOffset();
    hour = (date.getHours() + Math.floor(offsetDiff / 60)) % 24;
    if (hour < 0) hour += 24;
  }

  if (hour < 12) {
    return "morning";
  } else if (hour < 17) {
    return "afternoon";
  } else {
    return "evening";
  }
}

greet.description = 'Given a person\'s name, return a greeting message and use getTime tool to get the current time so that the tool can provide proper context.';
getTime.description = 'Get the time of the day, such as morning, afternoon, or evening. This function should be called once, regardless of the number of people provided.';
async function runDemoLoop() {
  // Initialize OpenAI client
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Create a swarm instance
  const swarm = new Swarm(client);


  // Create a basic agent
  const agent: Agent = {
    name: 'Assistant',
    model: 'gpt-4o-mini',
    instructions: 'You are a helpful assistant.',
    functions: [getTime, greet],
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