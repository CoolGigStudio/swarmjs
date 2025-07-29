# Local Voice Q&A Example

This example demonstrates how to use SwarmJS's LocalVoiceSwarm to create a voice-enabled assistant that can answer questions and perform tasks using OpenAI's Realtime API.

## Features

- 🎤 **Real-time voice interaction** using WebSocket connection to OpenAI's Realtime API
- 🔊 **Audio playback** through browser speakers
- 🛠️ **Tool calling** for time, weather, and calculations
- 🎯 **Local audio processing** using getUserMedia and MediaRecorder
- 🗣️ **Natural conversation** with GPT-4o Realtime model

## Prerequisites

1. **Node.js 18+** installed
2. **OpenAI API key** with access to Realtime API
3. **Modern browser** with microphone support
4. **HTTPS connection** (required for microphone access)

## Setup

1. **Environment Variables**
   Create a `.env` file in the project root:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_ORG_ID=your_organization_id_here  # Optional
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

## Running the Example

### Command Line Version
```bash
npm run voice-qa
```

### Browser Version
1. Open `voice-qa.html` in a modern browser
2. Click "Start Voice Session"
3. Allow microphone access when prompted
4. Start speaking!

## Available Voice Commands

Try these example phrases:

### Time & Date
- "What time is it?"
- "What's today's date?"

### Weather Information
- "What's the weather in San Francisco?"
- "Tell me about the weather in New York"
- "How's the weather in London?"

### Math Calculations
- "Calculate 15 times 7"
- "What's 25 plus 30?"
- "Solve 100 divided by 4"

### General Conversation
- "Hello, how are you?"
- "Tell me a joke"
- "What can you help me with?"

## Architecture

### LocalVoiceSwarm
- Extends `AbstractSwarm` for voice-specific functionality
- Manages voice sessions with WebSocket connections
- Handles tool calling in voice context
- Supports multiple simultaneous voice sessions

### LocalVoiceIOManager
- Manages WebSocket connections to OpenAI's Realtime API
- Handles audio input via `getUserMedia` and `MediaRecorder`
- Processes audio output through Web Audio API
- Implements real-time audio streaming

### Voice Agent Configuration
```typescript
{
  name: 'VoiceAssistant',
  voice: 'alloy', // OpenAI voice model
  systemMessage: 'You are a helpful voice assistant...',
  allowedTools: ['getCurrentTime', 'getWeather', 'calculateMath'],
  temperature: 0.8,
  enableTranscription: true,
  turnDetection: {
    type: 'server_vad',
    silence_duration_ms: 800,
    threshold: 0.6,
  }
}
```

## Technical Details

### Audio Processing
- **Input**: Microphone → MediaRecorder → Base64 → OpenAI
- **Output**: OpenAI → Base64 → AudioContext → Speakers
- **Format**: 24kHz, mono, WebM/Opus encoding
- **Latency**: Optimized for real-time interaction

### WebSocket Communication
- Direct connection to `wss://api.openai.com/v1/realtime`
- Authentication via Bearer token
- Real-time bidirectional audio streaming
- Tool calling support with JSON responses

### Browser Compatibility
- Chrome 66+
- Firefox 60+
- Safari 11.1+
- Edge 79+

## Troubleshooting

### Common Issues

1. **Microphone Access Denied**
   - Ensure HTTPS connection (required for getUserMedia)
   - Check browser permissions
   - Try refreshing and allowing access

2. **WebSocket Connection Failed**
   - Verify OpenAI API key is valid
   - Check network connectivity
   - Ensure Realtime API access

3. **No Audio Output**
   - Check browser audio permissions
   - Verify speakers/headphones are connected
   - Try different audio format in config

4. **Tool Calls Not Working**
   - Verify tool definitions match agent config
   - Check tool handler implementations
   - Review console logs for errors

### Debug Mode

Enable debug logging:
```bash
DEBUG=true npm run voice-qa
```

### Network Requirements

- Outbound HTTPS (443) for OpenAI API
- WebSocket support for real-time communication
- Microphone permissions in browser

## Extending the Example

### Adding New Tools
```typescript
const newTool: ToolDefinition = {
  function: {
    name: 'myCustomTool',
    description: 'Description of what the tool does',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'Parameter description' }
      },
      required: ['param1']
    }
  },
  handler: async (args) => {
    // Implementation
    return { result: 'Tool result' };
  }
};
```

### Using Different Voices
Available voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`

```typescript
{
  voice: 'sage', // Try different voices
}
```

### Customizing Audio Settings
```typescript
{
  audio: {
    sampleRate: 24000,
    channels: 1,
    enableEchoCancellation: true,
    enableNoiseSuppression: true,
    enableAutoGainControl: true,
  }
}
```

## Performance Tips

1. **Use prompt caching** to reduce costs
2. **Optimize audio settings** for your use case
3. **Implement proper error handling** for network issues
4. **Consider rate limiting** for production use

## Security Considerations

- Store API keys securely (use environment variables)
- Implement proper authentication for production
- Consider audio data privacy implications
- Use HTTPS for all connections

## Next Steps

- Explore the full SwarmJS framework documentation
- Try the Twilio VoIP integration for phone calls
- Build custom voice agents for specific use cases
- Integrate with other AI services and APIs

## Support

For issues and questions:
- Check the SwarmJS documentation
- Review the troubleshooting section above
- Open an issue in the project repository