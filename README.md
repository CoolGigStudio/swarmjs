# SwarmJS

Agentic framework inspired by OpenAI's swarm framework, implemented in TypeScript and JavaScript. Supports both text-based and voice-based AI agent interactions with tool calling, session management, and real-time communication.

## Prerequisites

- Node.js (v18 or higher)
- npm (v7 or higher)
- OpenAI API key
- For voice features: Twilio account, ngrok, ffmpeg

## Setup

1. Clone the repository:

```bash
git clone https://github.com/CoolGigStudio/swarmjs.git
cd swarmjs
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory:

```bash
OPENAI_API_KEY=your_api_key_here
DEBUG=false  # Set to true for detailed logging

# For voice features with VoIP (optional):
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
HOSTNAME=your_ngrok_or_server_url
PORT=3010  # Voice server port (default: 3010)
```

## Architecture

SwarmJS uses a layered architecture with these core components:

- **AbstractSwarm**: Base class for all swarm implementations
- **GptSwarm**: Text-based interactions with OpenAI GPT models
- **VoiceSwarm**: Voice-based interactions with WebSocket support
- **VoiceIOManager**: Real-time voice I/O and WebSocket management

## Project Structure

```
swarmjs/
├── src/
│   ├── core/           # Core swarm implementations
│   ├── types/          # TypeScript type definitions
│   └── tools/          # Tool handlers and utilities
├── examples/           # Example implementations
│   ├── voice-llm/      # Voice-based examples
│   ├── bank-swarm/     # Banking assistant examples
│   └── *.ts           # Various text-based examples
├── dist/              # Compiled JavaScript output
└── tests/             # Test files
```

## Running the Application

### Text-based Examples

```bash
# Car dealership booking agent
ts-node examples/customerAgentCarDealer.ts

# Banking assistant
ts-node examples/bank-swarm.ts

# Healthcare clinic assistant
ts-node examples/clinic-swarm.ts

# Debt collection assistant
ts-node examples/collect-debt.ts
```

### Voice-based Examples

```bash
# Start voice server (requires Twilio setup)
npm run voice

# Banking voice assistant
ts-node examples/voice-llm/bank/server.ts

# Debt collection voice assistant
ts-node examples/voice-llm/collect-debt/collect-debt.ts
```

## Key Features

- **Multi-modal Support**: Both text and voice-based agent interactions
- **Session Management**: Persistent sessions with unique IDs and state tracking
- **Tool Integration**: Extensible tool system with validation and error handling
- **Real-time Communication**: WebSocket support for voice applications
- **Type Safety**: Full TypeScript implementation with strict typing
- **Modular Architecture**: Pluggable components and configurations

## Local Development and Testing

### Development Commands

```bash
npm run dev           # Start development REPL with hot reload
npm run dev:debug     # Start with debug logging enabled
npm run test          # Run Jest tests
npm run lint          # Run ESLint
npm run format        # Format code with Prettier
npm run generate      # Generate swarm templates
```

### Voice Features Setup

For voice-enabled applications, additional setup is required:

#### 1. Twilio Configuration
Set up Twilio credentials for phone call handling in your `.env` file.

#### 2. ngrok Setup (Required for Local Development)
ngrok is required to expose your local server to Twilio's webhooks:

```bash
# Install ngrok
npm install -g ngrok
# or download from https://ngrok.com

# Start ngrok tunnel
ngrok http 3010

# Update your .env file with the ngrok URL
HOSTNAME=https://your-ngrok-url.ngrok-free.app
```

**Configure Twilio Webhook:**
- In your Twilio console, set your phone number's webhook URL to: `https://your-ngrok-url.ngrok-free.app/incoming-call`

**Note:** ngrok URLs change on each restart unless you have a paid plan with reserved domains.

#### 3. Audio Processing
Requires ffmpeg and sox for audio handling.

#### Voice Swarm Characteristics

Voice swarms operate differently from text swarms:

- Event-driven architecture using WebSockets
- Real-time audio streaming via VoIP
- Cannot use `runOnce()` or batch processing
- Require active sessions for operation
- Use Twilio as VoIP provider for phone call integration

## Database Access

SwarmJS includes a SQLite database for DAG (Directed Acyclic Graph) storage:

```bash
# Open the database
sqlite3 dags.db

# Query all records
SELECT * FROM dags;
```

## Building and Deployment

```bash
# Build for production
npm run build

# Run compiled version
node dist/examples/customerAgentCarDealer.js

# Test the build
npm test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

Please ensure your code follows the project's TypeScript and ESLint conventions.

## License

MIT License - see LICENSE for details

## Support

For support, please open an issue in the GitHub repository.
