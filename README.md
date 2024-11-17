# SwarmJS

Agentic framework inspired from OpenAI's swarm framework for TypeScript and JavaScript.

## Features

- Full TypeScript support
- OpenAI API integration
- Streaming support
- Function calling
- Agent-based architecture
- CLI REPL interface

## Installation

```bash
npm install swarmjs
```

## Quick Start

```typescript
import { Swarm, Agent } from 'swarmjs';
import OpenAI from 'openai';

// Initialize OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create a swarm instance
const swarm = new Swarm(client);

// Define an agent
const agent: Agent = {
  name: 'Assistant',
  model: 'gpt-4',
  instructions: 'You are a helpful assistant.',
  functions: [],
};

// Run a conversation
const response = await swarm.run(
  agent,
  [{ role: 'user', content: 'Hello!' }]
);

console.log(response);
```

## Development

1. Clone the repository:
```bash
git clone https://github.com/CoolGigStudio/swarmjs.git
cd swarmjs
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Run tests:
```bash
npm test
```

## License

MIT License - see LICENSE for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.