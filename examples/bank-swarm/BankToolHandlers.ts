// BankToolHandlers.ts
import { customerDB, BranchInfo, branchesDB, Customer } from './data';

/**
 * Look up a customer by name and/or account number
 */
export async function lookupCustomer(params: any): Promise<any> {
  // Check if we received params.name or params.customerName
  const nameInput = params.name || params.customerName || '';
  const accountInput = params.account || params.accountNumber || '';

  console.log(
    `Looking up customer with name: "${nameInput}", account: "${accountInput}"`
  );

  let customer: Customer | null = null;

  // First try to find by account number if provided
  if (accountInput && accountInput.trim() !== '') {
    const cleanAccountNum = accountInput.replace(/[-\s]/g, '');
    customer =
      customerDB.find(
        (c) => c.accountNumber.replace(/[-\s]/g, '') === cleanAccountNum
      ) || null;

    if (customer) {
      console.log(`Found customer by account number: ${customer.name}`);
      return customer;
    }
  }

  // If no account match or no account provided, try by name
  if (nameInput && nameInput.trim() !== '') {
    const input = nameInput.trim();
    const hasComma = input.includes(',');

    if (hasComma) {
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
      const searchName = input;
      customer =
        customerDB.find(
          (c) =>
            c.firstName.toLowerCase().includes(searchName.toLowerCase()) ||
            c.lastName.toLowerCase().includes(searchName.toLowerCase())
        ) || null;
    }
  }

  // Return customer if found, otherwise return an error object
  if (customer) {
    return customer;
  } else {
    return {
      error: true,
      message: 'Customer not found',
      name: nameInput || 'Unknown Customer',
      accountNumber: accountInput || 'Unknown',
    };
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

/**
 * Process bill payment
 */
export async function payBills(params: any): Promise<any> {
  console.log('PayBills tool called with args:', params);

  return {
    status: 'ready',
    message:
      'Bill payment form is ready. Please go to the home page. The payment form will automatically appear.',
    formUrl: `/index?action=pay-bills`,
  };
}

/**
 * Redirect to bill payment form
 */
export async function redirectToPayBillsForm(params: any): Promise<any> {
  return {
    status: 'redirect',
    url: `/index?action=pay-bills`,
    message:
      'Please go to the home page. The payment form will automatically appear.',
  };
}
