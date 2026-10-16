import fs from 'node:fs';
import path from 'node:path';

/** Load the application-owned connector without touching shared project startup files. */
export function connectorBootstrapCommand(appRoot: string): string | undefined {
  const script = path.resolve(appRoot, 'uefn_auto_connector.py').replaceAll('\\', '/');
  if (!fs.existsSync(script)) return undefined;
  if (/["\r\n]/.test(script)) throw new Error('The connector script path cannot be sent to the UEFN console.');
  return `py "${script}"`;
}
