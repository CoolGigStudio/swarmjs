import OpenAI from 'openai';

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function createAssistant() {
    const assistant = await openai.beta.assistants.create({
      name: "Simple Assistant",
      instructions: `You are a helpful assistant that creates customized greetings following this exact workflow:
  
  [
  {
    "id": "step1",
    "type": "getTime",
    "args": {
      "timezone": "EST"
    }
  },
  {
    "id": "step2",
    "type": "createGreeting",
    "args": {
      "name": "John",
      "givenTime": "$step1"
    },
    "dependencies": ["step1"]
  }
]
  
  Remember: This is a strict sequential process. Each step depends on the previous step's output.`,
      model: "gpt-4o",
    });
    return assistant;
  }
async function createThread() {
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

function createGreeting(name: string, givenTime: string) {
    const hour = parseInt(givenTime.split('T')[1].split(':')[0]);
    let timeOfDay = "morning";
    if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
    if (hour >= 17) timeOfDay = "evening";
    return `Good ${timeOfDay}, ${name}! It's currently ${givenTime}.`;
}

function getTime() {
    console.log("Getting current time");
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    date.setHours(date.getHours() - 6);
    return date.toISOString();
}

async function handleToolCalls(run: OpenAI.Beta.Threads.Run) {
  if (run.required_action?.type === 'submit_tool_outputs') {
    const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
    const toolOutputs = [];

    console.log("Tool calls:", JSON.stringify(toolCalls, null, 2));
    for (const toolCall of toolCalls) {
      let result;
      if (toolCall.function.name === 'getTime') {
        result = getTime();
      } else if (toolCall.function.name === 'createGreeting') {
        // Parse the arguments if they exist
        const args = JSON.parse(toolCall.function.arguments);
        result = createGreeting(args.name, args.givenTime);
      }

      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(result)
      });
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
        console.log("run: ", JSON.stringify(run, null, 2));
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

// Also update the tool definitions in getResponse to include parameters:
async function getResponse(threadId: string, assistantId: string) {
  const run = await openai.beta.threads.runs.create(
    threadId,
    {
      assistant_id: assistantId,
      tools: [
        {
          type: "function",
          function: {
            name: "getTime",
            description: "Get the time that is relevant to the user",
            parameters: {
              type: "object",
              properties: {}
            }
          },
        },
        {
          type: "function",
          function: {
            name: "createGreeting",
            description: "Create a greeting for the user",
            parameters: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "The name of the user"
                },
                givenTime: {
                  type: "string",
                  description: "The time relevant to the user"
                }
              },
              required: ["name", "givenTime"]
            }
          },
        },
      ],
      tool_choice: "required",
      temperature: 0.1,
    }
  );
  return run;
}

async function main() {
  console.log("Creating assistant...");
  const assistant = await createAssistant();
  
  console.log("Creating thread...");
  const thread = await createThread();
  
  console.log("Sending message...");
  await sendMessage(thread.id, "John Doe, EST");
  
  console.log("Starting run...");
  const run = await getResponse(thread.id, assistant.id);
  
  console.log("Waiting for response...");
  await waitForRunCompletion(thread.id, run.id);
  
  console.log("Fetching messages...");
  const messages = await openai.beta.threads.messages.list(thread.id);
  
  if (messages.data.length > 0) {
    console.log("\nAssistant's response:");
    // Type check the content
    messages.data[0].content.forEach((content) => {
      if (content.type === 'text') {
        console.log(content.text.value);
      }
    });
  }
}

main().catch(console.error);
