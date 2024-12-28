import Anthropic from '@anthropic-ai/sdk';
import { ContentBlock } from '@anthropic-ai/sdk/resources';

// Initialize the Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ,
});

// Define the createGreeting function
const createGreeting = (name: string, givenTime: string) => {
  const hour = parseInt(givenTime.split('T')[1].split(':')[0]);
  let timeOfDay = "morning";
  if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  if (hour >= 17) timeOfDay = "evening";
  return `Good Jolly ${timeOfDay}, ${name}! It's currently ${givenTime}.`;
};

// Fixed getGivenTime function that correctly calculates one year minus 6 hours
const getGivenTime = (): string => {
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(),
    now.getHours() - 6, now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return oneYearAgo.toISOString();
};

// Function to extract and handle tool calls from Claude's response
function handleToolCalls(content: string): string {
  console.log("Content", content);
  const toolCallRegex = /<tool>(.*?)<\/tool>/gs;
  const matches = [...content.matchAll(toolCallRegex)];
  let modifiedContent = content;

  console.log("Matches", matches);
  for (const match of matches) {
    try {
      const toolCall = JSON.parse(match[1]);
      console.log("Tool call", toolCall);
      if (toolCall.name === 'createGreeting') {
        const result = createGreeting(toolCall.arguments.name, toolCall.arguments.givenTime);
        modifiedContent = modifiedContent.replace(match[0], result);
      } else if (toolCall.name === 'givenTime') {
        const result = getGivenTime();
        modifiedContent = modifiedContent.replace(match[0], result);
      }
    } catch (e) {
      console.error('Failed to handle tool call:', e);
    }
    console.log("Modified content", modifiedContent);
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

async function runAssistant(userMessage: string) {
  // System prompt that explains available tools
  const systemPrompt = `You are a helpful assistant with access to the following tools:

createGreeting: Creates a time-appropriate greeting for a user
Parameters:
- name: string (name of the person to greet)
- givenTime: string (current time in ISO format)

givenTime: Fetches the current time in ISO format.
Parameters:
- None

To use the tools, wrap each call in <tool> tags with JSON syntax. Follow these steps exactly:

1. First call givenTime to get the current time like this:
<tool>{"name": "givenTime"}</tool>

2. After receiving the time response, use that EXACT time string in your createGreeting call like this:
<tool>{"name": "createGreeting", "arguments": {"name": "Name", "givenTime": "[INSERT THE EXACT TIME STRING YOU RECEIVED]"}}</tool>

Important: You must use the exact time string returned from the givenTime call in your createGreeting call. Do not create or assume a time.`;

  // Send message to Claude
  const response = await anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.7,
  });

  // Extract text from the response content
  const responseText = getTextFromContent(response.content);

  // Handle any tool calls in the response
  const processedResponse = handleToolCalls(responseText);
  return processedResponse;
}

async function main() {
  try {
    const result = await runAssistant("Please create a greeting for Jane Smith");
    console.log("\nResult:");
    console.log(result);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();