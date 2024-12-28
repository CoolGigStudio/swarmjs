import OpenAI from 'openai';

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ,
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
  id: string;
  name: string;
  instructions: string;
  tools: any[];
}

interface AgentTransition {
  to: string;
  payload: any;
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

// Generate tools array from registry
function getToolsFromRegistry(): any[] {
  return Object.values(functionRegistry).map(func => ({
    type: "function",
    function: {
      name: func.name,
      description: func.description,
      parameters: func.parameters
    }
  }));
}

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
    tools: getToolsFromRegistry(),
    id: ''
  },
  'executor': {
    name: "Executor Assistant",
    instructions: `You are an execution assistant that follows plans.
    When execution is complete, you can transition to another agent if needed by calling switchAgent.`,
    tools: getToolsFromRegistry(),
    id: ''
  }
};

async function createThread() {
  console.log("Creating thread");
  const thread = await openai.beta.threads.create();
  return thread;
}

async function sendMessage(threadId: string, content: string) {
  const message = await openai.beta.threads.messages.create(
    threadId,
    {
      role: "user",
      content: content
    }
  );
  return message;
}

// Generic tool call handler
async function handleToolCalls(run: OpenAI.Beta.Threads.Run): Promise<any> {
  if (run.required_action?.type === 'submit_tool_outputs') {
    const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
    const toolOutputs = [];

    for (const toolCall of toolCalls) {
      const funcName = toolCall.function.name;
      const func = functionRegistry[funcName];
      
      if (!func) {
        console.error(`Unknown function: ${funcName}`);
        continue;
      }

      try {
        const args = JSON.parse(toolCall.function.arguments);
        // For functions with named parameters, convert to positional arguments
        const positionalArgs = func.parameters.required?.map(param => args[param]) || 
                             Object.values(args);
        
        const result = await func.handler(...positionalArgs);

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result)
        });
      } catch (error) {
        console.error(`Error executing ${funcName}:`, error);
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({ error: `Failed to execute ${funcName}` })
        });
      }
    }

    return toolOutputs;
  }
  return null;
}

async function waitForRunCompletion(threadId: string, runId: string) {
  while (true) {
    const run = await openai.beta.threads.runs.retrieve(
      threadId,
      runId
    );

    console.log("Run status:", run.status);
    
    if (run.status === 'requires_action') {
      console.log("Handling tool calls...");
      const toolOutputs = await handleToolCalls(run);
      if (toolOutputs) {
        await openai.beta.threads.runs.submitToolOutputs(
          threadId,
          runId,
          { tool_outputs: toolOutputs }
        );
        console.log("Tool outputs submitted");
      }
    } else if (run.status === 'completed') {
      return run;
    } else if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(`Run ended with status: ${run.status}`);
    }

    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function getResponse(threadId: string, assistantId: string) {
  const run = await openai.beta.threads.runs.create(
    threadId,
    {
      assistant_id: assistantId,
      tools: getToolsFromRegistry(),
    }
  );
  return run;
}

// Function to add new functions at runtime
function addFunction(funcDef: ToolFunction) {
  functionRegistry[funcDef.name] = funcDef;
  // Optionally recreate tools for assistants if needed
  Object.values(assistants).forEach(assistant => {
    assistant.tools = getToolsFromRegistry();
  });
}

async function createAllAssistants() {
  console.log(`Creating assistants with tools: ${Object.values(functionRegistry).map(func => func.name).join(', ')}`);
  for (const [key, assistant] of Object.entries(assistants)) {
    console.log(`Creating ${assistant.name} with tools: ${assistant.tools.map(tool => tool.function.name).join(', ')}...`);
    const created = await openai.beta.assistants.create({
      name: assistant.name,
      instructions: assistant.instructions,
      model: "gpt-4-turbo-preview",
      tools: assistant.tools
    });
    assistant.id = created.id;
  }
  console.log("All assistants created");
}

// Add these type definitions at the top of the file
interface TextContent {
  type: 'text';
  text: {
    value: string;
    annotations: any[];
  };
}

interface ImageFileContent {
  type: 'image_file';
  image_file: {
    file_id: string;
  };
}

type MessageContent = TextContent | ImageFileContent;

// Then modify the runAgent function to include proper type checking:
async function runAgent(agentKey: string, threadId: string, message: string) {
  const assistant = assistants[agentKey];
  if (!assistant) {
    throw new Error(`Unknown agent: ${agentKey}`);
  }
  console.log("Running agent", agentKey);

  await sendMessage(threadId, message);
  const run = await getResponse(threadId, assistant.id);
  const result = await waitForRunCompletion(threadId, run.id);

  // Get the messages
  const messages = await openai.beta.threads.messages.list(threadId);
  const lastMessage = messages.data[0];

  // Check if we need to switch to another agent
  if (lastMessage.content[0] && lastMessage.content[0].type === 'text') {
    try {
      const transition = JSON.parse(lastMessage.content[0].text.value);
      if (transition.to && transition.payload) {
        return await runAgent(transition.to, threadId, JSON.stringify(transition.payload));
      }
    } catch (e) {
      console.log("No valid transition found in message");
    }
  }

  return lastMessage;
}

// And modify the main function to include proper type checking:
async function main() {
  // Create all assistants
  await createAllAssistants();
  
  // Create a thread
  const thread = await createThread();
  
  // Start with the planner
  const result = await runAgent('planner', thread.id, "Create a greeting for John Doe");
  
  // Get the final result
  if (result.content.length > 0) {
    console.log("\nFinal result:");
    result.content.forEach((content) => {
      if (content.type === 'text') {
        console.log(content.text.value);
      }
    });
  }
}

// Example of adding a new function:
// addFunction({
//   name: 'calculateAge',
//   handler: (birthYear: number) => new Date().getFullYear() - birthYear,
//   description: "Calculate age from birth year",
//   parameters: {
//     type: "object",
//     properties: {
//       birthYear: {
//         type: "number",
//         description: "Year of birth"
//       }
//     },
//     required: ["birthYear"]
//   }
// });

main().catch(console.error);