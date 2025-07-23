import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import path from 'path';
import { BANK_SWARM_SYSTEM_MESSAGE } from './prompts';
import {
  handleOpenAIMessage,
  handleTwilioMessage,
  handleClientConnection,
  broadcastToClients,
} from './handlers';
import { activeSessionData, clientConnections } from './data';

// Initialize configuration
config();

// Constants
const VOICE = 'alloy';
const systemMessage = BANK_SWARM_SYSTEM_MESSAGE;
const port = process.env.PORT || 3010;

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// HTTP routes
app.get('/index', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/session-data', (req, res) => {
  res.json(activeSessionData);
});

app.post('/api/pay-bill', (req, res) => {
  const { amount, recipient } = req.body;
  const { customerName, accountNumber } = activeSessionData;

  console.log(
    `Processing bill payment: ${amount} to ${recipient} for ${customerName}`
  );

  // Here you would actually process the payment
  // For now, we'll just acknowledge receipt
  res.json({
    success: true,
    message: `Payment of $${amount} to ${recipient} processed successfully`,
    transaction: {
      id: `TXN-${Date.now()}`,
      date: new Date().toISOString(),
      customerName,
      accountNumber,
      amount,
      recipient,
    },
  });
});

app.post('/incoming-call', (req, res) => {
  console.log('Incoming call received');
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    console.log('Call received');
    connect.stream({ url: `${process.env.HOSTNAME}/media-stream` });
    console.log('Stream connected at:', `${process.env.HOSTNAME}/media-stream`);
    res.type('text/xml');
    console.log('Response sent:', response.toString());
    res.send(response.toString());
  } catch (error) {
    console.error('Error processing call:', error);
    res.status(500).send('Error handling call');
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server for client communications
const clientWss = new WebSocketServer({
  noServer: true,
  path: '/client-updates',
});

// Handle client WebSocket connections
clientWss.on('connection', handleClientConnection);

// WebSocket server for Twilio communications
const twilioWss = new WebSocketServer({
  noServer: true,
  path: '/media-stream',
});

// Handle WebSocket upgrade for different endpoints
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`)
    .pathname;

  if (pathname === '/client-updates') {
    clientWss.handleUpgrade(request, socket, head, (ws) => {
      clientWss.emit('connection', ws, request);
    });
  } else if (pathname === '/media-stream') {
    twilioWss.handleUpgrade(request, socket, head, (ws) => {
      twilioWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle Twilio WebSocket connections
twilioWss.on('connection', (twilioWs) => {
  console.log('Twilio web socket connection established');
  let streamSid: string;

  // Generate a unique session ID for this connection
  const sessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // Update active session with the new session ID
  activeSessionData.sessionId = sessionId;
  activeSessionData.pendingAction = null;

  // Establish a WebSocket connection to OpenAI's Realtime API
  const openaiWs = new WebSocket(process.env.OPENAI_REALTIME_WS || '', {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'openai-beta': 'realtime=v1',
      'OpenAI-Organization': process.env.OPENAI_ORG || '',
    },
  });

  // Handle OpenAI WebSocket events
  openaiWs.on('open', () => {
    console.log('Connected to the OpenAI Realtime API');

    // Send session update after a short delay to ensure connection stability
    setTimeout(() => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 600,
            threshold: 0.6,
          },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: VOICE,
          instructions: systemMessage,
          modalities: ['text', 'audio'],
          tools: [
            {
              type: 'function',
              name: 'lookupCustomer',
              description: 'Look up customer information by name',
              parameters: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Customer name',
                  },
                  accountNumber: {
                    type: 'string',
                    description: 'Account number',
                  },
                },
              },
            },
            {
              type: 'function',
              name: 'checkBalance',
              description: 'Check customer balance',
              parameters: {
                type: 'object',
                properties: {
                  account: {
                    type: 'string',
                    description: 'Account number',
                  },
                },
              },
            },
            {
              type: 'function',
              name: 'payBills',
              description: 'Prepare bill payment form',
              parameters: {
                type: 'object',
                properties: {
                  customerName: {
                    type: 'string',
                    description: 'Customer name',
                  },
                  accountNumber: {
                    type: 'string',
                    description: 'Account number',
                  },
                },
              },
            },
            {
              type: 'function',
              name: 'provideBranchInfo',
              description: 'Provide branch information',
              parameters: {
                type: 'object',
                properties: {
                  zipCode: {
                    type: 'string',
                    description: 'Zip code',
                  },
                },
              },
            },
            {
              type: 'function',
              name: 'redirectToPayBillsForm',
              description: 'Redirect user to bill payment form',
              parameters: {
                type: 'object',
                properties: {
                  customerName: {
                    type: 'string',
                    description: 'Customer name',
                  },
                  accountNumber: {
                    type: 'string',
                    description: 'Account number',
                  },
                },
              },
            },
          ],
          tool_choice: 'auto',
          temperature: 0.8,
        },
      };
      console.log('Sending session update');
      openaiWs.send(JSON.stringify(sessionUpdate));
    }, 250);
  });

  // Handle messages from OpenAI
  openaiWs.on('message', (data) =>
    handleOpenAIMessage(data, openaiWs, twilioWs, streamSid)
  );

  // Handle errors from OpenAI
  openaiWs.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  // Handle messages from Twilio
  twilioWs.on('message', async (msg) => {
    const message = JSON.parse(msg.toString());

    if (message.event === 'start') {
      streamSid = message.start.streamSid;
    }

    handleTwilioMessage(message, openaiWs, streamSid);
  });

  // Handle Twilio WebSocket close
  twilioWs.on('close', () => {
    console.log('Twilio webSocket connection closed');
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Export for potential use in tests or other modules
export { server, broadcastToClients };
