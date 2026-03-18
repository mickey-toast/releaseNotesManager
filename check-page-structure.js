#!/usr/bin/env node

/**
 * Diagnostic script to check the structure of the LaunchNotes page
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const LAUNCHNOTES_GUIDE_PAGE_ID = '4471193630';

// Get credentials
let email, apiToken, baseUrl;
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  email = config.email;
  apiToken = config.apiToken;
  baseUrl = config.baseUrl || 'https://toasttab.atlassian.net/wiki';
}

const confluenceApi = axios.create({
  baseURL: baseUrl,
  auth: { username: email, password: apiToken },
  headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

async function checkPageStructure() {
  try {
    const response = await confluenceApi.get(`/rest/api/content/${LAUNCHNOTES_GUIDE_PAGE_ID}`, {
      params: { expand: 'body.storage,body.view,version' }
    });
    
    const content = response.data.body?.storage?.value || '';
    const hasRoadmap = content.includes('Creating Roadmap Items');
    
    console.log('Page Structure Analysis');
    console.log('======================');
    console.log('Version:', response.data.version.number);
    console.log('Has roadmap section:', hasRoadmap);
    console.log('Content length:', content.length);
    console.log('\nLast 1000 characters:');
    console.log(content.slice(-1000));
    console.log('\n\nFirst 500 characters:');
    console.log(content.slice(0, 500));
    
    // Check for roadmap section location
    if (hasRoadmap) {
      const roadmapIndex = content.indexOf('Creating Roadmap Items');
      console.log('\n\nRoadmap section found at index:', roadmapIndex);
      console.log('Context around roadmap section:');
      console.log(content.substring(Math.max(0, roadmapIndex - 200), Math.min(content.length, roadmapIndex + 500)));
    }
    
    // Check for closing tags
    const closingTags = content.match(/<\/[^>]+>/g);
    console.log('\n\nLast 10 closing tags:');
    if (closingTags) {
      console.log(closingTags.slice(-10));
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkPageStructure();
