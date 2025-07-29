const { config } = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
config();

/**
 * Simple verification script for LocalVoiceSwarm setup
 */
async function simpleVerify() {
  console.log('🔍 Simple LocalVoiceSwarm Verification');
  console.log('======================================\n');

  let allPassed = true;

  // Test 1: Environment Variables
  console.log('1. Environment Variables:');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('   ❌ OPENAI_API_KEY is missing');
    allPassed = false;
  } else {
    console.log(`   ✅ OPENAI_API_KEY is set`);
  }

  // Test 2: OpenAI API Access
  console.log('\n2. OpenAI API Access:');
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG,
    });

    // Test basic API access with a simple request
    console.log('   🔄 Testing API connection...');
    const response = await openai.models.list();
    console.log(`   ✅ OpenAI API accessible (${response.data.length} models available)`);

  } catch (error) {
    console.log(`   ❌ OpenAI API test failed: ${error.message}`);
    allPassed = false;
  }

  // Test 3: Project Structure
  console.log('\n3. Project Structure:');
  
  const requiredFiles = [
    'src/core/LocalVoiceSwarm.ts',
    'src/core/LocalVoiceIOManager.ts',
    'src/types/voice.ts',
    'examples/voice-qa/local-voice-qa.ts',
    'examples/voice-qa/README.md'
  ];

  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      console.log(`   ✅ ${file} exists`);
    } else {
      console.log(`   ❌ ${file} missing`);
      allPassed = false;
    }
  }

  // Test 4: Dependencies
  console.log('\n4. Dependencies:');
  
  try {
    require('ws');
    console.log('   ✅ ws (WebSocket) library available');
  } catch (error) {
    console.log('   ❌ ws library not available');
    allPassed = false;
  }

  try {
    require('openai');
    console.log('   ✅ openai library available');
  } catch (error) {
    console.log('   ❌ openai library not available');
    allPassed = false;
  }

  // Test 5: Build Status
  console.log('\n5. Build Status:');
  
  if (fs.existsSync('dist')) {
    console.log('   ✅ dist directory exists');
  } else {
    console.log('   ⚠️  dist directory missing - run "npm run build"');
  }

  // Test 6: Package Scripts
  console.log('\n6. Package Scripts:');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (packageJson.scripts['voice-qa']) {
      console.log('   ✅ voice-qa script available');
    } else {
      console.log('   ❌ voice-qa script missing');
      allPassed = false;
    }
  } catch (error) {
    console.log('   ❌ Could not read package.json');
    allPassed = false;
  }

  // Summary and Instructions
  console.log('\n📋 Summary & Next Steps');
  console.log('========================');
  
  if (allPassed) {
    console.log('🎉 Setup verification passed!');
    console.log('\n🚀 Ready to test LocalVoiceSwarm:');
    console.log('');
    console.log('Option 1 - Build and run (recommended):');
    console.log('  npm run build');
    console.log('  npm run voice-qa');
    console.log('');
    console.log('Option 2 - Browser testing:');
    console.log('  cd examples/voice-qa');
    console.log('  node server.js');
    console.log('  # Then open http://localhost:3000');
    console.log('');
    console.log('⚠️  Note: The voice features require browser APIs');
    console.log('   The Node.js version will test core functionality');
    console.log('   Full voice interaction needs a browser environment');
    
  } else {
    console.log('⚠️  Some issues found. Please fix:');
    console.log('');
    console.log('Common fixes:');
    console.log('• Set OPENAI_API_KEY in .env file');
    console.log('• Run: npm install');
    console.log('• Run: npm run build');
    console.log('• Check OpenAI API access');
  }

  console.log('\n🎤 Voice Testing Notes:');
  console.log('• LocalVoiceSwarm requires microphone access');
  console.log('• Browser testing needs HTTPS for getUserMedia');
  console.log('• OpenAI Realtime API may require special access');
  console.log('• Use Chrome/Firefox for best browser compatibility');
}

// Run verification
simpleVerify().catch(console.error);