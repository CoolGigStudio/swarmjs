// BankVoiceSwarm.ts
import { ToolDefinition, SwarmConfig } from '../../src/types/basic';
import { VoiceSwarm } from '../../src/core/VoiceSwarm';
import { BANK_SWARM_SYSTEM_MESSAGE } from './prompts';
import {
  lookupCustomer,
  checkBalance,
  provideBranchInfo,
  payBills,
  redirectToPayBillsForm,
} from './BankToolHandlers';

export class BankVoiceSwarm extends VoiceSwarm {
  /**
   * Define bank-specific tools
   */
  protected override async initImpl(config: SwarmConfig): Promise<void> {
    // Add bank-specific tools to the configuration
    config.tools = [
      ...(config.tools || []),
      this.createLookupCustomerTool(),
      this.createCheckBalanceTool(),
      this.createPayBillsTool(),
      this.createProvideBranchInfoTool(),
      this.createRedirectToPayBillsFormTool(),
    ];

    // Set the system message for all agents
    config.agents.forEach((agent) => {
      agent.systemMessage = BANK_SWARM_SYSTEM_MESSAGE;
    });

    // Call the parent implementation
    await super.initImpl(config);
  }

  /**
   * Override the session metadata update function to handle bank-specific updates
   */
  protected override updateSessionMetadata(
    sessionId: string,
    toolName: string,
    args: any,
    result: any
  ): void {
    // Get the session data
    let data = this.getSessionData(sessionId);

    // Handle bank-specific tool updates
    if (toolName === 'lookupCustomer') {
      if (result && typeof result === 'object') {
        // If this is an error object or a valid customer
        if (result.error) {
          data.metadata.customerName = result.name || 'Unknown Customer';
          data.metadata.accountNumber = result.accountNumber || 'Unknown';
        } else {
          data.metadata.customerName = result.name || '';
          data.metadata.accountNumber = result.accountNumber || '';
        }
      }
    } else if (
      toolName === 'payBills' ||
      toolName === 'redirectToPayBillsForm'
    ) {
      // Update customer info
      if (args.customerName) data.metadata.customerName = args.customerName;
      if (args.accountNumber) data.metadata.accountNumber = args.accountNumber;

      // Set pending action
      data.metadata.pendingAction = 'show-payment-form';

      // Broadcast to clients
      this.getVoiceIO().broadcastToClients({
        type: 'action',
        action: 'show-payment-form',
        data: {
          customerName: data.metadata.customerName,
          accountNumber: data.metadata.accountNumber,
        },
      });
    }

    // Always broadcast any session data updates
    this.getVoiceIO().broadcastToClients({
      type: 'session-update',
      data: data.metadata,
    });

    // Call the parent implementation
    super.updateSessionMetadata(sessionId, toolName, args, result);
  }

  // Helper method to get session data
  private getSessionData(sessionId: string): { metadata: Record<string, any> } {
    let data = this.getInternalSessionData().get(sessionId);
    if (!data) {
      data = { metadata: {} };
      this.getInternalSessionData().set(sessionId, data);
    }
    return data;
  }

  // Tool definitions
  private createLookupCustomerTool(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'lookupCustomer',
        description: 'Look up customer information by name',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Customer name',
            },
            accountNumber: {
              type: 'string',
              description: 'Account number',
            },
          },
        },
      },
      handler: lookupCustomer,
    };
  }

  private createCheckBalanceTool(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'checkBalance',
        description: 'Check customer balance',
        parameters: {
          type: 'object',
          properties: {
            account: {
              type: 'string',
              description: 'Account number',
            },
          },
        },
      },
      handler: checkBalance,
    };
  }

  private createPayBillsTool(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'payBills',
        description: 'Prepare bill payment form',
        parameters: {
          type: 'object',
          properties: {
            customerName: {
              type: 'string',
              description: 'Customer name',
            },
            accountNumber: {
              type: 'string',
              description: 'Account number',
            },
          },
        },
      },
      handler: payBills,
    };
  }

  private createProvideBranchInfoTool(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'provideBranchInfo',
        description: 'Provide branch information',
        parameters: {
          type: 'object',
          properties: {
            zipCode: {
              type: 'string',
              description: 'Zip code',
            },
          },
        },
      },
      handler: provideBranchInfo,
    };
  }

  private createRedirectToPayBillsFormTool(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'redirectToPayBillsForm',
        description: 'Redirect user to bill payment form',
        parameters: {
          type: 'object',
          properties: {
            customerName: {
              type: 'string',
              description: 'Customer name',
            },
            accountNumber: {
              type: 'string',
              description: 'Account number',
            },
          },
        },
      },
      handler: redirectToPayBillsForm,
    };
  }
}
