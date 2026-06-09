/**
 * Throwaway validation: assemble the real command set exactly as index.ts does,
 * build the slash-command registration payloads, and assert they satisfy
 * Discord's constraints. Run with: npx ts-node scripts/validate-slash.ts
 */
import { configCommands } from '../src/commands/config';
import { modeCommands } from '../src/commands/modes';
import { museCommands, museCommand } from '../src/commands/muse';
import { reminderCommands } from '../src/commands/reminders';
import { taskCommands } from '../src/commands/tasks';
import { learningCommands, learnCommand } from '../src/commands/learning';
import { reactionCommands } from '../src/commands/reactions';
import { translateCommands } from '../src/commands/translate';
import { channelConfigCommands } from '../src/commands/channel-config';
import { adminCommands } from '../src/commands/admin';
import { patreonCommands } from '../src/commands/patreon';
import { transcribeCommands } from '../src/commands/transcribe';
import { sitelenCommands } from '../src/commands/sitelen';
import { buildSlashCommandData } from '../src/commands/slash';

const all = [
    ...configCommands, ...modeCommands, ...museCommands, museCommand, learnCommand,
    ...reminderCommands, ...taskCommands, ...learningCommands, ...reactionCommands,
    ...translateCommands, ...channelConfigCommands, ...adminCommands, ...patreonCommands,
    ...transcribeCommands, ...sitelenCommands
];

const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const errors: string[] = [];
const data = buildSlashCommandData(all);

for (const cmd of data) {
    if (!NAME_RE.test(cmd.name)) errors.push(`bad command name: "${cmd.name}"`);
    if (!cmd.description || cmd.description.length < 1 || cmd.description.length > 100) {
        errors.push(`${cmd.name}: description length ${cmd.description?.length}`);
    }
    if (cmd.options.length > 25) errors.push(`${cmd.name}: ${cmd.options.length} options (>25)`);

    let sawOptional = false;
    for (const opt of cmd.options) {
        if (!NAME_RE.test(opt.name)) errors.push(`${cmd.name}.${opt.name}: bad option name`);
        if (!opt.description || opt.description.length > 100) errors.push(`${cmd.name}.${opt.name}: description length ${opt.description?.length}`);
        if (opt.required && sawOptional) errors.push(`${cmd.name}.${opt.name}: required option after an optional one`);
        if (!opt.required) sawOptional = true;
    }
}

const names = data.map(d => d.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) errors.push(`duplicate command names: ${[...new Set(dupes)].join(', ')}`);

console.log(`Built ${data.length} slash commands (from ${all.length} command objects):`);
console.log(names.join(', '));

if (errors.length) {
    console.error('\n❌ VALIDATION ERRORS:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
}
console.log('\n✅ All slash command payloads satisfy Discord constraints.');
