import OpenAI from 'openai';
import { LEAD_GENERATION_PROMPT, PQL_AGENT_PROMPT } from './prompts';
import { Agent, AgentFunction } from '../../core/types';
import { Swarm } from '../../core';
import { MetaDagExecutionAgent } from '../../lib/agents/DagAgents';

type User = {
  name: string;
  title: string;
  company: string;
  email: string;
  phone: string;
};

type Company = {
  name?: string;
  employees?: number;
  revenue?: string;
};

// Core functions remain the same
async function getNewUsers(): Promise<string> {
  return JSON.stringify([
    {
      name: 'Mike',
      title: 'VP Technology',
      company: 'IBM',
      email: 'mike@ibm.com',
      phone: '1234567890',
    },
    {
      name: 'John Doe',
      title: 'Software Engineer',
      company: 'Microsoft',
      email: 'john@microsoft.com',
      phone: '1234567890',
    },
    {
      name: 'Jane Smith',
      title: 'CTO',
      company: 'Blinq',
      email: 'jane@blinqup.com',
      phone: '1234567890',
    },
    {
      name: 'George Lin',
      title: 'Managing Director',
      company: 'Palo Alto Hotels',
      email: 'George@paloaltohotels.com',
      phone: '1234567890',
    },
  ]);
}

async function getCompanyInfoFromDB(company: string): Promise<string> {
  const companyList: Company[] = [
    { name: 'IBM', employees: 70000, revenue: '100 billions us dollars' },
    { name: 'Microsoft', employees: 100000, revenue: '200 billions us dollars' },
    { name: 'Blinq', employees: 10, revenue: '5 millions us dollars' },
  ];
  const companyInfo = companyList.find((thisCompany) => thisCompany.name === company) ?? {};
  console.log('Got company info:', companyInfo);
  return JSON.stringify(companyInfo);
}

async function searchCompanyInfoFromWeb(company: string): Promise<string> {
  const companyList: Company[] = [
    { name: 'Apple', employees: 80000, revenue: '200 billions us dollars' },
    { name: 'Popl', employees: 60, revenue: '15 millions us dollars' },
    { name: 'John Construction Inc.', employees: 120, revenue: '15 millions us dollars' },
    { name: 'Palo Alto Hotels', employees: 200, revenue: '20 millions us dollars' },
  ];
  const companyInfo = companyList.find((thisCompany) => thisCompany.name === company) ?? {};
  console.log('Searched company info:', companyInfo);
  return JSON.stringify(companyInfo);
}

async function generatePQLeads(newUserList: string, companyData: string): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  const prompt = LEAD_GENERATION_PROMPT
    .replace('{companyData}', companyData)
    .replace('{newUserList}', newUserList);
  console.log('Prompt>>>>>>>>>>>>>>:', prompt);
  const result = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
  });
  return result.choices[0].message.content ?? 'No answer!';
}

// Add function descriptions
Object.defineProperty(getNewUsers, 'description', {
  value: 'Call this function to get newly enrolled users'
});

Object.defineProperty(getCompanyInfoFromDB, 'description', {
  value: 'Call this function to get company information from the database'
});

Object.defineProperty(searchCompanyInfoFromWeb, 'description', {
  value: 'Call this function to get company information from web if the result from the database is not useful'
});

Object.defineProperty(generatePQLeads, 'description', {
  value: 'Call this function to generate product qualified leads from the given final data'
});

// Updated implementation using the new nested DAG framework
async function generatePQLeadsWithDAG(): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  // Define available functions
  const functions: AgentFunction[] = [
    getNewUsers,
    getCompanyInfoFromDB,
    searchCompanyInfoFromWeb,
    generatePQLeads
  ];

  // Create meta-DAG agent with main goal
  const metaAgent = new MetaDagExecutionAgent(
    'Generate PQL leads by collecting user and company information',
    functions
  );

  // Initialize swarm with OpenAI client
  const swarm = new Swarm(client);

  // Execute the swarm
  const useStream = false;
  const result = await swarm.run(
    metaAgent.getAgent(),
    [{ role: 'user', content: PQL_AGENT_PROMPT }],
    {},
    null,
    useStream,
    true
  );

  // Handle results
  if (!useStream && 'messages' in result) {
    return result.messages[result.messages.length - 1].content;
  } else if (useStream) {
    let finalMessage = '';
    if (Symbol.asyncIterator in result) {
      for await (const message of result) {
        if ('content' in message) {
          finalMessage += message.content;
        }
        console.log(message);
      }
    }
    return finalMessage;
  }
  return 'No answer!';
}

// Execute the function
generatePQLeadsWithDAG()
  .then((result) => {
    console.log(result);
  })
  .catch((error) => {
    console.error(error);
  });