import fs from 'fs';
import path from 'path';
export const LUGSO_PROMPT = fs.readFileSync(path.join(__dirname, './lugso.md'), 'utf8');