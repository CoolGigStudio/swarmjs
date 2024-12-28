import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources';
import { ContentBlock } from '@anthropic-ai/sdk/resources';

// Initialize the Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ,
});

// Define interfaces
interface ToolFunction {
  name: string;
  handler: (...args: any[]) => any;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

interface Assistant {
  name: string;
  instructions: string;
  tools: ToolFunction[];
  systemPrompt: string;
}

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

// Create a function registry
const functionRegistry: Record<string, ToolFunction> = {
  'getTime': {
    name: 'getTime',
    handler: () => {
      console.log("Getting current time");
      const date = new Date();
      date.setFullYear(date.getFullYear() - 1);
      date.setHours(date.getHours() - 6);
      return date.toISOString();
    },
    description: "Get the current time",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  'createGreeting': {
    name: 'createGreeting',
    handler: (name: string, givenTime: string) => {
      const hour = parseInt(givenTime.split('T')[1].split(':')[0]);
      let timeOfDay = "morning";
      if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
      if (hour >= 17) timeOfDay = "evening";
      return `Good ${timeOfDay}, ${name}! It's currently ${givenTime}.`;
    },
    description: "Create a greeting using a name and time",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the user"
        },
        givenTime: {
          type: "string",
          description: "The time to use in the greeting"
        }
      },
      required: ["name", "givenTime"]
    }
  },
  'switchAgent': {
    name: 'switchAgent',
    handler: async (to: string, payload: any) => ({ to, payload }),
    description: "Switch to another agent",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "The agent to switch to"
        },
        payload: {
          type: "object",
          description: "Data to send to the next agent"
        }
      },
      required: ["to", "payload"]
    }
  }
};

// Store all assistants and their configurations
const assistants: { [key: string]: Assistant } = {
  'planner': {
    name: "Planner Assistant",
    instructions: `You are a planning assistant that creates execution plans.
    When done planning, transition to the executor by calling switchAgent with:
    {
      "to": "executor",
      "payload": {
        "plan": "your DAG plan here"
      }
    }`,
    tools: Object.values(functionRegistry),
    systemPrompt: `You are a planning assistant. Your role is to break down complex tasks into manageable steps.
    
    Available tools:
    ${Object.entries(functionRegistry).map(([name, func]) => 
      `${name}: ${func.description}\n`
    ).join('')}

    For complex tasks, create a DAG (Directed Acyclic Graph) plan and pass it to the executor.
    Enclose the DAG in <plan> tags.
    When planning is complete, use the switchAgent tool to transition to the executor.
    
    Format tool calls using XML tags like this:
    <tool>{"name": "toolName", "arguments": {...}}</tool>
    `
  },
  'executor': {
    name: "Executor Assistant",
    instructions: `You are an execution assistant that follows plans.
    When execution is complete, you can transition to another agent if needed by calling switchAgent.`,
    tools: Object.values(functionRegistry),
    systemPrompt: `You are an execution assistant. Your role is to follow plans created by the planner.
    
    Available tools:
    ${Object.entries(functionRegistry).map(([name, func]) => 
      `${name}: ${func.description}\n`
    ).join('')}

    When you receive a plan, execute each step in order according to dependencies.
    For each node:
    1. Extract the tool call from the "tool" field
    2. Replace any RESULT_FROM_STEPID placeholders with actual results from previous steps
    3. Execute the tool call and store its result
    4. Continue to next step only when all required steps are complete
    
    Report the result of each step clearly in your response.
    Use the exact tool calls provided in the plan - do not modify them except to replace RESULT placeholders.
    `
  }
};

// Function to extract and handle tool calls from Claude's response
function extractToolCalls(content: string): ToolCall[] {
    console.log("Content", content);
    const calls: ToolCall[] = [];
    
    // First, split the content by plan tags
    const parts = content.split(/<\/?plan>/);
    
    // Only process tool calls in even-numbered parts (outside plan tags)
    // parts[0] is before first <plan>, parts[1] is inside first plan, parts[2] is between plans, etc.
    for (let i = 0; i < parts.length; i += 2) {
        const part = parts[i];
        const toolCallRegex = /<tool>(.*?)<\/tool>/gs;
        const matches = [...(part?.matchAll(toolCallRegex) || [])];
        
        for (const match of matches) {
            try {
                const jsonString = match[1].replace(/'/g, '"');
                const toolCall = JSON.parse(jsonString) as ToolCall;
                calls.push(toolCall);
            } catch (e) {
                console.error('Failed to parse tool call:', match[1]);
                console.error('Error:', e);
            }
        }
    }
    
    console.log("Calls", calls);
    return calls;
}

async function handleToolCalls(content: string): Promise<string> {
  const toolCalls = extractToolCalls(content);
  let modifiedContent = content;

  for (const toolCall of toolCalls) {
    console.log("Tool call", toolCall);
    const func = functionRegistry[toolCall.name];
    if (!func) {
      console.error(`Unknown function: ${toolCall.name}`);
      continue;
    }

    try {
      const args = toolCall.arguments;
      const positionalArgs = func.parameters.required?.map(param => args[param]) || 
                           Object.values(args);
      
      const result = await func.handler(...positionalArgs);
      
      // Replace the tool call with the result
      const toolCallStr = `<tool>${JSON.stringify({ name: toolCall.name, arguments: args })}</tool>`;
      modifiedContent = modifiedContent.replace(toolCallStr, JSON.stringify(result));

      // Check if this was a switchAgent call
      if (toolCall.name === 'switchAgent') {
        return JSON.stringify(result);
      }
    } catch (error) {
      console.error(`Error executing ${toolCall.name}:`, error);
    }
  }

  return modifiedContent;
}

function getTextFromContent(content: ContentBlock[]): string {
  const textContent = content.find(block => block.type === 'text');
  if (textContent && 'text' in textContent) {
    return textContent.text;
  }
  return '';
}

async function runAgent(agentKey: string, message: string, history: MessageParam[] = []) {
  const assistant = assistants[agentKey];
  if (!assistant) {
    throw new Error(`Unknown agent: ${agentKey}`);
  }

  console.log("Running agent:", agentKey);
  console.log("Message:", message);

  // Add the system prompt and message to history
  const updatedHistory: MessageParam[] = [
    { role: 'user', content: assistant.systemPrompt },
    ...history,
    { role: 'user', content: message }
  ];

  // Send message to Claude
  const response = await anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 4096,
    messages: updatedHistory,
    temperature: 0.7,
  });

  // Extract text from the response content
  const responseText = getTextFromContent(response.content);
  
  // Handle any tool calls in the response
  const processedResponse = await handleToolCalls(responseText);
  
  // Check if we need to switch to another agent
  try {
    const transition = JSON.parse(processedResponse);
    if (transition.to && transition.payload) {
      console.log("Transitioning to:", transition.to);
      return await runAgent(
        transition.to,
        JSON.stringify(transition.payload),
        [...updatedHistory, { role: 'assistant', content: responseText }]
      );
    }
  } catch (e) {
    // Not a transition response, continue normally
  }

  return processedResponse;
}

// Function to add new functions at runtime
function addFunction(funcDef: ToolFunction) {
  functionRegistry[funcDef.name] = funcDef;
  // Update tools for all assistants
  Object.values(assistants).forEach(assistant => {
    assistant.tools = Object.values(functionRegistry);
  });
}

async function main() {
  try {
    // Example complex task that requires planning and execution
    const result = await runAgent('planner', 
      "Create a personalized greeting workflow: Get the current time, create a greeting for John Doe, " +
      "then create another greeting for Jane Smith."
    );
    
    console.log("\nFinal result:");
    console.log(result);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();