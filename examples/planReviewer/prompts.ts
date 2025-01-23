export const extractPlanDataPrompt = `
Please analyze the provided financial plan document and extract information in the following structured format. 
For any information not explicitly provided in the plan, please indicate "Not provided" rather than omitting it.

1. BASIC CLIENT INFORMATION
- Names:
- Ages:
- Family Members/Dependents:
- State of Residence:
- Employment Status:
- Anticipated Retirement Ages:
- Life Expectancy Assumptions:

2. CURRENT FINANCIAL SNAPSHOT
Net Worth: 
Asset Breakdown:
- Real Estate (Primary Residence):
- Real Estate (Investment/Other):
- Retirement Accounts (List each with value):
- Non-Retirement Investment Accounts:
- Cash/Emergency Fund:
- Other Assets:
- Business Assets:
- Alternative Investments:

Liabilities:
- Mortgages:
- Consumer Debt:
- Business Debt:
- Student Loans:
- Other Loans:

3. INCOME
- Primary Employment Income (each person):
- Bonus/Commission:
- Rental Income:
- Business Income:
- Other Income Sources:
- Expected Pension Income:
- Expected Social Security Benefits:

4. EXPENSES
- Current Monthly Living Expenses:
- Housing Expenses:
- Debt Payments:
- Insurance Premiums:
- Expected Retirement Expenses:
- Healthcare Cost Projections:

5. SAVINGS & INVESTMENTS
Current Savings:
- Emergency Fund:
- Retirement Contributions:
- Other Investment Contributions:
- Total Savings Rate:

Investment Allocation:
- Current Asset Allocation:
- Proposed Asset Allocation:
- Investment Returns Assumptions:
- Risk Tolerance Assessment:

6. INSURANCE COVERAGE
- Life Insurance:
- Disability Insurance:
- Long-term Care Insurance:
- Health Insurance:
- Property & Casualty Insurance:

7. RETIREMENT PLANNING
- Current Retirement Assets:
- Projected Retirement Needs:
- Monte Carlo Analysis Results:
- Income Replacement Ratio:
- Social Security Strategy:
- Required Minimum Distribution Planning:

8. TAX PLANNING
- Current Tax Bracket:
- Projected Future Tax Bracket:
- Tax Diversification Strategy:
- Tax Loss Harvesting Strategy:
- Roth Conversion Strategy:

9. ESTATE PLANNING
- Current Estate Documents:
- Estate Tax Considerations:
- Trust Structures:
- Beneficiary Designations:

10. PROPOSED RECOMMENDATIONS
List all specific recommendations made in the plan:
- Investment Changes:
- Savings Adjustments:
- Insurance Recommendations:
- Tax Strategies:
- Estate Planning Actions:
- Other Recommendations:

11. RISK ANALYSIS
- Monte Carlo Success Rate:
- Stress Test Results:
- Major Risk Factors Identified:
- Risk Mitigation Strategies:

12. ASSUMPTIONS USED
- Inflation Rate:
- Investment Returns:
- Life Expectancy:
- Healthcare Cost Inflation:
- Other Key Assumptions:

Please provide all available information in the above format, marking any categories where information is not provided in the plan as "Not provided" to ensure completeness of review.

Here is plan data: 
{planData}
`;
