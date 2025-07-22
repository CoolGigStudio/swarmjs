import express, { Request, Response } from 'express';
import { Twilio, twiml } from 'twilio';
import OpenAI from 'openai';
import ngrok from 'ngrok';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Twilio client
const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create temp directory for audio files
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Serve static files
app.use('/temp', express.static(tempDir));

interface CallRequest {
  phoneNumber: string;
}

// Helper function to generate and save TTS audio
async function generateAndSaveAudio(text: string): Promise<string> {
  // Generate audio
  const mp3Response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: text,
    response_format: 'mp3',
  });

  // Save to file
  const filename = `tts_${Date.now()}.mp3`;
  const filepath = path.join(tempDir, filename);

  const buffer = Buffer.from(await mp3Response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  return filename;
}

// Initialize test call
app.post(
  '/test-call',
  async (req: Request<{}, {}, CallRequest>, res: Response) => {
    const { phoneNumber } = req.body;

    try {
      console.log('Making test call to:', phoneNumber);
      console.log('Using webhook URL:', process.env.BASE_URL);

      const call = await twilioClient.calls.create({
        url: `${process.env.BASE_URL}/test-webhook`,
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER as string,
        statusCallback: `${process.env.BASE_URL}/test-status`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent: ['initiated', 'answered', 'completed'],
      });

      console.log('Test call initiated with SID:', call.sid);
      res.json({ success: true, callSid: call.sid });
    } catch (error) {
      console.error('Error initiating test call:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

// Handle test webhook
app.post('/test-webhook', async (req: Request, res: Response) => {
  console.log('Test webhook received:', req.body);
  const response = new twiml.VoiceResponse();

  const digits = req.body.Digits;

  try {
    if (digits) {
      // User pressed a digit
      console.log('Test digit received:', digits);

      // Generate and save TTS audio
      const filename = await generateAndSaveAudio(
        "This is a test of OpenAI's text to speech. You pressed " + digits
      );

      // Play both the TTS audio and the test sound
      response.play(`${process.env.BASE_URL}/temp/${filename}`);
      response.pause({ length: 1 });
      response.play('http://demo.twilio.com/docs/classic.mp3');
      response.pause({ length: 1 });
    }

    // Always gather next input
    response
      .gather({
        action: '/test-webhook',
        numDigits: 1,
        timeout: 10,
      })
      .say('Press any key to hear both sounds again.');

    console.log('Test TwiML Response:', response.toString());
    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    console.error('Error in test webhook:', error);
    response.say('Sorry, there was an error in the test. Goodbye.');
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
  }
});

// Handle test status updates
app.post('/test-status', (req: Request, res: Response) => {
  console.log('Test call status update:', req.body);
  res.sendStatus(200);
});

// Start test server
async function startTestServer() {
  try {
    const PORT = parseInt(process.env.PORT || '3001', 10); // Using different port
    const server = app.listen(PORT, () => {
      console.log(`Test server running on port ${PORT}`);
    });

    const useNgrok = process.env.USE_NGROK === 'true';
    if (useNgrok) {
      try {
        await ngrok.kill();
        const url = await ngrok.connect({
          addr: PORT,
          authtoken: process.env.NGROK_AUTH_TOKEN,
        });
        console.log(`\nTest ngrok tunnel established at: ${url}`);
        process.env.BASE_URL = url;
      } catch (ngrokError) {
        console.error('\nError setting up test ngrok:', ngrokError);
        process.env.BASE_URL = `http://localhost:${PORT}`;
      }
    } else {
      process.env.BASE_URL = `http://localhost:${PORT}`;
    }

    console.log('\nTest server is ready.');
    console.log('To make a test call, send a POST request to:');
    console.log(`${process.env.BASE_URL}/test-call`);
    console.log('with body: { "phoneNumber": "+1234567890" }');

    // Handle shutdown
    process.on('SIGTERM', async () => {
      console.log('Shutting down test server...');
      if (useNgrok) {
        await ngrok.kill();
      }
      server.close();
    });
  } catch (error) {
    console.error('Error starting test server:', error);
    process.exit(1);
  }
}

// Start the test server
if (require.main === module) {
  startTestServer().catch((error) => {
    console.error('Fatal error starting test server:', error);
    process.exit(1);
  });
}
