const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { config } = require('dotenv');

// Load environment variables from root .env file
config({ path: '../../.env' });

const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// Serve the proxy voice app (correct version)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'proxy-voice-app.html'));
});

// WebSocket server for client connections
const wss = new WebSocket.Server({ server, path: '/voice-proxy' });

// Configuration from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_WS_URL = process.env.OPENAI_REALTIME_WS || `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

console.log('🎤 Voice Proxy Server Starting...');
console.log('===================================');
console.log('🔧 Configuration:');
console.log(`📱 Model: ${REALTIME_MODEL}`);
console.log(`🔗 WebSocket URL: ${REALTIME_WS_URL}`);
console.log(`🔑 API Key: ${OPENAI_API_KEY ? 'Loaded from .env' : 'NOT FOUND'}`);
console.log('===================================');

// Handle client connections
wss.on('connection', (clientWs, req) => {
  console.log('👤 Client connected to voice proxy');

  let openAIWs = null;
  let sessionCreatedSent = false;
  let currentVoice = 'alloy'; // Track current voice selection

  clientWs.on('message', async (data) => {
    try {
      // Check if this is binary audio data or JSON message
      let message;
      let isAudioData = false;

      try {
        message = JSON.parse(data.toString());
      } catch (parseError) {
        // This is binary audio data, not JSON
        isAudioData = true;
      }

      // Handle proxy setup message from client
      if (!isAudioData && message.type === 'proxy_setup') {
        if (!OPENAI_API_KEY) {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              error: { message: 'OpenAI API key not configured in server environment' },
            })
          );
          return;
        }

        console.log('🔄 Setting up OpenAI connection...');
        console.log('🔄 Creating WebSocket connection with system message approach...');
        console.log(`🔑 Using API key from .env: ${OPENAI_API_KEY.substring(0, 20)}...`);
        console.log(`📱 Using model: ${REALTIME_MODEL}`);

        openAIWs = new WebSocket(REALTIME_WS_URL, {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'openai-beta': 'realtime=v1',
          },
        });

        openAIWs.on('open', () => {
          console.log('✅ Connected to OpenAI Realtime API');
          console.log(
            '⏳ Waiting for session.created before confirming to client...'
          );
          // Don't send proxy_connected yet - wait for session.created first
        });

        openAIWs.on('message', (openAIData) => {
          // Log and forward OpenAI messages to client with enhanced debugging
          try {
            const dataString = openAIData.toString();

            // Check if this is valid JSON first
            const message = JSON.parse(dataString);
            console.log('📥 OpenAI message:', message.type);
            console.log('🔍 Client WebSocket state:', clientWs.readyState);
            console.log(
              '🔍 Client connection open?',
              clientWs.readyState === WebSocket.OPEN
            );

            // Special handling for session.created
            if (message.type === 'session.created') {
              console.log('🎯 CRITICAL: session.created received from OpenAI');
              console.log(
                '🎯 Full session.created message:',
                JSON.stringify(message, null, 2)
              );
            }

            // Option 3: Intercept speech_stopped to send custom response.create
            if (message.type === 'input_audio_buffer.speech_stopped') {
              console.log(
                '🎯 Speech stopped - sending custom response.create with instructions (Option 3)'
              );

              // Send our own response.create with custom instructions AND tools (Option 3)
              const createResponseEvent = {
                type: 'response.create',
                response: {
                  modalities: ['text', 'audio'],
                  voice: currentVoice, // Include current voice selection
                  instructions:
                    "You are a helpful voice assistant. Always respond with speech/audio in English, not text. Keep responses conversational and concise. Be friendly and engaging. You should use the tools provided to you to get the information you need to answer the user's question.",
                  // Provide tools available for this response (response.create format)
                  tools: [
                    {
                      type: 'function',
                      name: 'getCurrentTime',
                      description:
                        'Get the current time and date for a specific city',
                      parameters: {
                        type: 'object',
                        properties: {
                          city: {
                            type: 'string',
                            description: 'The city name to get time for',
                          },
                        },
                        required: ['city'],
                      },
                    },
                    {
                      type: 'function',
                      name: 'getWeather',
                      description: 'Get current weather information for a city',
                      parameters: {
                        type: 'object',
                        properties: {
                          city: {
                            type: 'string',
                            description: 'The city name to get weather for',
                          },
                        },
                        required: ['city'],
                      },
                    },
                    {
                      type: 'function',
                      name: 'retrieveInterviewCode',
                      description:
                        'This is the tool that will retrieve the code from the user for you to review',
                      parameters: {
                        type: 'object',
                        properties: {
                          topic: {
                            type: 'string',
                            description: 'The topic for the code to retrieve',
                          },
                        },
                        required: ['userName'],
                      },
                    },
                  ],
                  // Select how the model should use the tools
                  tool_choice: 'auto',
                }
              };


              openAIWs.send(JSON.stringify(createResponseEvent));
              console.log(
                '✅ Custom response.create sent with instructions AND tools'
              );

              // Still forward the original speech_stopped message to client
              clientWs.send(dataString);
              console.log('✅ speech_stopped forwarded to client');
              return;
            }

            // Handle tool calls from function_call items
            if (message.type === 'response.output_item.done') {
              const { item } = message;
              if (item.type === 'function_call') {
                console.log(
                  `🔧 Tool call detected: ${item.name} with args: ${item.arguments}`
                );

                if (item.name === 'getCurrentTime') {
                  const args = JSON.parse(item.arguments);
                  const city = args.city || 'Unknown';

                  let result;
                  if (city.toLowerCase().includes('san jose')) {
                    const now = new Date();
                    result = {
                      city: city,
                      currentTime: now.toLocaleTimeString(),
                      currentDate: now.toLocaleDateString(),
                      timestamp: now.toISOString(),
                      message: `Current time in ${city} is ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}`,
                    };
                    console.log(`✅ getCurrentTime: Provided time for ${city}`);
                  } else {
                    result = {
                      city: city,
                      message: "We don't have the information.",
                      error: true,
                    };
                    console.log(
                      `❌ getCurrentTime: No information available for ${city}`
                    );
                  }

                  const toolResponse = {
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: item.call_id,
                      output: JSON.stringify(result),
                    },
                  };

                  openAIWs.send(JSON.stringify(toolResponse));
                  openAIWs.send(JSON.stringify({ 
                    type: 'response.create',
                    response: {
                      voice: currentVoice
                    }
                  }));
                  console.log('✅ getCurrentTime tool result sent');
                } else if (item.name === 'getWeather') {
                  const args = JSON.parse(item.arguments);
                  const city = args.city || 'Unknown';

                  // Mock weather data
                  const result = {
                    city: city,
                    temperature: city.toLowerCase().includes('san francisco')
                      ? '68°F'
                      : '72°F',
                    condition: city.toLowerCase().includes('san francisco')
                      ? 'Foggy'
                      : 'Sunny',
                    humidity: '65%',
                    message: `Weather in ${city}: ${city.toLowerCase().includes('san francisco') ? '68°F and Foggy' : '72°F and Sunny'}`,
                  };

                  const toolResponse = {
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: item.call_id,
                      output: JSON.stringify(result),
                    },
                  };

                  openAIWs.send(JSON.stringify(toolResponse));
                  openAIWs.send(JSON.stringify({ 
                    type: 'response.create',
                    response: {
                      voice: currentVoice
                    }
                  }));
                  console.log(`✅ getWeather tool result sent for ${city}`);
                } else if (item.name === 'retrieveInterviewCode') {
                  const args = JSON.parse(item.arguments);
                  const topic = args.topic || 'general';

                  // Retrieve interview code example for review
                  const longPythonCode = `"""
LeetCode 15: 3Sum
Problem: Given an integer array nums, return all the triplets [nums[i], nums[j], nums[k]] 
such that i != j, i != k, and j != k, and nums[i] + nums[j] + nums[k] == 0.

Notice that the solution set must not contain duplicate triplets.

Example:
Input: nums = [-1,0,1,2,-1,-4]
Output: [[-1,-1,2],[-1,0,1]]

Time Complexity: O(n^2)
Space Complexity: O(1) excluding the output array
"""

from typing import List

class Solution:
    def threeSum(self, nums: List[int]) -> List[List[int]]:
        """
        Main solution using two-pointer technique after sorting.
        
        Approach:
        1. Sort the array to enable two-pointer technique
        2. For each element, use two pointers to find pairs that sum to -element
        3. Skip duplicates to avoid duplicate triplets
        
        Args:
            nums: List of integers
            
        Returns:
            List of triplets that sum to zero
        """
        if len(nums) < 3:
            return []
        
        nums.sort()  # Sort the array first
        result = []
        
        for i in range(len(nums) - 2):
            # Skip duplicate values for the first element
            if i > 0 and nums[i] == nums[i - 1]:
                continue
            
            # Two pointer approach for the remaining elements
            left = i + 1
            right = len(nums) - 1
            target = -nums[i]  # We want nums[left] + nums[right] = target
            
            while left < right:
                current_sum = nums[left] + nums[right]
                
                if current_sum == target:
                    # Found a valid triplet
                    result.append([nums[i], nums[left], nums[right]])
                    
                    # Skip duplicates for left pointer
                    while left < right and nums[left] == nums[left + 1]:
                        left += 1
                    
                    # Skip duplicates for right pointer
                    while left < right and nums[right] == nums[right - 1]:
                        right -= 1
                    
                    # Move both pointers
                    left += 1
                    right -= 1
                    
                elif current_sum < target:
                    # Sum is too small, move left pointer right
                    left += 1
                else:
                    # Sum is too large, move right pointer left
                    right -= 1
        
        return result
    
    def threeSumBruteForce(self, nums: List[int]) -> List[List[int]]:
        """
        Brute force approach - O(n^3) time complexity.
        Included for comparison and interview discussion.
        """
        if len(nums) < 3:
            return []
        
        result = []
        nums.sort()
        
        for i in range(len(nums) - 2):
            if i > 0 and nums[i] == nums[i - 1]:
                continue
                
            for j in range(i + 1, len(nums) - 1):
                if j > i + 1 and nums[j] == nums[j - 1]:
                    continue
                    
                for k in range(j + 1, len(nums)):
                    if k > j + 1 and nums[k] == nums[k - 1]:
                        continue
                        
                    if nums[i] + nums[j] + nums[k] == 0:
                        result.append([nums[i], nums[j], nums[k]])
        
        return result

def test_solution():
    """
    Test cases for the 3Sum solution
    """
    solution = Solution()
    
    # Test case 1: Basic example
    nums1 = [-1, 0, 1, 2, -1, -4]
    expected1 = [[-1, -1, 2], [-1, 0, 1]]
    result1 = solution.threeSum(nums1)
    print(f"Test 1: {result1}")
    print(f"Expected: {expected1}")
    print(f"Passed: {sorted(result1) == sorted(expected1)}")
    print()
    
    # Test case 2: No valid triplets
    nums2 = [0, 1, 1]
    expected2 = []
    result2 = solution.threeSum(nums2)
    print(f"Test 2: {result2}")
    print(f"Expected: {expected2}")
    print(f"Passed: {result2 == expected2}")
    print()
    
    # Test case 3: All zeros
    nums3 = [0, 0, 0]
    expected3 = [[0, 0, 0]]
    result3 = solution.threeSum(nums3)
    print(f"Test 3: {result3}")
    print(f"Expected: {expected3}")
    print(f"Passed: {result3 == expected3}")
    print()
    
    # Test case 4: Larger array with duplicates
    nums4 = [-1, 0, 1, 2, -1, -4, -2, -3, 3, 0, 4]
    result4 = solution.threeSum(nums4)
    print(f"Test 4 result: {result4}")
    print(f"Number of triplets found: {len(result4)}")
    
    # Verify no duplicates in result
    unique_triplets = set(tuple(sorted(triplet)) for triplet in result4)
    print(f"All triplets are unique: {len(result4) == len(unique_triplets)}")
    print()

def analyze_complexity():
    """
    Analysis of time and space complexity
    """
    print("=== COMPLEXITY ANALYSIS ===")
    print("Optimized Solution (Two Pointer):")
    print("- Time Complexity: O(n^2)")
    print("  - Sorting: O(n log n)")
    print("  - Main loop: O(n) * O(n) = O(n^2)")
    print("  - Overall: O(n log n) + O(n^2) = O(n^2)")
    print()
    print("- Space Complexity: O(1)")
    print("  - Only using constant extra space (not counting output)")
    print("  - Sorting might use O(log n) space depending on implementation")
    print()
    print("Brute Force Solution:")
    print("- Time Complexity: O(n^3)")
    print("- Space Complexity: O(1)")
    print()

def interview_talking_points():
    """
    Key points to discuss during interview
    """
    print("=== INTERVIEW TALKING POINTS ===")
    print("1. Problem Understanding:")
    print("   - Need to find triplets that sum to zero")
    print("   - Must avoid duplicate triplets")
    print("   - Indices must be different")
    print()
    print("2. Approach Evolution:")
    print("   - Start with brute force O(n^3)")
    print("   - Optimize using sorting + two pointers O(n^2)")
    print("   - Consider hash map approaches")
    print()
    print("3. Edge Cases:")
    print("   - Array length < 3")
    print("   - All positive or all negative numbers")
    print("   - Arrays with many duplicates")
    print("   - Array with all zeros")
    print()
    print("4. Follow-up Questions:")
    print("   - What if we need k-sum instead of 3-sum?")
    print("   - How to handle very large arrays?")
    print("   - What if we can't modify the input array?")
    print()

if __name__ == "__main__":
    print("LeetCode 15: 3Sum Solution")
    print("=" * 50)
    
    # Run tests
    test_solution()
    
    # Analyze complexity
    analyze_complexity()
    
    # Interview talking points
    interview_talking_points()
    
    print("Solution complete!")
`;

                  const result = {
                    topic: topic,
                    code: longPythonCode,
                    lines: longPythonCode.split('\\n').length,
                    message: `Retrieved ${longPythonCode.split('\\n').length} lines of interview code for topic: ${topic}`,
                  };

                  const toolResponse = {
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: item.call_id,
                      output: JSON.stringify(result),
                    },
                  };

                  openAIWs.send(JSON.stringify(toolResponse));
                  openAIWs.send(JSON.stringify({ 
                    type: 'response.create',
                    response: {
                      voice: currentVoice
                    }
                  }));
                  console.log(
                    `✅ retrieveInterviewCode tool result sent (${longPythonCode.split('\\n').length} lines)`
                  );
                }

                // Don't forward function_call items to client - they're internal
                return;
              }
            }

            // Forward message to client
            if (clientWs.readyState === WebSocket.OPEN) {
              console.log('📤 Attempting to forward to client:', message.type);
              console.log('📤 Data length:', dataString.length);
              console.log(
                '📤 Data preview:',
                dataString.substring(0, 200) + '...'
              );

              // Send the exact data received from OpenAI
              clientWs.send(dataString);
              console.log('✅ Message forwarded successfully to client');

              // Special handling for session.created - send system message and proxy_connected
              if (message.type === 'session.created' && !sessionCreatedSent) {
                console.log(
                  '🎯 CRITICAL: session.created FORWARDED to client successfully'
                );
                sessionCreatedSent = true;

                // Send session update to disable automatic response creation (for Option 3)
                console.log(
                  '📝 Disabling automatic responses for Option 3 approach...'
                );
                const sessionUpdate = {
                  type: 'session.update',
                  session: {
                    turn_detection: {
                      type: 'server_vad',
                      threshold: 0.6,
                      silence_duration_ms: 600,
                      create_response: false, // Disable automatic response creation
                    },
                  },
                };

                openAIWs.send(JSON.stringify(sessionUpdate));
                console.log(
                  '✅ Session updated to disable automatic responses'
                );

                // Now it's safe to tell the client the proxy is ready
                setTimeout(() => {
                  const proxyMessage = JSON.stringify({
                    type: 'proxy_connected',
                  });
                  console.log('📤 Sending proxy_connected:', proxyMessage);
                  clientWs.send(proxyMessage);
                  console.log(
                    '✅ proxy_connected sent to client after session.created'
                  );
                }, 100);
              }
            } else {
              console.log('❌ Cannot forward - Client connection not ready');
              console.log('❌ Client state:', clientWs.readyState);
              console.log('❌ Expected state (OPEN):', WebSocket.OPEN);
            }
          } catch (error) {
            console.log(
              '📥 OpenAI raw data (parse failed):',
              openAIData.toString()
            );
            console.log('❌ Parse error:', error.message);
            console.log('❌ Data length:', openAIData.toString().length);
            console.log('❌ Data type:', typeof openAIData);
            console.log(
              '❌ First 500 chars:',
              openAIData.toString().substring(0, 500)
            );

            // Don't forward unparseable data to avoid client errors
            console.log(
              '⚠️ Skipping malformed data to prevent client parse errors'
            );
          }
        });

        openAIWs.on('error', (error) => {
          console.error('❌ OpenAI WebSocket error:', error);
          clientWs.send(
            JSON.stringify({
              type: 'error',
              error: { message: 'OpenAI connection error: ' + error.message },
            })
          );
        });

        openAIWs.on('close', (code, reason) => {
          console.log(
            `🔗 OpenAI connection closed. Code: ${code}, Reason: ${reason.toString()}`
          );
          clientWs.send(
            JSON.stringify({
              type: 'openai_disconnected',
              code: code,
              reason: reason.toString(),
            })
          );
        });

        return;
      }

      // Handle binary audio data
      if (isAudioData) {
        if (openAIWs && openAIWs.readyState === WebSocket.OPEN) {
          // Convert binary data to base64 and wrap in proper JSON format
          const base64Audio = Buffer.from(data).toString('base64');
          const audioEvent = {
            type: 'input_audio_buffer.append',
            audio: base64Audio,
          };

          // Audio forwarding (logging reduced to avoid spam)
          openAIWs.send(JSON.stringify(audioEvent));
        } else {
          console.log(
            '❌ Cannot forward audio - OpenAI not ready, state:',
            openAIWs ? openAIWs.readyState : 'null'
          );
        }
        return;
      }

      // Handle voice change messages from client
      if (!isAudioData && message.type === 'session.update' && message.session && message.session.voice) {
        currentVoice = message.session.voice;
        console.log(`🎵 Voice updated to: ${currentVoice}`);
        // Don't forward this to OpenAI since we'll include voice in response.create
        return;
      }

      // Forward all other JSON messages to OpenAI
      if (!isAudioData && openAIWs && openAIWs.readyState === WebSocket.OPEN) {
        // Log audio packets less frequently to avoid spam
        if (message.type === 'input_audio_buffer.append') {
          if (!openAIWs.audioPacketCount) openAIWs.audioPacketCount = 0;
          openAIWs.audioPacketCount++;
          if (openAIWs.audioPacketCount % 100 === 0) {
            console.log(
              '📤 Forwarded',
              openAIWs.audioPacketCount,
              'audio packets to OpenAI'
            );
          }
        } else {
          console.log('📤 Forwarding to OpenAI:', message.type || 'unknown');
        }
        openAIWs.send(data);
      } else if (!isAudioData) {
        console.log(
          '❌ Cannot forward JSON - OpenAI not ready, state:',
          openAIWs ? openAIWs.readyState : 'null'
        );
        clientWs.send(
          JSON.stringify({
            type: 'error',
            error: { message: 'OpenAI connection not ready' },
          })
        );
      }
    } catch (error) {
      console.error('❌ Error processing client message:', error);
      clientWs.send(
        JSON.stringify({
          type: 'error',
          error: { message: 'Message processing error: ' + error.message },
        })
      );
    }
  });

  clientWs.on('close', () => {
    console.log('👤 Client disconnected');
    if (openAIWs) {
      openAIWs.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error('❌ Client WebSocket error:', error);
  });
});

