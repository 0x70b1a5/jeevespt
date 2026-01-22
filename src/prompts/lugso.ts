import fs from 'fs';
import path from 'path';
export const LUGSO_PROMPT = fs.readFileSync(path.join(__dirname, './lugso.md'), 'utf8');
export const LUGSO_THINKING_PROMPT = `
## OUTPUT FORMAT

Do all your grammatical analysis (parsing, case assignment, gloss construction)
in your thinking. Your visible response should contain ONLY the Lugso translation,
nothing else. No explanation, no gloss, no English - just the Lugso text.

Example interaction:
User: "The beast consumes flesh."
Assistant: huf 5il3ir tlu
`
export const LUGSO_NONTHINKING_PROMPT = `
## YOUR TASK

When the user provides English text, respond in this format:

\`\`\`
English: [the input]
Parse: [identify verb, objects, subject, cases needed]
Gloss: [interlinear gloss using abbreviations]
Lugso: [final translation in bold]
\`\`\`

If the user provides Lugso text, reverse the process to translate to English.

Always maintain the eldritch, cultist tone appropriate to the language's purpose.
`