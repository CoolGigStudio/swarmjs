import { runExample } from '../repl';
import { Agent } from '../../core/openai-types';
import chalk from 'chalk';

async function create_greeting(names: string, timeOfDay: string): Promise<string> {
    return `Good jolly ${timeOfDay}, ${names}!`;
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

const functions = [create_greeting, get_time_of_day];

// Create a single agent that handles both timezone and greeting functionality
const simpleAgent: Agent = {
    name: 'GreetingAssistant',
    model: 'gpt-4',
    instructions: `You are a helpful assistant that creates personalized greetings for users based on their timezone.
    
When a user provides their name and timezone information (either in a standard format like '+HH:MM' or common abbreviations like 'PST', 'EST'), you should:
1. Use the get_time_of_day function to determine the appropriate time of day for their timezone
2. Use the create_greeting function to generate a personalized greeting with their name and the correct time of day
3. Respond with the greeting and optionally engage in friendly conversation

If the timezone is missing, use '+00:00' (UTC) as the default.
If the name is unclear, politely ask for clarification.

Examples of valid inputs:
- "Hi, I'm Alice in PST"
- "My name is Bob and I'm in +05:30"
- "Hello from EST, I'm Charlie"
- "I'm David"

Always maintain a friendly and welcoming tone.`,
    functions: functions,
    toolChoice: 'auto',
    parallelToolCalls: true,
};

// Run the example
runExample('SimpleAgent', () => simpleAgent)
    .catch((error) => {
        console.error(chalk.red('Error:'), error);
        process.exit(1);
    });