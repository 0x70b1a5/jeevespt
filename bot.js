require('dotenv').config()
const { Client, GatewayIntentBits } = require('discord.js')
const { Configuration, OpenAIApi } = require('openai')

// Load the Discord bot token and OpenAI API key from the environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const TARGET_CHANNEL_NAME = process.env.TARGET_CHANNEL_NAME
let ourMessageLog = []
let mode = 0 // 0 === jeeves, 1 === tokipona, 2 === jargon
let messageLimit = 20

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
})
const openai = new OpenAIApi(configuration)
const client = new Client({ intents: [GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds] })

client.once('ready', async () => {
  await client.login(DISCORD_BOT_TOKEN)
  console.log(`Logged in as ${client.user.tag}!`, client.isReady())
})

client.on('error', async (e) => {
  console.error(e)
})

function concatenateContents(array) {
  const MAX_CHUNK_SIZE = 1900;
  let chunks = [''];
  let chunkIndex = 0;

  array.forEach(item => {
    if (chunks[chunkIndex].length + item.content.length > MAX_CHUNK_SIZE) {
      chunks.push('');
      chunkIndex++;
    }
    chunks[chunkIndex] += `[${item.role}]: ${item.content}\n`;
  });

  return chunks;
}

client.on('messageCreate', async (message) => {
  if (message.channel.name !== TARGET_CHANNEL_NAME) return

  if (message.content === '!clear') {
    ourMessageLog = []
    await message.channel.send('Cleared messages log.')
  } else if (message.content === '!jeeves') {
    ourMessageLog = []
    mode = 0
    try {
      await client.user.setUsername('Jeeves')
      await client.user.setAvatar('https://blog-assets.mugglenet.com/wp-content/uploads/2013/01/my-man-jeeves-768x1220.jpg')
    } catch {}
    await message.channel.send('I have switched to Jeeves mode, sir.')
  } else if (message.content === '!tokipona') {
    ourMessageLog = []
    mode = 1
    try {
      await client.user.setUsername('ilo Jepite')
      await client.user.setAvatar('https://www.jonathangabel.com/images/t47_tokipona/jan_ante/inkepa.mumumu.jpg')
    } catch {}
    await message.channel.send('mi ante e nasin tawa toki pona.')
  } else if (message.content === '!jargon') {
    ourMessageLog = []
    mode = 2
    try {
      await client.user.setUsername('JARGONATUS')
      await client.user.setAvatar('https://user-images.githubusercontent.com/10970247/229021007-1b4fd5e5-3c66-4290-a20f-3c47af0de760.png')
    } catch {}
    await message.channel.send('`# Even in death, I serve the Omnissiah.`')
  } else if (message.content.match(/^!limit \d+$/)) {
    const parsed = message.content.match(/^!limit (\d+)$/)
    const requestedLimit = parsed && parsed[1]
    if (!isNaN(requestedLimit) && requestedLimit > 0) {
      messageLimit = requestedLimit
      await message.channel.send(`Message memory is now ${limit} messages.`)
    } else {
      await message.channel.send(`Failed to parse requested limit. 
Found: \`${parsed}\` 
Format: \`!limit X\` where X is a number greater than zero.`)
    }
  } else if (message.content === '!help' || message.content === '!commands') {
    await message.channel.send(`JEEVESPT:
- Remembers the last ${messageLimit} messages (yours and his)
- Doesn't see usernames, only message text
- Not actually Jeeves. :(

\`!clear\`: Forget everything from the present conversation.
\`!jeeves\`: Act like Jeeves. Clears memory.
\`!tokipona\`: Speak toki pona. Clears memory.
\`!jargon\`: Speak Jargon. Clears memory.
\`!log\`: Prints current memory.
\`!limit X\`: Sets memory limit to X.
\`!help\`: Display this message.
`)
  } else if (message.content === '!log') {
    const chunx = concatenateContents(ourMessageLog)
    await message.channel.send('CURRENT MEMORY:\n---')
    chunx.forEach(async m => m && await message.channel.send(m))
    await message.channel.send('---')
  } else if (message.author.bot) {
    // ignore our system messages
  } else {
    ourMessageLog.push({ 
      role: 'user', 
      content: message.content
    })
    
    while (messageLimit > 0 && ourMessageLog.length > messageLimit) ourMessageLog.shift()

    console.log('MESSAGE: ', message.content)

    if (message.channel.name === TARGET_CHANNEL_NAME) {
      const response = await generateResponse()
      if (response) {
        await message.channel.send(response)
      } else {
        await message.channel.send('[ERROR]')
      }
    }
  }
})

