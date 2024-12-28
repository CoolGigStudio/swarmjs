import 'dotenv/config';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { Swarm } from '../core/swarm_backup';
import OpenAI from 'openai';
import { Agent } from '../core/openai-types';

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
            console.log();
            content = '';
        }
    }
}

export async function runExample(
    name: string,
    getAgent: () => Promise<Agent> | Agent
) {
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const swarm = new Swarm(client);
    
    console.log(chalk.green(`Starting SwarmJS CLI with ${name} 🐝`));
    console.log(chalk.gray('Type your messages and press Enter. Press Ctrl+C to exit.\n'));

    const messages: any[] = [];
    const agent = await Promise.resolve(getAgent());

    while (true) {
        const userInput = await new Promise<string>((resolve) => {
            rl.question(chalk.gray('User: '), resolve);
        });

        if (userInput.trim().includes('quit!')) {
            console.log(chalk.yellow('\nGoodbye! 👋'));
            rl.close();
            process.exit(0);
        }

        messages.push({ role: 'user', content: userInput });

        try {
            const response = await swarm.run(
                agent,
                messages,
                {},  // context variables
                null, // model override
                true, // stream
                DEBUG // debug
            );

            if (Symbol.asyncIterator in Object(response)) {
                await processAndPrintStreamingResponse(response as AsyncGenerator<any, void, unknown>);
            }
        } catch (error) {
            console.error(chalk.red('Error during execution:'), error);
            if (error instanceof Error) {
                console.error(chalk.red('Error details:'), error.message);
            }
        }
    }
}

if (require.main === module) {
    console.log(chalk.yellow('Please run a specific example file instead of this generic REPL.'));
    process.exit(1);
}

process.on('SIGINT', () => {
    console.log(chalk.yellow('\nGoodbye! 👋'));
    rl.close();
    process.exit(0);
});