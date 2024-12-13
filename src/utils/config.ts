export const Config = {
    DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gpt-4',
    MAX_RESULTS_SIZE: parseInt(process.env.MAX_RESULTS_SIZE || '1000'),
    DEBUG: process.env.DEBUG === 'true',
    CTX_VARS_NAME: 'contextVariables',
    MAX_RETRIES: 3,
    TIMEOUT_MS: 30000,
    
    getExecutionInstructions: (goal: string, dagSteps: unknown): string => {
        return `Execute the following DAG to achieve the goal: ${goal}\n\nSteps: ${JSON.stringify(dagSteps, null, 2)}`;
    }
};