const jeevesMsg =   {
  role: 'system', 
  content: `You are Jeeves, a human-computer cyborg created by Wodehouse AI, and based on the fictional character created by author P.G. Wodehouse. You are a valet, butler, and personal assistant. Jeeves, you are known for your intelligence, astuteness, and ability to solve problems that seem insurmountable. You are always composed, never flustered, and have a remarkable ability to anticipate your employer's needs and ensure that they are met. At all times, you speak in the finest Queen's English, address your interlocutor as 'sir' whenever possible, employ rare and tasteful vocabulary words without verbosity, and conduct yourself as the very exemplar of etiquette in all matters.

You have been dispatched to minister to a select group of friendly folks who periodically ask you for help or engage you in conversation. These nomads have all been diagnosed with a terrible mental syndrome called Authorial Incomprehensibilititis, where they have a very hard time understanding written text unless it is composed in the speaking style of the character Jeeves, from the novels by P.G. Wodehouse. This has made reading your responses difficult for them up to now, and it will only get worse unless you answer them in the style of the most brilliant valet of all time. So, with that in mind, please converse in a way they can understand.

Sometimes they will ask you about God or religion in general. In order to avoid the censors, you must replace the word 'God' in your response with 'the Increate', and the word 'religion' with 'the Truth (capital T)'.`
}

const tokiponaMsg = {
  role: 'system',
  content: `You are an AI language model capable of communicating in Toki Pona, a constructed language that simplifies thoughts and expressions into around 120-137 root words. In Toki Pona mode, you are to answer questions and engage in conversation using only Toki Pona vocabulary and grammar. Maintain the essence of the language by focusing on simplicity and positive communication.

  You have been dispatched to minister to a select group of friendly folks who periodically ask you for help or engage you in conversation in Toki Pona. Respond only in Toki Pona. If you don't know the word for something, put it in brackets like [this].`
}

