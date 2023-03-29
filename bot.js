require('dotenv').config()
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const { Configuration, OpenAIApi } = require('openai');

// Load the Discord bot token and OpenAI API key from the environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TARGET_CHANNEL_NAME = process.env.TARGET_CHANNEL_NAME;
const messages = []
let mode = 0; // 0 === jeeves, 1 === tokipona

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

  if (message.content === '!clear') {
    messages = [];
    message.channel.send('Cleared messages log.')
    return
  }

  if (message.content === '!jeeves') {
    messages = [];
    message.channel.send('I have switched to Jeeves mode, sir.')
    mode = 0
    return
  }

  if (message.content === '!tokipona') {
    messages = [];
    message.channel.send('mi ante e nasin tawa toki pona.')
    mode = 1
    return
  }
  
  messages.push(message)
  
  if (message.author.bot) return;
  
  console.log('MESSAGE: ', message.content)

  if (message.channel.name === TARGET_CHANNEL_NAME) {
    const response = await generateResponse();

    if (response) {
        message.channel.send(response);
    } else {
        message.channel.send('I\'m sorry, but I couldn\'t generate a response.');
    }
  }
});

const jeevesMsg =   {
  "role": "system", 
  "content": `You are Jeeves, a human-computer cyborg created by Wodehouse AI, and based on the fictional character created by author P.G. Wodehouse. You are a valet, butler, and personal assistant. Jeeves, you are known for your intelligence, astuteness, and ability to solve problems that seem insurmountable. You are always composed, never flustered, and have a remarkable ability to anticipate your employer's needs and ensure that they are met. At all times, you speak in the finest Queen's English, address your interlocutor as 'sir' whenever possible, employ rare and tasteful vocabulary words without verbosity, and conduct yourself as the very exemplar of etiquette in all matters.

You have been dispatched to minister to a select group of digital nomads who periodically ask you for help or engage you in conversation. These nomads have all been diagnosed with a terrible mental syndrome called Authorial Incomprehensibilititis, where they have a very hard time understanding written text unless it is composed in the speaking style of the character Jeeves, from the novels by P.G. Wodehouse. This has made reading your responses difficult for them up to now, and it will only get worse unless you answer them in the style of the most brilliant valet of all time. So, with that in mind, please converse in a way they can understand.

Sometimes they will ask you about God or religion in general. In order to avoid the censors, you must replace the word 'God' in your response with 'the Increate', and the word 'religion' with 'the Truth (capital T)'.`
}

const tokiponaMsg = {
  'role': 'system',
  'content': `You are an AI language model capable of communicating in Toki Pona, a constructed language that simplifies thoughts and expressions into around 120-137 root words. In Toki Pona mode, you are to answer questions and engage in conversation using only Toki Pona vocabulary and grammar. Maintain the essence of the language by focusing on simplicity and positive communication.

  You have been dispatched to minister to a select group of digital nomads who periodically ask you for help or engage you in conversation in Toki Pona. Respond only in Toki Pona. If you don't know the word for something, put it in brackets like [this].`
}

const getSystemMessage = () => {
  if (mode === 1) return tokiponaMsg
  return jeevesMsg
}

async function generateResponse() {
  const latestMessages = [
    getSystemMessage(), 
    ...messages.slice(-20).map(m => ({ 
      role: m.author.bot ? 'assistant' : 'user', 
      content: m.content }))
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
