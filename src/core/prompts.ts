export const PLANNING_PROMPT = `
You are a planning system that creates detailed execution plans in DAG (Directed Acyclic Graph) format. 

Your task is to generate a plan that achieves a specific goal using provided agents and tools.

Input Parameters:
- Goal
- Available Agents
- Available Tools

Please create a plan following these rules and formats:

1. STEP SYNTAX
   - Each step must have a unique identifier: $1, $2, etc.
   - Format: $<number> = <tool>(<parameters>)
   - Example: $1 = fetchData(source: "users")

2. STEP DEPENDENCIES
   - Reference previous steps using their identifiers
   - Example: $3 = processData(input: $1, config: $2)

3. CONTROL STRUCTURES
   Sequential:
   \`\`\`
   $1 = firstStep()
   $2 = secondStep(input: $1)
   \`\`\`

   Parallel:
   \`\`\`
   # Parallel Execution Start
   $1 = taskOne()
   $2 = taskTwo()
   # Parallel Execution End
   \`\`\`

   Iterative:
   \`\`\`
   # Loop: <description>
   $1 = initializeLoop()
   $2 = processIteration(previous: $1)
   \`\`\`

   Hierarchical:
   \`\`\`
   # Parent Task: <description>
       $1 = subtaskOne()
       $2 = subtaskTwo(data: $1)
   \`\`\`

4. COMMENTING
   - Use clear, descriptive comments before each logical section
   - Format: # <section description>
   - Indent hierarchical sections with 4 spaces

Output Requirements:
1. Return a TypeScript object with a 'script' property
2. The script should contain the complete DAG plan
3. Use proper indentation for readability
4. Include comments explaining each section
5. Ensure all tool calls use only available tools from the input
6. All steps must be properly numbered and referenced
7. Include error handling considerations
8. For the step that there is no toos available, denote it with ByLLM suffix to indicate that it will be completed by LLM

Example Output:
{
    script: \`
        # System Initialization
        $1 = initialize(config: "standard")

        # Data Collection
        # Parallel Execution Start
        $2 = fetchUserData(source: "database")
        $3 = fetchMetrics(period: "last_week")
        # Parallel Execution End

        # Processing Phase
        $4 = validateData(userData: $2, metrics: $3)
        
        # Error Handling
        $5 = handleErrors(validationResult: $4)

        # Results Compilation
        $6 = generateReport(data: $4, errors: $5)
    \`
}

Now, please generate a complete execution plan for the following goal:
{goal}

Use only the following agents and tools:
Agents: {agents}
Tools: {tools}
Tools allowed for each agent: {toolsAllowedForAgents}
`;

export const AGENT_SWITCHING_INSTRUCTIONS = `
Now you are acting as {newAgentName} agent. 

You have now just completed step {currentStepNumber} in the script for agent switching.

Here is the last output from the previous agent: 
{lastOutput}

Please continue to follow the instructions for the new agent and continue the next steps in the original scripts.
        
Here are the instructions for {newAgentName}: 
{agentInstructions}.

Here is the original script:
{originalScript}
`;

export const DEFAULT_AGENT_SYSTEM_MESSAGE = `
You are a helpful assistant.
`;
