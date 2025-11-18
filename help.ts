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
\`!model STRING\`: Sets model. The bot will validate that you're using a valid Anthropic model and show you a list of available models if you specify an invalid one.
\`!delay SECONDS\`: Sets reponse delay to SECONDS seconds. This can be useful if you want the bot to wait for someone to send a few different messages before responding.
\`!tokens INTEGER\`: Sets the maximum number of tokens to generate.
\`!persist\`: Toggle whether data is saved between sessions.
\`!dms\`: Toggle whether the bot will respond to direct messages.
\`!voice\`: Enable/disable voice output. Currently only uses Jeeves Voice (Jonathan Cecil).
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
`,
`
### Reaction Mode

The bot can be configured to automatically react with appropriate emojis to messages in specific channels.

\`!reacton\`: Enable reaction mode for monitored channels.
\`!reactoff\`: Disable reaction mode.
\`!reactadd CHANNEL-NAME\`: Add a channel to the list of monitored channels.
\`!reactremove CHANNEL-NAME\`: Remove a channel from the list of monitored channels.
`,
`
### Reminders

Set personal reminders that will be delivered at the specified time.

\`!remind <time> <message>\`: Set a reminder. Time format: 30s, 5m, 2h, 1d
\`!reminders\`: List all your active reminders.
\`!cancelreminder <id>\`: Cancel a specific reminder by ID.

Examples:
- \`!remind 5m Take a break\`
- \`!remind 2h Check the laundry\`
- \`!remind 1d Review the proposal\`
`,
`
### Learning System

The bot can ask you educational questions on subjects you specify, spaced throughout the day.

\`!learnon\`: Enable learning questions.
\`!learnoff\`: Disable learning questions.
\`!learnadd <subject>\`: Add a subject to learn about.
\`!learnremove <subject>\`: Remove a subject from the learning list.
\`!learnstatus\`: Show current learning configuration and progress.
\`!learn\`: Immediately ask a learning question from your configured subjects.

`,
`
## Voice Commands

You can also use voice commands by speaking the word as an audio message. For example: "clear" in a voice message will run !clear, and !parrot bla bla bla will reply with bla bla bla.
    `
]