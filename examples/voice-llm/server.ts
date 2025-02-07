import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

config();

const SYSTEM_MESSAGE =
  'You are a helpful AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts.';
const VOICE = 'alloy';
const LOG_EVENT_TYPES = [
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
];

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

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

const server = createServer(app);

const twilioWss = new WebSocketServer({ server });

twilioWss.on('connection', (twilioWs) => {
  console.log('Twilio web socket connection established');
  let streamSid: string;

  // Conversation history can be maintained if needed.
  // let conversationHistory: string[] = [];

  // // Timestamp of the last significant (non-silent) audio.
  // let lastSignificantTimestamp: number | null = null;

  // // Buffer for accumulating audio/text if needed.
  // let questionBuffer = '';

  // Establish a WebSocket connection to OpenAI's Realtime API.
  const openaiWs = new WebSocket(process.env.OPENAI_REALTIME_WS || '', {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'openai-beta': 'realtime=v1',
      'OpenAI-Organization': process.env.OPENAI_ORG || '',
    },
  });

  const sendSessionUpdate = () => {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: VOICE,
        instructions: SYSTEM_MESSAGE,
        modalities: ['text', 'audio'],
        tools: [
          {
            type: 'function',
            name: 'get_current_time',
            description: 'Get the current time',
            parameters: {
              type: 'object',
              properties: {
                timezone: {
                  type: 'string',
                  description: 'The timezone to get the time in',
                },
              },
            },
          },
          {
            type: 'function',
            name: 'get_current_weather',
            description: 'Get the current weather for a specific city or area',
            parameters: {
              type: 'object',
              properties: {
                timezone: {
                  type: 'string',
                  description: 'The city or area to get the weather in',
                },
              },
            },
          },
        ],
        tool_choice: 'auto',
        temperature: 0.8,
      },
    };
    console.log('Sending session update:', JSON.stringify(sessionUpdate));
    openaiWs.send(JSON.stringify(sessionUpdate));
  };

  // Open event for OpenAI WebSocket
  openaiWs.on('open', () => {
    console.log('Connected to the OpenAI Realtime API');
    setTimeout(sendSessionUpdate, 250); // Ensure connection stability, send after .25 seconds
  });

  openaiWs.on('message', (data: WebSocket.RawData) => {
    try {
      let jsonString: string;
      if (typeof data === 'string') {
        jsonString = data;
      } else if (data instanceof Buffer) {
        jsonString = data.toString('utf-8');
      } else if (data instanceof ArrayBuffer) {
        jsonString = Buffer.from(data).toString('utf-8');
      } else {
        throw new Error('Unsupported data type');
      }

      const response = JSON.parse(jsonString);
      if (LOG_EVENT_TYPES.includes(response.type)) {
        console.log(`Received event: ${response.type}`, response);
      }
      if (response.type === 'session.updated') {
        console.log('Session updated successfully:', response);
      }
      if (response.type === 'response.audio.delta' && response.delta) {
        console.log('Received audio delta.');
        const audioDelta = {
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: Buffer.from(response.delta, 'base64').toString('base64'),
          },
        };
        twilioWs.send(JSON.stringify(audioDelta));
      }
    } catch (error) {
      console.error(
        'Error processing OpenAI message:',
        error,
        'Raw message:',
        data
      );
    }
  });

  openaiWs.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  twilioWs.on('message', async (msg) => {
    const message = JSON.parse(msg.toString());

    switch (message.event) {
      case 'start':
        streamSid = message.start.streamSid;
        console.log('Twilio stream started:', streamSid);

        /* // Commit the real-time event to OpenAI after 10 seconds.
        setTimeout(() => {
          console.log('Committing real-time event to OpenAI');
          if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.send(
              JSON.stringify({
                type: 'input_audio_buffer.commit',
              })
            );
            openaiWs.send(JSON.stringify({ type: 'response.create' }));
          }
        }, 10000); */
        break;

      // In the message handler for 'media' event:
      // In the server.ts file, update the media event handler:
      case 'media':
        if (openaiWs.readyState === WebSocket.OPEN) {
          const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: message.media.payload,
          };
          openaiWs.send(JSON.stringify(audioAppend));
        }
        break;

      case 'stop':
        console.log('Twilio stream stopped');
        openaiWs.close();
        break;
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio webSocket connection closed');
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
