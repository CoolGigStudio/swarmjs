# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands
- Build: `npm run build` (compiles TypeScript to JavaScript)
- Dev server: `npm run dev` (with hot reload)
- Debug mode: `npm run dev:debug` (adds DEBUG=true)
- Run tests: `npm test` (runs all Jest tests)
- Single test: `npx jest path/to/test.test.ts` (run specific test file)
- Linting: `npm run lint` (ESLint on all TS files)
- Formatting: `npm run format` (Prettier on src files)
- Voice server: `npm run voice` (runs voice-llm server)
- Generate swarm: `npm run generate` (generates swarm from templates)

## Architecture Overview

SwarmJS is an agentic framework inspired by OpenAI's swarm framework, implemented in TypeScript/JavaScript. The architecture follows a layered approach:

### Core Components

1. **AbstractSwarm** (`src/core/AbstractSwarm.ts`): Base class providing common functionality for all swarm implementations including session management, agent configuration, and tool execution.

2. **GptSwarm** (`src/core/GptSwarm.ts`): Main implementation for text-based interactions with OpenAI's GPT models.

3. **VoiceSwarm** (`src/core/VoiceSwarm.ts`): Specialized implementation for voice-based interactions using WebSockets and Twilio integration.

4. **VoiceIOManager** (`src/core/VoiceIOManager.ts`): Manages voice I/O operations, WebSocket connections, and real-time voice processing.

### Key Architectural Patterns

- **Session-based**: All interactions are organized around sessions (`Flow` objects) with unique IDs
- **Tool-based**: Agents can call predefined tools with proper validation and error handling
- **Event-driven**: Voice swarms use event-driven architecture for real-time interactions
- **Modular configuration**: SwarmConfig defines agents, tools, and their relationships

### Type System

The framework uses a comprehensive type system (`src/types/`):
- `basic.ts`: Core types (AgentConfig, ToolDefinition, SwarmConfig, Flow)
- `voice.ts`: Voice-specific types (VoiceAgentConfig, VoiceSession, VoiceSwarmConfig)
- `aiService.ts`: AI service abstractions

## Code Style Guidelines
- Use TypeScript with strict typing; avoid `any` when possible
- Follow Prettier config: 2-space indentation, 80 char line limit, single quotes
- Functions require explicit return types (ESLint rule)
- Use async/await for asynchronous code, not callbacks
- Error handling: Use custom SwarmError class with error types
- Imports: Group in order: external libs, then relative imports
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces
- Document public APIs with JSDoc comments
- For tools, always implement proper error handling in handlers

## Working with Voice Features

Voice functionality requires:
- Twilio account and credentials in `.env`
- ngrok for local development webhooks
- WebSocket server for real-time communication
- Audio processing capabilities (ffmpeg, sox)

Voice swarms are event-driven and cannot use `runOnce()` or batch processing - they require active WebSocket sessions.