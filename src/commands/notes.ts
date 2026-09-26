import { Command, CommandContext, CommandDependencies } from './types';
import { discordTimestamp } from './utils';
import { buildListMessage, registerListKind } from './listPanel';
import { MAX_NOTE_CHARS } from '../state/PeopleStore';

/**
 * What the bot remembers about you: notes it took with the
 * remember_about_person tool, or that you added. Shown to it whenever you're
 * in the conversation; yours to remove with ❌.
 */
export const notesList = registerListKind({
    code: 'note',
    command: 'notes',
    title: '🗒️ What I remember about you',
    perUser: true,
    empty: 'Nothing noted about you yet. Tell me something with `/notes note:<text>`.',
    header: () => 'Noted in conversation, and brought to mind whenever you\'re chatting with me here.',
    entries: (deps, scope) => deps.state.getPersonNotes(scope.id, scope.isDM, scope.ownerId).map(note => ({
        value: String(note.at),
        text: `${note.text} — ${discordTimestamp(new Date(note.at), 'R')}`
    })),
    remove: (deps, scope, entry) => {
        deps.state.removePersonNote(scope.id, scope.isDM, scope.ownerId, Number(entry.value));
    }
});

/**
 * !notes [note] — list what the bot remembers about you (❌ to remove), or add a note.
 */
export const notesCommand: Command = {
    names: ['notes'],
    description: 'What the bot remembers about you (remove with buttons); give a note to add one.',
    category: 'Chat History',
    ephemeral: true,
    options: [{ name: 'note', description: 'Something about yourself for the bot to remember', type: 'string', required: false, rest: true }],
    examples: ['!notes', '!notes I\'m reading Aquinas this month'],
    async execute(ctx: CommandContext, deps: CommandDependencies) {
        const author = ctx.message.author;
        const scope = { id: ctx.id, isDM: ctx.isDM, ownerId: author.id };
        let note: string | undefined;
        const text = ctx.args.join(' ').trim();
        if (text) {
            const displayName = ctx.message.member?.displayName;
            const name = displayName && displayName !== author.username ? `${author.username}/${displayName}` : author.username;
            deps.state.addPersonNote(ctx.id, ctx.isDM, author.id, name, text);
            note = text.length > MAX_NOTE_CHARS ? `✅ Noted (trimmed to ${MAX_NOTE_CHARS} characters).` : '✅ Noted.';
        }
        await ctx.message.reply(buildListMessage(notesList, deps, scope, note));
    }
};

export const notesCommands: Command[] = [notesCommand];
