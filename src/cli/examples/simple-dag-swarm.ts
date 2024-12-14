// simple-dag-swarm.ts
import chalk from 'chalk';
import { runExample } from '../repl';
import { DagCreationAgent, DagExecutionAgent, DagTask, MetaDagCoordinator } from '../../lib/agents/DagAgents';
import { AgentFunction } from '../../core/types';

// Create greeting function with timezone awareness
async function create_greeting(names: string, timeOfDay: string): Promise<string> {
    return `Good ${timeOfDay}, ${names}!`;
}

// Timezone handling function with support for various formats
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

// Add necessary properties to the functions for proper discovery and usage
Object.defineProperty(create_greeting, 'name', {
    value: 'create_greeting',
    configurable: false,
    writable: false
});

Object.defineProperty(create_greeting, 'description', {
    value: 'Creates a personalized greeting message using the provided name and time of day.',
    configurable: false,
    writable: false
});

Object.defineProperty(get_time_of_day, 'name', {
    value: 'get_time_of_day',
    configurable: false,
    writable: false
});

Object.defineProperty(get_time_of_day, 'description', {
    value: 'Determines the time of day (morning, afternoon, or evening) for a given timezone. Supports IANA timezone names and offset formats.',
    configurable: false,
    writable: false
});

// Initialize the functions array with our timezone-aware greeting functions
const functions: AgentFunction[] = [create_greeting, get_time_of_day];

// Define the goal for our DAG system
const goal = "create a customized greeting message for the given name and timezone that the user provided";

// Input example: John, +08:00
runExample('DAG Swarm Example - Case # 2 with automatically generated dag', () => {
    const coordinator = new MetaDagCoordinator(
        goal,
        functions
    );
    return coordinator;
})
.catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});

/*
// Input example: John, +08:00
runExample('DAG Swarm Example - Case # 1 with predefined dag', () => {
    const dag: DagTask[] = [
        {
            id: "determineTimeOfDay",
            type: "function",
            functionName: "get_time_of_day",
            functionArgs: {
                timeZone: "+08:00"
            },
            dependencies: []
        },
        {
            id: "createGreetingMessage",
            type: "function",
            functionName: "create_greeting",
            functionArgs: {
                names: "John",
                timeOfDay: "$determineTimeOfDay"
            },
            dependencies: ["determineTimeOfDay"]
        }
    ];

    const executor = new DagExecutionAgent(
        goal,
        functions,
        dag
    );
    return executor;
})
.catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});
*/
