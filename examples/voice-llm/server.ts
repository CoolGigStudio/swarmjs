import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

/**
 * POST /incoming-call
 * Responds to Twilio’s incoming call webhook with TwiML that opens a media stream.
 */
app.post('/incoming-call', (req, res) => {
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    console.log('Call received');
    // Make sure HOSTNAME includes the protocol (e.g. "wss://")
    connect.stream({ url: `${process.env.HOSTNAME}/media-stream` });
    console.log('Stream connected at:', `${process.env.HOSTNAME}/media-stream`);
    res.type('text/xml');
    console.log('Response sent:', response.toString());
    res.send(response.toString());
  } catch (error) {
    console.error('Error processing call:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Create an HTTP server and attach Express app
const server = createServer(app);

// Create a WebSocket server on the /media-stream endpoint for handling Twilio connections
const wss = new WebSocketServer({ server, path: '/media-stream' });

// Queue to hold messages until the OpenAI connection is ready.
const messageQueue: string[] = [];

// Silence threshold in milliseconds.
const SILENCE_THRESHOLD_MS = 2000;

wss.on('connection', (clientWs: WebSocket) => {
  console.log('Twilio Media Stream connection established');

  // Establish a WebSocket connection to OpenAI's Realtime API.
  const openaiWs = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01',
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'openai-beta': 'realtime=v1',
        'OpenAI-Organization': process.env.OPENAI_ORG || '',
      },
    }
  );

  // Conversation history can be maintained if needed.
  let conversationHistory: string[] = [];

  // Timestamp of the last significant (non-silent) audio.
  let lastSignificantTimestamp: number | null = null;

  // Buffer for accumulating audio/text if needed.
  let questionBuffer = '';

  // When OpenAI connection is open, send a greeting and flush any queued messages.
  openaiWs.on('open', () => {
    console.log('Connected to OpenAI Realtime API');
    const greetingMessage = 'I am AI, you can ask me any question.';
    conversationHistory.push(`AI: ${greetingMessage}`);
    clientWs.send(
      JSON.stringify({
        event: 'transcription',
        text: greetingMessage,
      })
    );
    while (messageQueue.length > 0) {
      const queuedMsg = messageQueue.shift();
      if (queuedMsg) {
        openaiWs.send(queuedMsg);
      }
    }
  });

  // Function to send the commit event.
  const sendAudioCommit = () => {
    const commitMessage = JSON.stringify({
      type: 'input_audio_buffer.commit',
    });
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(commitMessage);
    } else {
      messageQueue.push(commitMessage);
    }
  };

  // Utility: Compute average amplitude from a base64-encoded audio payload.
  function computeAverageAmplitude(audioPayload: string): number {
    const buffer = Buffer.from(audioPayload, 'base64');
    let total = 0;
    for (const byte of buffer) {
      total += byte;
    }
    return total / buffer.length;
  }

  // Handle incoming messages from Twilio's media stream.
  clientWs.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'start') {
        console.log('Media stream started');
      } else if (data.event === 'media') {
        const audioPayload = data.media.payload;
        const avgAmplitude = computeAverageAmplitude(audioPayload);
        console.log(`Average amplitude: ${avgAmplitude}`);

        // Check if the audio chunk is significant (i.e. likely speech).
        if (avgAmplitude < 254) {
          // Adjust threshold as necessary.
          lastSignificantTimestamp = Date.now();
          // Append or process as needed (e.g., accumulate audio data if desired).
          questionBuffer += ' ' + audioPayload;
          // Forward the audio chunk to OpenAI.
          const audioMessage = JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: audioPayload,
          });
          if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.send(audioMessage);
          } else {
            messageQueue.push(audioMessage);
          }
        } else {
          // If amplitude indicates silence, check how long we've been silent.
          if (lastSignificantTimestamp) {
            const elapsed = Date.now() - lastSignificantTimestamp;
            if (elapsed >= SILENCE_THRESHOLD_MS) {
              console.log(
                'Silence detected for',
                elapsed,
                'ms, sending commit'
              );
              sendAudioCommit();
              // Optionally clear questionBuffer if you want to start fresh.
              questionBuffer = '';
              // Reset timestamp so that subsequent silent chunks don't trigger repeatedly.
              lastSignificantTimestamp = null;
            }
          } else {
            // No significant audio has been received recently.
          }
        }
      } else if (data.event === 'stop') {
        console.log('Media stream stopped');
        // Commit any remaining audio data.
        sendAudioCommit();
        clientWs.close();
        openaiWs.close();
      }
    } catch (error) {
      console.error('Error processing Twilio message:', error);
    }
  });

  // Handle responses from OpenAI.
  openaiWs.on('message', (data: WebSocket.Data) => {
    const responseText = data.toString();
    console.log('Received from OpenAI:', responseText);
    conversationHistory.push(`AI: ${responseText}`);
    const responseMessage = JSON.stringify({
      event: 'transcription',
      text: responseText,
    });
    clientWs.send(responseMessage);
  });

  openaiWs.on('error', (error: Error) => {
    console.error('OpenAI WebSocket error:', error);
  });

  clientWs.on('close', () => {
    console.log('Twilio connection closed');
    openaiWs.close();
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
