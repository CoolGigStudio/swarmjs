# SwarmJS

Agentic framework inspired from OpenAI's swarm framework for TypeScript and JavaScript.

# SwarmJS

A TypeScript framework for building and testing AI agent swarms using OpenAI's GPT models.

## Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- TypeScript (v4.5 or higher)
- OpenAI API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/swarmjs.git
cd swarmjs
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your OpenAI API key:
```bash
OPENAI_API_KEY=your_api_key_here
DEBUG=false  # Set to true for detailed logging
```

## Project Structure

```
swarmjs/
├── core/
│   ├── swarm.ts
│   └── types.ts
├── lib/
│   └── swarms/
│       └── DagSwarm.ts
├── examples/
│   ├── simple-agent.ts
│   └── simple-dag-swarm.ts
├── repl.ts
└── package.json
```

## Available Examples

### 1. Simple Agent Example
A basic implementation using a single agent to create customized greetings based on timezone:
```bash
npm run example:simple-agent
# or
ts-node examples/simple-agent.ts
```

### 2. DAG Swarm Example
A more complex implementation using Directed Acyclic Graph (DAG) for planning and execution:
```bash
npm run example:dag-swarm
# or
ts-node examples/simple-dag-swarm.ts
```

## Development

### Running in Debug Mode

Set the `DEBUG` environment variable to `true` in your `.env` file or when running the command:

```bash
DEBUG=true npm run example:simple-agent
```

### Adding New Examples

1. Create a new file in the `examples` directory
2. Import the `runExample` function from `repl.ts`
3. Implement your example following the existing patterns
4. Add a new script to `package.json` for easy execution

Example:
```typescript
import { runExample } from '../repl';
import { Agent } from '../core/types';

// Define your agent and functions
const myAgent: Agent = {
    // Agent configuration
};

runExample('MyExample', () => myAgent);
```

## Building the Project

1. Build the TypeScript files:
```bash
npm run build
```

This will:
- Type-check all files
- Compile TypeScript to JavaScript
- Output to the `dist` directory

2. Run the built version:
```bash
node dist/examples/simple-agent.js
```

## Scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "ts-node repl.ts",
    "example:simple-agent": "ts-node examples/simple-agent.ts",
    "example:dag-swarm": "ts-node examples/simple-dag-swarm.ts",
    "dev": "ts-node-dev --respawn --transpile-only repl.ts",
    "lint": "eslint . --ext .ts",
    "test": "jest"
  }
}
```

## Dependencies

Add these to your `package.json`:

```json
{
  "dependencies": {
    "openai": "^4.0.0",
    "dotenv": "^16.0.0",
    "chalk": "^4.1.2"
  },
  "devDependencies": {
    "@types/node": "^16.0.0",
    "typescript": "^4.5.0",
    "ts-node": "^10.0.0",
    "ts-node-dev": "^2.0.0",
    "@typescript-eslint/eslint-plugin": "^5.0.0",
    "@typescript-eslint/parser": "^5.0.0",
    "eslint": "^8.0.0",
    "jest": "^27.0.0",
    "@types/jest": "^27.0.0",
    "ts-jest": "^27.0.0"
  }
}
```

## TypeScript Configuration

Add this `tsconfig.json` to your project root:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT

## Support

For support, please open an issue in the GitHub repository.

## License

MIT License - see LICENSE for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
