const WebSocket = require('ws');
const { config } = require('dotenv');

// Load environment variables
config();

/**
 * Quick test to see current server behavior
 */
async function checkServerLogs() {
  console.log('🔍 Checking Server Logs - Quick Test');
  console.log('===================================');
  
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.log('❌ OPENAI_API_KEY not found in environment');
    return;
  }
  
  console.log('🔄 Connecting to proxy server...');
  console.log('⏰ Timestamp:', new Date().toLocaleTimeString());
  
  const ws = new WebSocket('ws://localhost:3001/voice-proxy');
  
  ws.on('open', () => {
    console.log('✅ Connected to proxy server');
    console.log('📤 Sending proxy_setup message...');
    console.log('⏰ Setup timestamp:', new Date().toLocaleTimeString());
    
    // Send setup message
    ws.send(JSON.stringify({
      type: 'proxy_setup',
      apiKey: apiKey
    }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📥 Received:', message.type, 'at', new Date().toLocaleTimeString());
      
      if (message.type === 'proxy_connected') {
        console.log('✅ SUCCESS: Proxy working perfectly!');
        console.log('⏰ Test completed at:', new Date().toLocaleTimeString());
        setTimeout(() => ws.close(), 1000);
      }
    } catch (error) {
      console.log('❌ Parse error:', error.message);
    }
  });
  
  ws.on('close', () => {
    console.log('🔗 Connection closed at:', new Date().toLocaleTimeString());
    process.exit(0);
  });
  
  setTimeout(() => {
    console.log('⏰ Test timeout');
    ws.close();
  }, 5000);
}

checkServerLogs().catch(console.error);