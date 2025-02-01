import { Twilio } from 'twilio';

// Retrieve credentials from environment variables for security
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = new Twilio(accountSid, authToken);

client.calls
  .create({
    url: 'http://demo.twilio.com/docs/voice.xml', // A URL that returns TwiML
    to: '+xxxxx', // Replace with the recipient's phone number in E.164 format
    from: '+xxxxxxx', // Replace with your Twilio phone number in E.164 format
  })
  .then((call) => console.log('Call SID:', call.sid))
  .catch((error) => console.error('Error placing call:', error));
