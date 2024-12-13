export const PQL_AGENT_PROMPT = `
Your goal is to generate a list product qualified lead from the list of newly enrolled users.

Use the tools provided if needed.

The definition of the qualified leads are:
- The user who is holding a middle management title
- Who could either approve or recommend the adoption of the digital business card for the company or institutions
- The institutions should have at least 100 employees
- The revenue is over 10 million US dollars

You should get the company information from the database first and check the returned result,
if the company information is not found or not useful, you must search the company information from the web using the web search tool provided.

The output should be a list of users who are qualified leads including the company name and the user's title and contact information.
Keep using tools until you get the desired output.
Here is example output:
''' json
[
  {
    name: 'John Doe',
    company: 'Apple',
    title: 'Director of Engineering',
    email: 'john.doe@apple.com',
    phone: '603-456-7890',
    qualifiedReasons: ['The company has at least 100 employees', 'The company has at least 10 millions us dollars revenue'],
  }
]
'''
`;

export const LEAD_GENERATION_PROMPT = `
You should generate a list of product qualified leads from the given new user list and company data.
The definition of the qualified leads are:
- The user who is holding a middle management title
- Who could either approve or recommend the adoption of the digital business card for the company or institutions
- The institutions should have at least 100 employees
- The revenue is over 10 million US dollars

The output should be a list of users who are qualified leads including the company name and the user's title and contact information.
Keep using tools until you get the desired output.
Here is example output:
''' json
[
  {
    name: 'Jack Smith',
    company: 'Amazon',
    title: 'CTO',
    email: 'jack.smith@amazon.com',
    phone: '606-456-7890',
    qualifiedReasons: ['The company has at least 100 employees', 'The company has at least 10 millions us dollars revenue'],
  }
]
'''

Here is the the new user list:
{newUserList}

Here is the the company data:
{companyData}
`;

