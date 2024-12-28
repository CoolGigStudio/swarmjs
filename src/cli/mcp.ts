import Anthropic from '@anthropic-ai/sdk';
import { ContentBlock } from '@anthropic-ai/sdk/resources';

// Type definitions
type Role = 'user' | 'assistant';

interface Message {
  role: Role;
  content: string;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

interface ServerConfig {
  name: string;
  version: string;
}

interface FetchDataArgs {
  url: string;
}

interface ProcessDataArgs {
  data: string;
}

type ToolHandler<T> = (args: T) => Promise<string>;

class Server {
  private anthropic: Anthropic;
  private tools: Map<string, Tool>;
  private toolHandlers: Map<string, ToolHandler<any>>;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY ,
    });
    this.tools = new Map();
    this.toolHandlers = new Map();
    this.config = config;
  }

  // Register a tool and its handler
  registerTool<T>(tool: Tool, handler: ToolHandler<T>) {
    this.tools.set(tool.name, tool);
    this.toolHandlers.set(tool.name, handler);
  }

  // Get list of available tools
  async listTools(): Promise<Tool[]> {
    return Array.from(this.tools.values());
  }

  // Execute a tool
  async callTool(name: string, args: any): Promise<string> {
    const handler = this.toolHandlers.get(name);
    if (!handler) {
      throw new Error(`Tool not found: ${name}`);
    }
    return handler(args);
  }

  // Process sequential tool calls
  async processSequentialTools(content: string): Promise<string> {
    console.log("Processing content:", content);
    const toolCallRegex = /<tool>(.*?)<\/tool>/gs;
    const matches = [...content.matchAll(toolCallRegex)];
    let modifiedContent = content;

    for (const match of matches) {
      try {
        const toolCall = JSON.parse(match[1]);
        console.log("Executing tool:", toolCall.name);
        const result = await this.callTool(toolCall.name, toolCall.arguments);
        modifiedContent = modifiedContent.replace(match[0], result);
      } catch (e) {
        console.error('Failed to execute tool:', e);
      }
    }

    return modifiedContent;
  }

  // Handle conversation with Claude
  async handleConversation(userMessage: string, previousResult?: string): Promise<string> {
    const systemPrompt = `You are an assistant with access to these tools:
${Array.from(this.tools.values())
  .map(tool => `${tool.name}: ${tool.description}`)
  .join('\n')}

Use tools by wrapping calls in <tool> tags with JSON syntax.
Always use the exact result from a previous tool when it's provided.`;

    const messages: Message[] = [
      { role: 'user', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    if (previousResult) {
      messages.push(
        { role: 'assistant', content: 'Previous tool result: ' + previousResult }
      );
    }

    const response = await this.anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      messages: messages,
      temperature: 0.7,
    });

    const responseText = this.getTextFromContent(response.content);
    return this.processSequentialTools(responseText);
  }

  private getTextFromContent(content: ContentBlock[]): string {
    const textContent = content.find(block => block.type === 'text');
    if (textContent && 'text' in textContent) {
      return textContent.text;
    }
    return '';
  }
}

// Example usage
async function main() {
  // Initialize server
  const server = new Server({
    name: "example-server",
    version: "1.0.0"
  });

  // Register fetch_data tool
  server.registerTool<FetchDataArgs>(
    {
      name: "fetch_data",
      description: "Fetch data from an external source",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" }
        },
        required: ["url"]
      }
    },
    async ({ url }: FetchDataArgs) => {
      // Simulate fetching data
      return `Data from ${url}`;
    }
  );

  // Register process_data tool
  server.registerTool<ProcessDataArgs>(
    {
      name: "process_data",
      description: "Process the fetched data",
      inputSchema: {
        type: "object",
        properties: {
          data: { type: "string" }
        },
        required: ["data"]
      }
    },
    async ({ data }: ProcessDataArgs) => {
      // Simulate processing data
      return `Processed: ${data}`;
    }
  );

  try {
    // First tool execution
    const firstResult = await server.handleConversation(
      "Please fetch data from https://example.com/data"
    );
    console.log("\nFirst Result:", firstResult);

    // Second tool execution using the first result
    const finalResult = await server.handleConversation(
      "Please process this data",
      firstResult
    );
    console.log("\nFinal Result:", finalResult);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();