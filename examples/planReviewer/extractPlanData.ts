import fs from 'fs/promises';
import { AIServiceFactory } from '../../src/tools/models/aiServices';
import { AIServiceType } from '../../src/types/aiService';
import { extractPlanDataPrompt } from './prompts';

async function splitIntoChunks(content: string): Promise<string[]> {
  // Clean the content
  content = content.replace(/[^\x20-\x7E\n\r\t]/g, ''); // Remove non-printable characters

  const MAX_TOKENS = 30000;
  const chunks: string[] = [];

  // Try splitting by major sections first
  const sectionMarkers = [
    'Blueprint - Net Worth',
    'Blueprint - Income',
    'Monte Carlo Analysis',
    'Retirement Analysis',
    'Asset Allocation',
    'Saving Analysis',
    'Cash Flows',
  ];

  const pattern = new RegExp(`(?=${sectionMarkers.join('|')})`, 'g');
  let sections = content
    .split(pattern)
    .filter((section) => section.trim().length > 0);

  if (sections.length <= 1) {
    console.log(
      'Warning: Could not split by sections, falling back to size-based splitting'
    );
    // Fall back to size-based splitting
    sections = [];
    let temp = content;
    while (temp.length > 0) {
      const chunkSize = Math.min(temp.length, MAX_TOKENS * 4); // 4 chars per token estimate
      sections.push(temp.slice(0, chunkSize));
      temp = temp.slice(chunkSize);
    }
  }

  let currentChunk = '';
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = Math.ceil(section.length / 4);

    if (currentTokens + sectionTokens > MAX_TOKENS) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = section;
      currentTokens = sectionTokens;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + section;
      currentTokens += sectionTokens;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  // Log chunk information
  chunks.forEach((chunk, i) => {
    console.log(
      `\nChunk ${i + 1} size: ~${Math.ceil(chunk.length / 4)} tokens`
    );
    console.log(
      `Chunk ${i + 1} starts with: ${chunk.slice(0, 100).replace(/\n/g, ' ')}...\n`
    );
  });

  return chunks;
}

async function extractInfoFromChunk(
  chunk: string,
  llmService: any,
  chunkIndex: number
): Promise<string> {
  const prompt = `Analyze this section (${chunkIndex + 1}) of a financial plan and extract relevant information in the specified format. Only include information that is explicitly present in this section.

${extractPlanDataPrompt.replace('{planData}', chunk)}`;

  const response = await llmService.complete([
    {
      role: 'system',
      content:
        'You are a financial plan analyzer. Extract and structure information from financial documents.',
    },
    {
      role: 'user',
      content: prompt,
    },
  ]);

  return response.content;
}

async function mergeResults(
  results: string[],
  llmService: any
): Promise<string> {
  const mergePrompt = `I have analyzed a financial plan in ${results.length} parts. Please merge these analyses into a single, comprehensive summary. Remove any duplicates and resolve conflicts. Use the same structured format as the individual analyses.

Previous analyses:
${results.join('\n\n=== Next Analysis ===\n\n')}`;

  const response = await llmService.complete([
    {
      role: 'system',
      content:
        'You are a financial analyst merging multiple partial analyses into a comprehensive summary.',
    },
    {
      role: 'user',
      content: mergePrompt,
    },
  ]);

  return response.content;
}

export async function extractPlanData(
  params: Record<string, any>
): Promise<string> {
  let { planDataPath } = params;
  if (!planDataPath) {
    planDataPath = '/Users/lzhang/Downloads/planData.pdf';
  }

  const planData = await fs.readFile(planDataPath, 'utf8');

  // Validate content
  if (planData.includes('%PDF')) {
    throw new Error(
      'The file appears to be in binary PDF format. Please provide text content instead.'
    );
  }

  const llmService = AIServiceFactory.createService(AIServiceType.GPT, {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o',
    maxTokens: 4000,
    temperature: 0,
  });

  const chunks = await splitIntoChunks(planData);
  console.log(`Split document into ${chunks.length} chunks`);

  const analyses: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`\nProcessing chunk ${i + 1} of ${chunks.length}...`);
    try {
      const analysis = await extractInfoFromChunk(chunks[i], llmService, i);
      analyses.push(analysis);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
    } catch (error) {
      console.error(`Error processing chunk ${i + 1}:`, error);
    }
  }

  if (analyses.length === 0) {
    throw new Error('No successful analyses to merge');
  }

  console.log('\nMerging results...');
  const finalResult = await mergeResults(analyses, llmService);

  return finalResult;
}
