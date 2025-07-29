import { config } from 'dotenv';

// Load environment variables
config();

/**
 * Verify setup and environment for LocalVoiceSwarm
 */
async function verifySetup() {
  console.log('🔍 Verifying LocalVoiceSwarm Setup');
  console.log('==================================\n');

  let allPassed = true;

  // Test 1: Environment Variables
  console.log('1. Checking environment variables...');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ OPENAI_API_KEY is missing');
    allPassed = false;
  } else {
    console.log(`✅ OPENAI_API_KEY is set (${process.env.OPENAI_API_KEY.substring(0, 10)}...)`);
  }

  if (process.env.OPENAI_ORG) {
    console.log(`✅ OPENAI_ORG is set (${process.env.OPENAI_ORG})`);
  } else {
    console.log('⚠️  OPENAI_ORG is not set (optional)');
  }

  // Test 2: OpenAI API Access
  console.log('\n2. Testing OpenAI API access...');
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG,
    });

    // Test basic API access
    const models = await openai.models.list();
    console.log(`✅ OpenAI API accessible (${models.data.length} models available)`);

    // Check for Realtime API model
    const realtimeModel = models.data.find(m => m.id.includes('realtime'));
    if (realtimeModel) {
      console.log(`✅ Realtime model found: ${realtimeModel.id}`);
    } else {
      console.log('⚠️  No realtime models found - you may need special access');
    }

  } catch (error) {
    console.log('❌ OpenAI API test failed:', error instanceof Error ? error.message : error);
    allPassed = false;
  }

  // Test 3: Node.js Dependencies
  console.log('\n3. Checking Node.js dependencies...');
  
  try {
    await import('ws');
    console.log('✅ WebSocket library (ws) available');
  } catch (error) {
    console.log('❌ WebSocket library (ws) not available');
    allPassed = false;
  }

  try {
    await import('dotenv');
    console.log('✅ dotenv library available');
  } catch (error) {
    console.log('❌ dotenv library not available');
    allPassed = false;
  }

  // Test 4: SwarmJS Core Components
  console.log('\n4. Checking SwarmJS components...');
  
  try {
    const { SwarmError } = await import('../../src/types/basic');
    console.log('✅ SwarmJS basic types available');
    
    // Test SwarmError
    const testError = new SwarmError('Test error', 'INITIALIZATION_ERROR');
    if (testError.name === 'SwarmError') {
      console.log('✅ SwarmError working correctly');
    }
  } catch (error) {
    console.log('❌ SwarmJS basic types not available:', error instanceof Error ? error.message : error);
    allPassed = false;
  }

  // Test 5: Voice Types
  try {
    const { LocalVoiceSwarmConfig } = await import('../../src/types/voice');
    console.log('✅ LocalVoice types available');
  } catch (error) {
    console.log('❌ LocalVoice types not available:', error instanceof Error ? error.message : error);
    allPassed = false;
  }

  // Test 6: Build Status
  console.log('\n5. Checking build status...');
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      console.log('✅ dist directory exists - project is built');
    } else {
      console.log('⚠️  dist directory missing - run "npm run build"');
    }
  } catch (error) {
    console.log('❌ Could not check build status');
  }

  // Test 7: Package.json Scripts
  console.log('\n6. Checking package.json scripts...');
  try {
    const fs = await import('fs');
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    
    if (packageJson.scripts['voice-qa']) {
      console.log('✅ voice-qa script available');
    } else {
      console.log('❌ voice-qa script missing');
      allPassed = false;
    }
    
    if (packageJson.scripts['build']) {
      console.log('✅ build script available');
    } else {
      console.log('❌ build script missing');
      allPassed = false;
    }
  } catch (error) {
    console.log('❌ Could not read package.json');
    allPassed = false;
  }

  // Summary
  console.log('\n📋 Verification Summary');
  console.log('========================');
  
  if (allPassed) {
    console.log('🎉 All checks passed! LocalVoiceSwarm is ready to use.');
    console.log('\nNext steps:');
    console.log('1. Run "npm run build" to ensure latest build');
    console.log('2. Run "npm run voice-qa" to start voice interaction');
    console.log('3. Make sure you have microphone access in your environment');
    console.log('4. For browser testing, you need HTTPS for microphone access');
  } else {
    console.log('⚠️  Some checks failed. Please address the issues above.');
    console.log('\nCommon fixes:');
    console.log('• Set OPENAI_API_KEY in your .env file');
    console.log('• Run "npm install" to install dependencies');
    console.log('• Run "npm run build" to build the project');
    console.log('• Check your OpenAI API access and organization settings');
  }
}

// Run the verification
verifySetup().catch(console.error);