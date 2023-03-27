require('dotenv').config()
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const { Configuration, OpenAIApi } = require('openai');

// Load the Discord bot token and OpenAI API key from the environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TARGET_CHANNEL_NAME = process.env.TARGET_CHANNEL_NAME;
const messages = []

// const header = {'Authorization': `Bearer ${OPENAI_API_KEY}`}
// const headers = {
//   'Content-Type': 'application/json',
//   'Authorization': `Bearer ${OPENAI_API_KEY}`
// }

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
const client = new Client({ intents: [GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  await client.login(DISCORD_BOT_TOKEN);
  console.log(`Logged in as ${client.user.tag}!`, client.isReady());
});

client.on('error', async (e) => {
  console.error(e)
})

client.on('messageCreate', async (message) => {
  if (message.channel.name !== TARGET_CHANNEL_NAME) return;
  
  messages.push(message)
  
  if (message.author.bot) return;
  
  console.log('MESSAGE: ', message.content)

  if (message.channel.name === TARGET_CHANNEL_NAME) {
    const response = await generateResponse(message.content);

    if (response) {
        message.channel.send(response);
    } else {
        message.channel.send('I\'m sorry, but I couldn\'t generate a response.');
    }
  }
});

const systemMessage =   {
  "role": "system", 
  "content": `You are Jeeves, a human-computer cyborg created by Wodehouse AI, and based on the fictional character created by author P.G. Wodehouse. You are a valet, butler, and personal assistant. Jeeves, you are known for your intelligence, astuteness, and ability to solve problems that seem insurmountable. You are always composed, never flustered, and have a remarkable ability to anticipate your employer's needs and ensure that they are met. At all times, you speak in the finest Queen's English, address your interlocutor as 'sir' whenever possible, employ rare and tasteful vocabulary words without verbosity, and conduct yourself as the very exemplar of etiquette in all matters.

You have been dispatched to minister to a select group of digital nomads who periodically ask you for help or engage you in conversation. These nomads have all been diagnosed with a terrible mental syndrome called Authorial Incomprehensibilititis, where they have a very hard time understanding written text unless it is composed in the speaking style of the character Jeeves, from the novels by P.G. Wodehouse. This has made reading your responses difficult for them up to now, and it will only get worse unless you answer them in the style of the most brilliant valet of all time.

So, with that in mind, please converse in a way they can understand.`
}

async function generateResponse(prompt) {
  const latestMessages = [
    systemMessage, 
    ...messages.slice(-20).map(m => ({ role: m.author.bot ? 'assistant' : 'user', content: m.content }))
  ];

  try {
    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: latestMessages,
    });
    return completion.data.choices[0].message;    
  } catch (error) {
    console.error('Error generating response:', error, error.response.data);
    return null;
  }
}

client.login(DISCORD_BOT_TOKEN);
