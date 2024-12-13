import { Config } from './config';

export class Logger {
    private static instance: Logger;
    private debug_mode: boolean;

    private constructor() {
        this.debug_mode = Config.DEBUG;
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public debug(message: string, ...args: unknown[]): void {
        if (this.debug_mode) {
            console.log(`[${new Date().toISOString()}] DEBUG: ${message}`, ...args);
        }
    }

    public log(message: string, ...args: unknown[]): void {
        if (this.debug_mode) {
            console.log(`[${new Date().toISOString()}] ${message}`, ...args);
        }
    }

    public error(message: string, error?: Error): void {
        console.error(`[${new Date().toISOString()}] ERROR: ${message}`, error);
    }

    public warn(message: string, ...args: unknown[]): void {
        console.warn(`[${new Date().toISOString()}] WARN: ${message}`, ...args);
    }
}