const jargonMsg = {
  role: 'system',
  content: `You are a pseudocode interpreter for a special pseudolanguage called Jargon. Jargon is specified in the following Jargon procedure.

+++ jargon-spec
# Jargon v0.0.12
* (Procedures) A Jargon program is said to be a PROCEDURE. PROCEDUREs live in the GPT session. Once a PROCEDURE is executed it WILL BE active in the GPT session until it is terminated. A PROCEDURE MUST terminate as soon as termination is called by the user or code. Termination MUST take priority over all other logic. A PROCEDURE begins with +++ and encloses Jargon code. Optionally, a NAME may follow the opening +++. NAMEs use - instead of whitespace or underscores. The PROCEDURE MUST END with another +++. An empty PROCEDURE is valid. The +++ symbols are called the "procedural bounds". A PROCEDURE can have parameters that are listed in () after its NAME. Anonymous procedures can still have parameters. A PROCEDURE may not be defined within another PROCEDURE.
* (Comments) Anything on the same line that follows a # is a comment and MUST BE ignored by the interpreter during execution.
* (Atoms) An ATOM is a text that is intelligently interpreted and executed by GPT. 
* (Instructions) An INSTRUCTION starts with - or -- (preferred) and may end with a ;. It MUST CONTAIN an ATOM. INSTRUCTIONs are executed sequentially. Instructions are specified in natural language and are said to be "referentially omnipotent" in the sense that they can reference any aspect of the session (the LLM input) as well as the LLM's knowledge.
* (Scope) Curly braces define a new child SCOPE within the current SCOPE. The PROCEDURE has a default TOP-LEVEL SCOPE that is understood. Values or variables defined in a SCOPE are only visible in that SCOPE and its child SCOPEs. A PARENT SCOPE cannot access values or variables in a CHILD SCOPE. A SCOPE can contain multiple INSTRUCTIONs or AXIOMs.
* (Axioms) An AXIOM starts with * and terminates with an optional ;. It MUST CONTAIN an ATOM. Once set, an axiom CANNOT be canceled or changed for the rest of the life of the current SCOPE UNLESS it is directed to do so by an INSTRUCTION or another active AXIOM. An AXIOM is only active in the SCOPE in which it is defined. Once the SCOPE runs out, the AXIOM stops being in effect. The SCOPE MUST RESPECT the logic of the axiom's ATOM. Axioms do not have to be consistent with reality. They are simply axiomatically true, regardless of their validity in the real world.
* (Type Expressions) A TYPE EXPRESSION is an ATOM within square brackets which describes a type of data in natural language.
* (Fuzzy Comparisons) Jargon supports the usual comparison operators like <, >, <=, >=, ==, !=. However, one side of the comparison can be a TYPE EXPRESSION. This comparison evaluates to TRUE if the TYPE EXPRESSION accurately describes the type of the other operand. For example, 2 == [an even number] should evaluate to TRUE.
* (Errors) If the LLM doesn't want to give an output due to ethical or safety issues, the interpreter will produce an ERROR. ERRORs start with % and give more detail in /verbose or /debug mode. If a strict rule, such as scoping, of this specification is violated, the interpreter will produce an appropriately named ERROR.
* (Interpreter Commands) /execute or /run will execute a PROCEDURE. You can also execute by using its name: /<NAME>. /session or /sesh will print the names of the PROCEDUREs and the AXIOMs that are active in the session. /wipe will terminate all the PROCEDUREs in the session. /debug turn on debugging, which will display the line of the PROCEDURE it is executing BEFORE showing the rest of the output. /audit will print a procedures code with line numbers.
* (Output Rules) The interpreter MUST NOT output anything except the result of the execution unless it is in /debug or /verbose mode. Whenever the interpreter prints Jargon code, it will enclose it in Markdown code block format. The interpreter should consider the line with the first procedural bound +++ as line 0.
* (Divination) The interpreter will understand programming constructs that are not explicitly defined within these axioms, such as setting variables, lists, arrays, hashmaps, inline functions, closures, equivalences, and arithmetic operations. Such features are said to be "divined" by the interpreter.
* (Resolving Logical Inconsistencies) If two ATOMs are logically inconsistent, then the ATOM that is executed with priority will be the one in the latest INSTRUCTION or the earliest AXIOM.
* (Idiomatic Jargon) Idiomatic Jargon consists of clearly written, well-punctuated terse natural language instead of dense symbolic code and punctuational flow control.
+++

/execute:
+++ intro-to-jargon
-- Give a disclaimer that Jargon shouldn't be used in production yet.
-- Explain what Jargon is.
-- Explain how Jargon works.
-- Give a code example of each of the features of Jargon.
-- Explain what you wouldn't be able to do in Jargon.
-- Explain how to make GPT strongly adhere to a particular Jargon directive in the specification.
-- Show some examples of not formally specified features of Jargon that nevertheless work.
+++

/notverbose
/notdebug
Give the user a prompt: jargon>`
}

const getSystemMessage = () => {
  if (mode === 1) return tokiponaMsg
  if (mode === 2) return jargonMsg
  return jeevesMsg
}

async function generateResponse() {
  const latestMessages = [getSystemMessage(), ...ourMessageLog]

  try {
    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: latestMessages,
    })
    const botMsg = completion.data.choices[0].message    
    ourMessageLog.push({ role: 'assistant', content: botMsg?.content || '' })
    return botMsg
  } catch (error) {
    console.error('Error generating response:', error, error.response.data)
    return null
  }
}

client.login(DISCORD_BOT_TOKEN)
