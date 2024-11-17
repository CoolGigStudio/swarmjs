import chalk from 'chalk';

export function debugPrint(debug: boolean, ...args: any[]): void {
  if (!debug) return;
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const message = args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    )
    .join(' ');
  console.log(chalk.white(`[${chalk.gray(timestamp)}] ${chalk.gray(message)}`));
}
