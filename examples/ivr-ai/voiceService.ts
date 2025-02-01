import { GptSwarm } from '../../src/core/GptSwarm';
import { swarmConfig } from './config';
import OpenAI from 'openai';
import { activeCalls } from './config';
import { Twilio } from 'twilio';

// Initialize Twilio
const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize GptSwarm
export const swarm = new GptSwarm();

export async function initiateCall(
  phoneNumber: string
): Promise<{ callSid: string }> {
  try {
    // Initialize swarm
    await swarm.init(swarmConfig);

    // Create a new session
    const flow = await swarm.createSession(swarmConfig.agents[0].name);

    const initialScript = `
      # Customer Interaction Initialization
      $1 = customerChatVoice(message: "Hello! Welcome to our car dealership. Could you please provide your authentication ID?")

      # Customer Information Lookup
      $2 = lookupCustomer(authId: $1)

      # Confirm Customer Details
      $3 = customerChatVoice(message: "Thank you! Let me confirm your details: $2. Is everything correct?")

      # Check for Appointment Needs
      $4 = customerChatVoice(message: "Would you like to book an appointment with us?")

      # Determine Next Steps Based on Customer Response
      # If customer wants to book an appointment, proceed with availability check
      # Hierarchical Task: Appointment Booking Process
          # Get Current and Earliest Available Dates
          $5 = getEarliestAvailableDate()

          # Check Available Slots for the Earliest Date
          $6 = checkAvailableSlots(date: $5.earliestDate)

          # Present Options to Customer
          $7 = customerChatVoice(message: "Here are the available slots for $5.earliestDate: $6. Please choose one.")

          # Book the Appointment
          $8 = bookAppointment(date: $5.earliestDate, time: $7, authId: $1)

          # Confirm Booking Details
          $9 = customerChatVoice(message: "Your appointment is confirmed for $5.earliestDate at $7. Thank you!")

      # End of Customer Interaction
      $10 = terminateCall(message: "Thank you for choosing our dealership. Have a great day!")
    `;

    // Make the actual Twilio call
    console.log('Making outbound call to:', phoneNumber);
    console.log('Using webhook URL:', process.env.BASE_URL);

    const call = await twilioClient.calls.create({
      url: `${process.env.BASE_URL}/voice-webhook`,
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER as string,
      statusCallback: `${process.env.BASE_URL}/status-callback`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
    });

    console.log('Call initiated with SID:', call.sid);

    // Store the mapping between call SID and flow ID
    activeCalls.set(call.sid, {
      response: null,
      resolve: () => {}, // Will be set when needed
    });

    // Start the conversation script
    // We don't await this as it will be driven by webhook callbacks
    swarm
      .runSession(flow.id, 'Start customer interaction', {
        script: initialScript,
      })
      .catch((error) => {
        console.error('Error in swarm session:', error);
      });

    return { callSid: call.sid };
  } catch (error) {
    throw new Error(
      `Failed to initiate call: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function handleCustomerResponse(
  callSid: string,
  recordingUrl: string
): Promise<string> {
  try {
    // Convert speech to text
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await fetch(recordingUrl);
    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const file = new File([blob], 'audio.wav', { type: 'audio/wav' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });

    // Resolve the waiting customerChatVoice promise with the transcribed text
    const currentCall = activeCalls.get(callSid);
    if (currentCall) {
      currentCall.resolve(transcription.text);
      return currentCall.response;
    }

    throw new Error('No active call found');
  } catch (error) {
    throw new Error(
      `Error handling customer response: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function endCall(callSid: string): Promise<void> {
  activeCalls.delete(callSid);
  await swarm.endSession(callSid);
}
