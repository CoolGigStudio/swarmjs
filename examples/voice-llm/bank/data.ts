import WebSocket from 'ws';

// Session data storage
export const activeSessionData = {
  customerName: '',
  accountNumber: '',
  sessionId: '',
  pendingAction: null as string | null, // Will store actions like "show-payment-form" when needed
};

// WebSocket client connections storage
export const clientConnections = new Map<string, WebSocket>();

// Mock customer database with account numbers
export const customerDB = [
  {
    firstName: 'John',
    lastName: 'Doe',
    name: 'John Doe',
    accountNumber: '12345',
    balance: 5243.87,
  },
  {
    firstName: 'Mary',
    lastName: 'Smith',
    name: 'Mary Smith',
    accountNumber: '09876',
    balance: 12456.34,
  },
  {
    firstName: 'John',
    lastName: 'Thompson',
    name: 'John Thompson',
    accountNumber: '56789',
    balance: 7891.23,
  },
  {
    firstName: 'Mary',
    lastName: 'Baker',
    name: 'Mary Baker',
    accountNumber: '43210',
    balance: 3245.67,
  },
];

/**
 * Look up a customer by name and/or account number
 */
export async function lookupCustomer(params: any): Promise<string> {
  // Check if we received params.name or params.customerName
  const nameInput = params.name || params.customerName || '';

  // Look for account number in various possible fields
  const accountInput = params.account || params.accountNumber || '';

  console.log(
    `Looking up customer with name: "${nameInput}", account: "${accountInput}"`
  );

  let customer: (typeof customerDB)[0] | null = null; // Initialize customer as null

  // First try to find by account number if provided
  if (accountInput && accountInput.trim() !== '') {
    // Clean up account number (remove dashes or spaces)
    const cleanAccountNum = accountInput.replace(/[-\s]/g, '');
    customer =
      customerDB.find(
        (c) => c.accountNumber.replace(/[-\s]/g, '') === cleanAccountNum
      ) || null;

    if (customer) {
      console.log(`Found customer by account number: ${customer.name}`);
      return JSON.stringify(customer);
    }
  }

  // If no account match or no account provided, try by name
  if (nameInput && nameInput.trim() !== '') {
    const input = nameInput.trim();
    const hasComma = input.includes(',');

    if (hasComma) {
      // If there's a comma, treat as firstName, lastName format
      const [firstName, lastName] = input
        .split(',')
        .map((name: string) => name.trim());
      customer =
        customerDB.find(
          (c) =>
            c.firstName.toLowerCase() === firstName.toLowerCase() &&
            c.lastName.toLowerCase() === lastName.toLowerCase()
        ) || null;
    } else {
      // Single name search - could be either first or last name
      const searchName = input;
      customer =
        customerDB.find(
          (c) =>
            c.firstName.toLowerCase().includes(searchName.toLowerCase()) ||
            c.lastName.toLowerCase().includes(searchName.toLowerCase())
        ) || null;
    }
  }

  // Return customer if found, otherwise return a JSON object with an error message
  if (customer) {
    return JSON.stringify(customer);
  } else {
    return JSON.stringify({
      error: true,
      message: 'Customer not found',
      name: nameInput || 'Unknown Customer',
      accountNumber: accountInput || 'Unknown',
    });
  }
}

/**
 * Check account balance
 */
export async function checkBalance(params: any): Promise<any> {
  const account = params.account;
  const customer = customerDB.find((c) => c.accountNumber === account);

  if (customer) {
    return {
      accountNumber: customer.accountNumber,
      name: customer.name,
      balance: customer.balance,
      formattedBalance: `$${customer.balance.toFixed(2)}`,
    };
  } else {
    return { error: 'Account not found' };
  }
}

// Define the type for branch information
export interface BranchInfo {
  name: string;
  address: string;
  hours: string;
  phone: string;
}

// Define the type for branchesDB with an index signature
export const branchesDB: { [key: string]: BranchInfo } = {
  '94538': {
    name: 'Fremont Main Branch',
    address: '39150 Fremont Blvd, Fremont, CA 94538',
    hours: 'Mon-Fri: 9:00 AM - 5:00 PM, Sat: 9:00 AM - 1:00 PM',
    phone: '(510) 555-1234',
  },
  '94555': {
    name: 'Fremont Ardenwood Branch',
    address: '5000 Mowry Ave, Fremont, CA 94555',
    hours: 'Mon-Fri: 9:00 AM - 5:00 PM, Sat: Closed',
    phone: '(510) 555-5678',
  },
  '94536': {
    name: 'Fremont Centerville Branch',
    address: '37111 Fremont Blvd, Fremont, CA 94536',
    hours: 'Mon-Fri: 9:00 AM - 6:00 PM, Sat: 9:00 AM - 2:00 PM',
    phone: '(510) 555-9012',
  },
};

/**
 * Provide branch information by zip code
 */
export async function provideBranchInfo(params: any): Promise<BranchInfo> {
  const zipCode: string = params.zipCode;

  if (branchesDB[zipCode]) {
    return branchesDB[zipCode];
  } else {
    // Return nearest branch if exact zipcode not found
    return branchesDB['94538']; // Default to main branch
  }
}
