export const help: string[] = [
    `

## Commands

\`!help\`: Display this message.

### Modes

\`!jeeves\`: Act like Jeeves. Clears memory.
\`!tokipona\`: Speak toki pona. Clears memory.
\`!jargon\`: Speak Jargon. Clears memory.
\`!whisper\`: Switch to transcription-only mode. (no messages will be sent to the AI.) The bot will reply to audio messages with text transcriptions.
\`!prompt YOUR_PROMPT_HERE\`: Change the System Prompt to your specified text. The System Prompt will form the backbone of the AI's personality for subsequent conversations. To undo this command, select one of the other personalities.

`,
    `
### Chat History

\`!clear\`: Forget everything from the present conversation.
\`!log\`: Prints current message history.
\`!limit INTEGER\`: Sets memory limit to X messages.

### Configuration

\`!temperature FLOAT\`: Sets temperature (0-2) to X.
\`!model STRING\`: Sets model. Any string will work, but if you specify an invalid model the bot will break.
\`!delay SECONDS\`: Sets reponse delay to SECONDS seconds. This can be useful if you want the bot to wait for someone to send a few different messages before responding.
\`!tokens INTEGER\`: Sets the maximum number of tokens to generate.
\`!persist\`: Toggle whether data is saved between sessions.
\`!dms\`: Toggle whether the bot will respond to direct messages.
`,
    `
### Testing

\`!parrot STRING\`: Makes the bot repeat the entire message back to you. Useful for testing. Does not append message to log.
\`!empty\`: Treat your message as an empty message. This is sometimes useful if you want the bot to continue speaking about its previous subject.
`,
    `

### Musing

The bot can be configured to automatically muse upon a random Wikipedia page every few hours, or you can send it a specific webpage to comment on.

\`!muse\`: Forces the bot to muse upon a random Wikipedia page.
\`!muse URL\`: Forces the bot to muse upon a specific webpage.
\`!museon\`: Enable automatic muse.
\`!museoff\`: Disable automatic muse.
\`!museinterval HOURS\`: Set muse interval to X hours.

## Voice Commands

You can also use voice commands by speaking the word as an audio message. For example: "clear" in a voice message will run !clear, and !parrot bla bla bla will reply with bla bla bla.
    `
]