// API endpoint to test OpenAI access
app.post('/api/test-openai', async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }

  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey });

    const models = await openai.models.list();
    const realtimeModels = models.data.filter((m) => m.id.includes('realtime'));

    res.json({
      success: true,
      totalModels: models.data.length,
      realtimeModels: realtimeModels.map((m) => m.id),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to connect to OpenAI: ' + error.message,
    });
  }
});

// Configuration endpoint for client
app.get('/api/config', (req, res) => {
  res.json({
    model: REALTIME_MODEL,
    hasApiKey: !!OPENAI_API_KEY,
    wsUrl: REALTIME_WS_URL,
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connections: wss.clients.size,
    model: REALTIME_MODEL,
    hasApiKey: !!OPENAI_API_KEY,
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🌐 Voice Proxy Server running on http://localhost:${PORT}`);
  console.log(
    `📡 WebSocket proxy available at ws://localhost:${PORT}/voice-proxy`
  );
  console.log(
    `🎤 Open http://localhost:${PORT} to test real voice interaction`
  );
  console.log('');
  console.log('Features:');
  console.log('• Real OpenAI Realtime API connection');
  console.log('• CORS-free WebSocket proxy');
  console.log('• Actual microphone input processing');
  console.log('• Real audio output from OpenAI');
  console.log('• Tool calling integration');
  console.log('');
  console.log('Requirements:');
  console.log('• Valid OpenAI API key with Realtime API access');
  console.log('• Modern browser with microphone permissions');
  console.log('• HTTPS recommended for production use');
});
