import { parseArgs, help, formatResult } from './cli-ui.mjs';
import { safeMessage } from './config.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }
  const { executeCommand } = await import('./commands.mjs');
  const result = await executeCommand(args);
  console.log(formatResult(args.command, result, args.json));
}
function finish(code) {
  // The one-shot command has finished; RPC WebSocket handles may still be open.
  process.stdout.write('', () =>
    process.stderr.write('', () => process.exit(code)),
  );
}
main()
  .then(() => finish(0))
  .catch((error) => {
    if (error.result) console.log(JSON.stringify(error.result));
    console.error(safeMessage(error));
    finish(1);
  });
