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
\`!speedscalar FLOAT\`: Sets the transcription speed scalar (0.5-4.0, default: 1.0). Audio is pre-processed with ffmpeg at this speed before being sent to Whisper. Higher values can improve transcription efficiency for long audio. If transcription fails, the bot automatically retries at 2.0x speed.
\`!persist\`: Toggle whether data is saved between sessions.
\`!dms\`: Toggle whether the bot will respond to direct messages.
\`!voiceon\`: Enable voice output. Currently only uses Jeeves Voice (Jonathan Cecil).
\`!voiceoff\`: Disable voice output.
\`!config\`: Show current channel configuration.
\`!config <channel> <frequency>\`: Configure how the bot responds in a specific channel.
  - Frequencies: \`all\` (respond to every message), \`mentions\` (only when mentioned), \`none\` (ignore messages)
  - Examples: \`!config general all\`, \`!config random mentions\`, \`!config off-topic none\`
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
### Autotranslate

The bot can automatically translate messages in specific channels or for specific users to a target language. This works independently of other modes - even if the bot is not monitoring a channel, it will still translate messages if autotranslate is enabled.

**Channel-wide translation:**
\`!translateadd <channel> <language>\`: Add a channel to autotranslate. All messages in that channel will be translated to the specified language.
\`!translateremove <channel>\`: Remove a channel from autotranslate.
\`!translatelist\`: Show all channels configured for autotranslate.

**User-specific translation:**
\`!translateadduser <@user> <language>\`: Add a language for a user. Can be called multiple times to add multiple languages.
\`!translateremoveuser <@user> [language]\`: Remove a specific language or all languages for a user.
\`!translatelistusers\`: Show all users configured for autotranslate.

Examples:
- \`!translateadd toki-pona "toki pona"\` - translates all messages in #toki-pona to toki pona
- \`!translateadduser @Alice Quenya\` - translates messages from Alice to Quenya
- \`!translateadduser @Alice Latin\` - also translates Alice's messages to Latin (she now gets both!)
- \`!translateremoveuser @Alice Latin\` - removes only Latin, keeps Quenya
- \`!translateremoveuser @Alice\` - removes all languages for Alice
- \`!translateadd spanish-practice Spanish\` - translates all messages in #spanish-practice to Spanish

Note: Users can have multiple languages configured. All translations are sent in a single message to reduce API calls. Duplicate languages (e.g., if both channel and user want Latin) are automatically skipped.

To skip translation for a specific message, start it with "notr" (e.g., "notr this won't be translated").

`,
`
## Voice Commands

You can also use voice commands by speaking the word as an audio message. For example: "clear" in a voice message will run !clear, and !parrot bla bla bla will reply with bla bla bla.
    `
]