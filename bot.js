const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const axios = require('axios');
const dotenv = require('dotenv').config();
const { MongoClient } = require('mongodb');

// Replace with your MongoDB connection string
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017'; // Example URI, update as needed
const dbName = 'telegram_bot_db'; // Name of the database

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const RAPID_API_KEY = process.env.RAPID_API_KEY || '';
const DICTIONARY_API_KEY = process.env.DICTIONARY_API_KEY || '';

const client = new MongoClient(mongoURI, { useUnifiedTopology: true });

async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    return client.db(dbName);
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

const dbPromise = connectToDatabase();

// Replace 'YOUR_BOT_TOKEN' with the token you received from BotFather
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
  polling: true,
});

bot.onText(/\/getwordmeaning/, async (msg) => {
  const chatId = msg.chat.id;
  fetchAndSaveWords();

  try {
    const word = await fetchUnusedWord();

    if (word) {
      const meanings = await fetchMeaning(word);

      if (meanings) {
        let formattedMeanings = '';
        meanings.forEach((meaning) => {
          const formattedMeaning = meanings
            .map((meaning, index) => {
              const formattedText = `(${
                meaning.figureOfSpeech
              }) ${meaning.meaning.join(', \n')}`;
              return `${index || '' + 1}. ${formattedText}`;
            })
            .join('\n');
          formattedMeanings += formattedMeaning + `\n\n`;
        });

        const message = `Here's your daily word:\nWord: ${word}\nMeanings:\n${formattedMeanings}`;
        const data = await bot.sendMessage(chatId, message);
        console.log("🚀 ~ file: bot.js:60 ~ bot.onText ~ data:", data)
      }
    }
  } catch (error) {
    bot.sendMessage(
      chatId,
      'An error occurred while fetching and processing word meanings.'
    );
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      keyboard: [[{ text: 'Yes' }, { text: 'No' }]],
      one_time_keyboard: true,
    },
  };
  bot.sendMessage(chatId, 'Want to start receiving a word daily?', opts);
});

bot.onText(/\/subscribe/, (msg) => {
  const chatId = msg.chat.id;
  // You can add code here to handle subscribing the user
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text.toLowerCase();

  // Handle user response
  if (text === 'yes') {
    const db = await dbPromise;
    const subscribedUsersCollection = db.collection('subscribedUsers');

    if (!(await subscribedUsersCollection.findOne({ chatId }))) {
      await subscribedUsersCollection.insertOne({ chatId });
      bot.sendMessage(
        chatId,
        'You are now subscribed to receive a word daily! please type /stop to unsubscribe'
      );
    } else {
      bot.sendMessage(chatId, 'You are already subscribed.');
    }
  } else if (text === 'no') {
    bot.sendMessage(chatId, "Okay, no problem. You won't receive daily words.");
  } else {
    const paths = ['/start', '/stop', '/getwordmeaning'];
    if (paths.includes(text)) {
      return;
    }
    bot.sendMessage(
      chatId,
      'Welcome! To start receiving a word daily, please type /start or type /getwordmeaning for trial.'
    );
  }
});

async function fetchAndSaveWords() {
  try {
    const response = await axios.get(
      'https://random-words5.p.rapidapi.com/getMultipleRandom?count=10',
      {
        headers: {
          'X-RapidAPI-Host': 'random-words5.p.rapidapi.com',
          'X-RapidAPI-Key': RAPID_API_KEY, // Replace with your actual API key
        },
      }
    );

    const words = response.data;
    const db = await dbPromise;
    const wordsCollection = db.collection('words');

    for (const word of words) {
      await wordsCollection.insertOne({ word });
      console.log(`Word "${word}" saved to the 'words' collection.`);
    }
  } catch (error) {
    console.error('Error fetching or saving words:', error);
    fetchAndSaveWords();
  }
}

async function fetchMeaning(word) {
  try {
    const apiKey = DICTIONARY_API_KEY; // Replace with your actual API key
    const response = await axios.get(
      `https://www.dictionaryapi.com/api/v3/references/learners/json/${word}?key=${apiKey}`
    );

    if (Array.isArray(response.data)) {
      const meanings = response.data
        .map((entry) => {
          return {
            figureOfSpeech: entry.fl,
            meaning: entry.shortdef,
            example: entry.dros?.map((ele) => ele.drp),
          };
        })
        .filter((meaning) => meaning !== null);

      return meanings;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching word meaning:', error);
    return null;
  }
}

async function fetchUnusedWord() {
  try {
    const db = await dbPromise;
    const wordsCollection = db.collection('words');
    const unusedWord = await wordsCollection.findOneAndUpdate(
      { isUsed: { $ne: true } },
      { $set: { isUsed: true } },
      { sort: { _id: 1 } }
    );

    return unusedWord?.value?.word;
    null;
  } catch (error) {
    console.error('Error fetching an unused word:', error);
    return null;
  }
}

async function sendDailyWordsToSubscribers() {
  try {
    const db = await dbPromise;
    const subscribedUsersCollection = db.collection('subscribedUsers');
    const subscribedUsers = await subscribedUsersCollection.find({}).toArray();

    for (const user of subscribedUsers) {
      const chatId = user.chatId;
      const word = await fetchUnusedWord();

      if (word) {
        const meanings = await fetchMeaning(word);

        if (meanings) {
          let formattedMeanings = '';
          meanings.forEach((meaning) => {
            const formattedMeaning = meanings
              .map((meaning, index) => {
                const formattedText = `(${
                  meaning.figureOfSpeech
                }) ${meaning.meaning.join(', \n')}`;
                return `${index || '' + 1}. ${formattedText}`;
              })
              .join('\n');
            formattedMeanings += formattedMeaning + `\n\n`;
          });

          const message = `Here's your daily word:\nWord: ${word}\nMeanings:\n${formattedMeanings}`;
          const data = await bot.sendMessage(chatId, message);
        }
      }
    }
  } catch (error) {
    console.error('Error sending daily words:', error);
    sendDailyWordsToSubscribers();
  }
}
bot.onText(/\/stop/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const db = await dbPromise;
    const subscribedUsersCollection = db.collection('subscribedUsers');
    const deletedUser = await subscribedUsersCollection.findOneAndDelete({
      chatId,
    });

    if (deletedUser.value) {
      bot.sendMessage(
        chatId,
        'You have been unsubscribed. To subscribe again, use /start.'
      );
    } else {
      bot.sendMessage(chatId, 'You are not currently subscribed.');
    }
  } catch (error) {
    console.error('Error unsubscribing user:', error);
    bot.sendMessage(
      chatId,
      'An error occurred while unsubscribing. Please try again later.'
    );
  }
});

schedule.scheduleJob('0 8 * * *', () => {
  sendDailyWordsToSubscribers();
  fetchAndSaveWords();
});
