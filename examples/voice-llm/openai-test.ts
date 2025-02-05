import WebSocket from 'ws';
import { config } from 'dotenv';

config();

const API_URL = 'wss://api.openai.com/v1/realtime';

// Set up the headers. If you suspect the organization header may be causing the 403 error,
// try commenting it out.
const headers: Record<string, string> = {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  // Uncomment the following line only if your account requires it:
  'OpenAI-Organization': process.env.OPENAI_ORG || '',
};

console.log('Connecting to:', API_URL);

const ws = new WebSocket(API_URL, { headers });

ws.on('open', () => {
  console.log('Connected to OpenAI Realtime API.');
  // Optionally send a test message to see if the endpoint echoes something back.
  ws.send(JSON.stringify({ message: 'Hello from test client.' }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});

ws.on('close', () => {
  console.log('WebSocket connection closed.');
});
