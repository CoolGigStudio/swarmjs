import 'dotenv/config';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { Swarm } from '../core/swarm';
import OpenAI from 'openai';
import DagSwarm from '../lib/swarms/DagSwarm';

const DEBUG = process.env.DEBUG === 'true';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
});

async function create_greeting(names: string, timeOfDay: string): Promise<string> {
    return `Good ${timeOfDay}, ${names}!`;
}

async function get_time_of_day(timeZone: string | { timeZone: string } = '+00:00'): Promise<string> {
    const date = new Date();
    let hour: number;
    
    const tzString = typeof timeZone === 'object' ? timeZone.timeZone : timeZone;
    const timezoneMap: { [key: string]: string } = {
        'PST': 'America/Los_Angeles',
        'EST': 'America/New_York',
        'MST': 'America/Denver',
        'CST': 'America/Chicago',
    };

    const ianaTimezone = timezoneMap[tzString.toUpperCase()] || tzString;

    if (ianaTimezone.includes('/')) {
        try {
            const options: Intl.DateTimeFormatOptions = { 
                timeZone: ianaTimezone, 
                hour: "numeric" as const, 
                hour12: false 
            };
            hour = parseInt(new Intl.DateTimeFormat('en-US', options).format(date));
        } catch (error) {
            throw new Error("Invalid IANA timezone name");
        }
    } else {
        const tzParts = tzString.match(/^([+-])(\d{2}):?(\d{2})?$/);
        if (!tzParts) {
            throw new Error("Invalid timezone format. Expected +HH:MM or -HH:MM");
        }
        
        const sign = tzParts[1] === '+' ? -1 : 1;
        const hours = parseInt(tzParts[2]);
        const minutes = tzParts[3] ? parseInt(tzParts[3]) : 0;
        const requestedOffset = sign * (hours * 60 + minutes);
        
        const offsetDiff = requestedOffset + date.getTimezoneOffset();
        hour = (date.getHours() + Math.floor(offsetDiff / 60)) % 24;
        if (hour < 0) hour += 24;
    }

    if (hour < 12) return "morning";
    else if (hour < 17) return "afternoon";
    else return "evening";
}

create_greeting.description = 'Given a person\'s name, return a greeting message.';
get_time_of_day.description = 'Get the time of day (morning, afternoon, or evening) for the given timezone.';

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

async function runDemoLoop() {
    const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const swarm = new Swarm(client);
    const functions = [create_greeting, get_time_of_day];
    
    const dagSwarm = new DagSwarm(
        "create a customized greeting message for the given name and the timezone that the user provided",
        functions
    );

    console.log(chalk.green('Starting SwarmJS CLI with DagSwarm 🐝'));
    console.log(chalk.gray('Type your messages and press Enter. Press Ctrl+C to exit.\n'));

    const messages: any[] = [];

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
                dagSwarm.getDagCreationAgent(),
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

process.on('SIGINT', () => {
    console.log(chalk.yellow('\nGoodbye! 👋'));
    rl.close();
    process.exit(0);
});

runDemoLoop().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});