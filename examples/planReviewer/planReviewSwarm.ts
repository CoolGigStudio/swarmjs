import { SwarmConfig, AgentConfig, ToolDefinition } from '../../src/types';
import { GptSwarm } from '../../src/core/GptSwarm';
import { extractPlanData } from './extractPlanData';
import dotenv from 'dotenv';
dotenv.config();

// Create tool definitions with handlers
const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'extractPlanData',
      description: 'Extracts the plan data',
      parameters: {
        type: 'object',
        properties: {
          planData: {
            type: 'string',
            description: 'The path to the plan data file',
          },
        },
      },
    },
    handler: extractPlanData,
  },
  {
    type: 'function',
    function: {
      name: 'validateMonteCarlo',
      description: 'Validates the Monte Carlo simulation',
      parameters: {
        type: 'object',
        properties: {
          portfolioValue: {
            type: 'number',
            description: 'The current portfolio value',
          },
          monthlyWithdrawal: {
            type: 'number',
            description: 'The monthly withdrawal amount',
          },
          timeHorizon: {
            type: 'number',
            description: 'The time horizon in years',
          },
          assetAllocation: {
            type: 'object',
            description: 'The asset allocation',
          },
        },
      },
    },
    handler: async (params: Record<string, any>) => {
      const {
        portfolioValue,
        monthlyWithdrawal,
        timeHorizon,
        assetAllocation,
      } = params;

      // Validate withdrawal rate sustainability
      const annualWithdrawal = monthlyWithdrawal * 12;
      const withdrawalRate = (annualWithdrawal / portfolioValue) * 100;

      return {
        isWithdrawalSustainable: withdrawalRate <= 4,
        withdrawalRate,
        mathematicalValidation: {
          totalAllocation:
            Object.values(assetAllocation).reduce(
              (a: number, b: unknown) => a + (b as number),
              0
            ) === 100,
        },
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyzeTaxEfficiency',
      description: 'Analyzes the tax efficiency of the withdrawal strategy',
      parameters: {
        type: 'object',
        properties: {
          traditional: {
            type: 'number',
            description: 'The amount of traditional IRA',
          },
          roth: {
            type: 'number',
            description: 'The amount of Roth IRA',
          },
          taxable: {
            type: 'number',
            description: 'The amount of taxable account',
          },
        },
      },
    },
    handler: async (params: Record<string, any>) => {
      const { traditional, roth, taxable } = params;

      return {
        taxEfficiency: {
          traditional: traditional,
          roth: roth,
          taxable: taxable,
        },
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyzeHealthcareCosts',
      description: 'Analyzes the healthcare costs',
      parameters: {
        type: 'object',
        properties: {
          age: {
            type: 'number',
            description: 'The age of the individual',
          },
          retirementAge: {
            type: 'number',
            description: 'The age of retirement',
          },
          healthStatus: {
            type: 'string',
            description: 'The health status of the individual',
          },
        },
      },
    },
    handler: async (params: Record<string, any>) => {
      const { age, retirementAge, healthStatus } = params;

      return {
        healthcareCosts: {
          age: age,
          retirementAge: retirementAge,
          healthStatus: healthStatus,
        },
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyzeInflationResilience',
      description:
        'Analyzes the inflation resilience of the withdrawal strategy',
      parameters: {
        type: 'object',
        properties: {
          portfolio: {
            type: 'object',
            description: 'The portfolio',
          },
          withdrawalStrategy: {
            type: 'object',
            description: 'The withdrawal strategy',
          },
        },
      },
    },
    handler: async (params: Record<string, any>) => {
      const { portfolio, withdrawalStrategy } = params;

      return {
        inflationProtection: {
          recommendedAllocations: {
            tips: '15-20% of fixed income',
            realEstate: '5-10% of portfolio',
            commodities: '3-5% of portfolio',
          },
        },
      };
    },
  },
];

// Define specialized agents
const planValidationSpecialist: AgentConfig = {
  name: 'PlanValidationSpecialist',
  description:
    'Validates mathematical accuracy and assumptions of retirement plans',
  systemMessage: `You are a retirement plan validation specialist who:
  1. Reviews Monte Carlo simulation assumptions and calculations
  2. Validates withdrawal rate sustainability
  3. Checks for mathematical consistency
  4. Analyzes risk-adjusted return assumptions`,
  allowedTools: ['validateMonteCarlo'],
};

const investmentAnalyst: AgentConfig = {
  name: 'InvestmentAnalyst',
  description: 'Analyzes investment strategy and asset allocation',
  systemMessage: `You are an investment analysis specialist who:
  1. Reviews asset allocation strategy
  2. Analyzes investment vehicle selection
  3. Evaluates risk-reward balance
  4. Suggests portfolio optimization opportunities`,
  allowedTools: ['validateMonteCarlo', 'analyzeInflationResilience'],
};

const taxStrategist: AgentConfig = {
  name: 'TaxStrategist',
  description: 'Analyzes tax efficiency and withdrawal strategies',
  systemMessage: `You are a tax strategy specialist who:
  1. Reviews withdrawal sequencing
  2. Analyzes asset location efficiency
  3. Evaluates tax bracket management
  4. Suggests tax optimization opportunities`,
  allowedTools: ['analyzeTaxEfficiency'],
};

const healthcarePlanner: AgentConfig = {
  name: 'HealthcarePlanner',
  description: 'Analyzes healthcare coverage and cost strategies',
  systemMessage: `You are a healthcare planning specialist who:
  1. Projects healthcare costs
  2. Reviews Medicare strategy
  3. Analyzes long-term care planning
  4. Evaluates insurance coverage`,
  allowedTools: ['analyzeHealthcareCosts'],
};

// Create swarm configuration
const config: SwarmConfig = {
  agents: [
    planValidationSpecialist,
    investmentAnalyst,
    taxStrategist,
    healthcarePlanner,
  ],
  tools: tools,
  model: 'gpt-4',
  options: {
    maxConcurrentSessions: 4,
    toolTimeout: 30000,
    debug: true,
    saveDags: true,
  },
};

// Example usage
async function analyzePlan(planData: any): Promise<void> {
  try {
    const swarm = new GptSwarm();
    await swarm.init(config);

    // Start with plan validation
    const flow = await swarm.createSession('PlanValidationSpecialist');

    const result = await swarm.runSession(flow.id, JSON.stringify(planData), {
      script: `
        # Validate Plan Mathematics
        $1 = validateMonteCarlo(
          portfolioValue: ${planData.portfolioValue},
          monthlyWithdrawal: ${planData.monthlyWithdrawal},
          timeHorizon: ${planData.timeHorizon},
          assetAllocation: ${JSON.stringify(planData.assetAllocation)}
        )

        # Analyze Investment Strategy
        $2 = switchAgent(agentName: "InvestmentAnalyst")
        $3 = analyzeInflationResilience(
          portfolio: ${JSON.stringify(planData.portfolio)},
          withdrawalStrategy: ${JSON.stringify(planData.withdrawalStrategy)}
        )

        # Analyze Tax Strategy
        $4 = switchAgent(agentName: "TaxStrategist")
        $5 = analyzeTaxEfficiency(
          accounts: ${JSON.stringify(planData.accounts)},
          withdrawalNeeds: ${planData.withdrawalNeeds},
          taxBracket: ${planData.taxBracket}
        )

        # Analyze Healthcare Strategy
        $6 = switchAgent(agentName: "HealthcarePlanner")
        $7 = analyzeHealthcareCosts(
          age: ${planData.age},
          retirementAge: ${planData.retirementAge},
          healthStatus: "${planData.healthStatus}"
        )

        # Generate Comprehensive Analysis
        $8 = createAnalysisReport_ByLLM(
          validation: $1,
          investment: $3,
          tax: $5,
          healthcare: $7
        )
      `,
    });

    console.log('Plan Analysis Results:', result);
    await swarm.endSession(flow.id);
  } catch (error) {
    console.error('Error in plan analysis:', error);
  }
}

//run the plan review
// analyzePlan({
//   portfolioValue: 1000000,
//   monthlyWithdrawal: 5000,
//   timeHorizon: 30,
//   assetAllocation: { stocks: 60, bonds: 40 },
// });

extractPlanData({});
