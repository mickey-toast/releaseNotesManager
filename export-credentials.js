#!/usr/bin/env node

/**
 * Helper script to create config.json from browser localStorage
 * 
 * Instructions:
 * 1. Open the Confluence Release Manager app in your browser
 * 2. Open the browser console (F12 or Cmd+Option+I)
 * 3. Run this command:
 *    JSON.stringify(JSON.parse(localStorage.getItem("confluenceSettings")), null, 2)
 * 4. Copy the output
 * 5. Paste it into a file called config.json in this directory
 * 
 * OR run this script and paste the JSON when prompted
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const configPath = path.join(__dirname, 'config.json');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('📋 Credential Export Helper');
console.log('============================\n');
console.log('To get your credentials from the browser:');
console.log('1. Open the Confluence Release Manager in your browser');
console.log('2. Open the browser console (F12 or Cmd+Option+I)');
console.log('3. Run: JSON.stringify(JSON.parse(localStorage.getItem("confluenceSettings")), null, 2)');
console.log('4. Copy the output\n');
console.log('Paste the JSON output below (press Ctrl+D or Cmd+D when done, or type "exit" to cancel):\n');

let input = '';

rl.on('line', (line) => {
  if (line.trim().toLowerCase() === 'exit') {
    console.log('\n❌ Cancelled');
    rl.close();
    process.exit(0);
  }
  input += line + '\n';
});

rl.on('close', () => {
  if (!input.trim()) {
    console.log('\n❌ No input provided');
    process.exit(1);
  }

  try {
    const config = JSON.parse(input);
    
    // Transform to the format we need
    const output = {
      email: config.email,
      apiToken: config.apiToken,
      baseUrl: config.baseUrl || 'https://toasttab.atlassian.net/wiki'
    };

    if (!output.email || !output.apiToken) {
      console.log('\n❌ Invalid config: missing email or apiToken');
      console.log('Expected format: { "email": "...", "apiToken": "...", "baseUrl": "..." }');
      process.exit(1);
    }

    fs.writeFileSync(configPath, JSON.stringify(output, null, 2));
    console.log(`\n✅ Credentials saved to ${configPath}`);
    console.log('You can now run: node update-launchnotes-guide.js');
  } catch (err) {
    console.log(`\n❌ Error parsing JSON: ${err.message}`);
    process.exit(1);
  }
});
