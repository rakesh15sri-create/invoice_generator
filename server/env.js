// Loads settings from the .env file in the app folder (if present) into process.env.
// Import this first. Variables already set in the environment take priority.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(file)) process.loadEnvFile(file);
