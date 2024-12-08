import chalk from 'chalk';
import { runExample } from '../repl';
import DagSwarm from '../../lib/swarms/DagSwarm';

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

const functions = [create_greeting, get_time_of_day];
const dagSwarm = new DagSwarm(
    "create a customized greeting message for the given name and the timezone that the user provided",
    functions
);

runExample('DagSwarm', () => dagSwarm.getDagCreationAgent())
    .catch((error) => {
        console.error(chalk.red('Error:'), error);
        process.exit(1);
    });