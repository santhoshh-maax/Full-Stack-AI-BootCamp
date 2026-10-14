require('dotenv').config();

const apiKey = (process.env.AI_API_KEY || '').trim();

if (!apiKey) {
  console.error('\n❌ ERROR: AI_API_KEY is missing or empty in .env\n');
  process.exit(1);
}

console.log('\n--- Checking Anthropic API Key ---');
console.log('Key prefix:', apiKey.slice(0, 15) + '...');
console.log('Key length:', apiKey.length, 'characters\n');

// Valid Anthropic model identifiers for this account
const candidateModels = [
  process.env.AI_MODEL,
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022'
].filter(Boolean);

const modelsToTest = [...new Set(candidateModels)];

async function testModel(model) {
  process.stdout.write(`Testing model "${model}"... `);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 15,
        messages: [{ role: 'user', content: 'Say hello in 3 words' }]
      })
    });

    const data = await res.json();

    if (res.ok) {
      console.log('✅ SUCCESS!');
      console.log(`\n🎉 Model "${model}" is working with your API key!`);
      console.log('Anthropic replied:', data.content?.[0]?.text?.trim() || JSON.stringify(data));
      console.log(`\n👉 Set AI_MODEL=${model} in your backend/.env file.`);
      return true;
    } else {
      console.log(`❌ ${res.status} (${data.error?.type || 'error'}: ${data.error?.message || JSON.stringify(data)})`);
      return null;
    }
  } catch (err) {
    console.log(`❌ Network error: ${err.message}`);
    return null;
  }
}

async function run() {
  for (const model of modelsToTest) {
    const success = await testModel(model);
    if (success) {
      console.log('----------------------------------\n');
      return;
    }
  }
  console.log('\nNone of the tested models succeeded. Check error messages above.');
  console.log('----------------------------------\n');
}

run();
