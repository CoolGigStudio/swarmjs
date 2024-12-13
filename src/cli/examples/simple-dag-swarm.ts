import chalk from 'chalk';
import { runExample } from '../repl';
import { MetaDagExecutionAgent } from '../../lib/agents/DagAgents';
import { AgentFunction } from '../../core/types';

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

// Add function descriptions
Object.defineProperty(create_greeting, 'description', {
    value: 'Given a person\'s name, return a greeting message.'
});

Object.defineProperty(get_time_of_day, 'description', {
    value: 'Get the time of day (morning, afternoon, or evening) for the given timezone.'
});

// Optional: Define a predefined DAG structure if you want to enforce a specific flow
const greetingDag = {
    nodes: {
        'getTime': {
            id: 'getTime',
            type: 'function',
            functionName: 'get_time_of_day',
            functionArgs: {
                timeZone: 'EST'  // Default timezone, LLM can modify this
            },
            dependencies: []
        },
        'createGreeting': {
            id: 'createGreeting',
            type: 'function',
            functionName: 'create_greeting',
            functionArgs: {
                names: 'User',  // Default name, LLM can modify this
                timeOfDay: '$getTime'
            },
            dependencies: ['getTime']
        }
    },
    startNodes: ['getTime']
};

// Initialize the functions array
const functions: AgentFunction[] = [create_greeting, get_time_of_day];

// Create the meta agent
const metaAgent = new MetaDagExecutionAgent(
    "create a customized greeting message for the given name and the timezone that the user provided",
    functions
);

console.log('Meta agent:', metaAgent);

// Run the example with the meta agent
runExample('Enhanced DAG Example', () => metaAgent.getAgent())
    .catch((error) => {
        console.error(chalk.red('Error:'), error);
        process.exit(1);
    });

// Alternatively, if you want to use the predefined DAG:
/*
import { DagExecutionAgent } from '../../lib/swarms/nested-dag';

const executionAgent = new DagExecutionAgent(
    "create a customized greeting message for the given name and the timezone that the user provided",
    functions,
    greetingDag
);

runExample('Enhanced DAG Example', () => executionAgent.getAgent())
    .catch((error) => {
        console.error(chalk.red('Error:'), error);
        process.exit(1);
    });
*/