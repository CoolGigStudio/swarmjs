import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import {
  decodeMuLaw,
  encodeMuLaw,
  resamplePCM,
  isBufferSilent,
} from './audio-utils';

config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.post('/incoming-call', (req, res) => {
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
  // Establish a WebSocket connection to OpenAI's Realtime API.
  const openaiWs = new WebSocket(process.env.OPENAI_REALTIME_WS || '', {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'openai-beta': 'realtime=v1',
      'OpenAI-Organization': process.env.OPENAI_ORG || '',
    },
  });

  // Conversation history can be maintained if needed.
  // let conversationHistory: string[] = [];

  // // Timestamp of the last significant (non-silent) audio.
  // let lastSignificantTimestamp: number | null = null;

  // // Buffer for accumulating audio/text if needed.
  // let questionBuffer = '';

  // When OpenAI connection is open, send a greeting and flush any queued messages.
  openaiWs.on('open', () => {
    console.log('Connected to OpenAI real-time API: ', openaiWs.readyState);
    // Need to add more here.
  });

  twilioWs.on('message', async (msg) => {
    const message = JSON.parse(msg.toString());

    switch (message.event) {
      case 'start':
        streamSid = message.start.streamSid;
        console.log('Twilio stream started:', streamSid);
        break;

      // In the message handler for 'media' event:
      // In the server.ts file, update the media event handler:
      case 'media':
        try {
          console.log(
            'Received media payload, length:',
            message.media.payload.length
          );
          const mulawBuffer = Buffer.from(message.media.payload, 'base64');
          console.log('Decoded mulaw buffer length:', mulawBuffer.length);

          const pcmAudio = decodeMuLaw(mulawBuffer);
          console.log('Decoded PCM buffer length:', pcmAudio.length);

          // Add debug log for silence detection
          const isSilent = isBufferSilent(pcmAudio);
          console.log('Is audio silent?', isSilent);

          if (pcmAudio.length >= 2 && !isSilent) {
            console.log('Processing non-silent audio...');
            const pcm16k = await resamplePCM(pcmAudio, 8000, 16000);
            console.log('Resampled PCM buffer length:', pcm16k.length);

            if (openaiWs.readyState === WebSocket.OPEN && pcm16k.length > 0) {
              console.log('Sending audio to OpenAI, length:', pcm16k.length);
              openaiWs.send(pcm16k);
            } else {
              console.log('Not sending to OpenAI:', {
                wsOpen: openaiWs.readyState === WebSocket.OPEN,
                bufferLength: pcm16k.length,
              });
            }
          } else {
            console.log('Skipping audio processing:', {
              bufferLength: pcmAudio.length,
              isSilent,
            });
          }
        } catch (err) {
          console.error('Error processing audio:', err);
        }
        break;

      case 'stop':
        console.log('Twilio stream stopped');
        openaiWs.close();
        break;
    }
  });

  openaiWs.on('message', async (data: WebSocket.Data) => {
    // Ensure data is a Buffer before processing
    if (Buffer.isBuffer(data)) {
      try {
        // Convert AI-generated PCM 16kHz audio to µ-law for Twilio
        const pcm8k = await resamplePCM(data as Buffer, 16000, 8000);
        const mulawData = encodeMuLaw(pcm8k);

        if (streamSid) {
          twilioWs.send(
            JSON.stringify({
              event: 'media',
              streamSid: streamSid,
              media: { payload: mulawData.toString('base64') },
            })
          );
        }
      } catch (err) {
        console.error('Error processing OpenAI audio:', err);
      }
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
