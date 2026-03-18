#!/usr/bin/env node
/**
 * Script to create a Confluence page with HTML to DOCX converter installation and troubleshooting instructions
 */

require('dotenv').config();
const axios = require('axios');

const confluenceApi = axios.create({
  baseURL: process.env.CONFLUENCE_BASE_URL,
  auth: {
    username: process.env.CONFLUENCE_EMAIL,
    password: process.env.CONFLUENCE_API_TOKEN
  },
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Get the space key from the parent page
async function getSpaceKeyFromPage(pageId) {
  try {
    const response = await confluenceApi.get(`/rest/api/content/${pageId}`, {
      params: {
        expand: 'space'
      }
    });
    return response.data.space.key;
  } catch (error) {
    console.error('Error getting space key:', error.response?.data || error.message);
    return process.env.CONFLUENCE_SPACE_KEY || 'RD';
  }
}

// Create the Confluence page
async function createConverterDocsPage(parentPageId) {
  try {
    const spaceKey = await getSpaceKeyFromPage(parentPageId);
    
    const pageContent = `
<h1>HTML to DOCX Converter - Installation & Troubleshooting Guide</h1>

<p>The HTML to DOCX converter is a Python script that converts HTML documentation files to Microsoft Word (.docx) format while preserving formatting, images, tables, and code blocks. This tool works on both Windows and Mac operating systems.</p>

<h2>Prerequisites</h2>

<p>Before installing the converter, ensure you have the following:</p>

<ul>
<li><strong>Python 3.6 or higher</strong> - The converter requires Python 3. Check your version by running:
<ul>
<li><strong>Windows:</strong> <code>python --version</code> or <code>py --version</code></li>
<li><strong>Mac/Linux:</strong> <code>python3 --version</code></li>
</ul>
</li>
<li><strong>pip</strong> - Python package installer (usually comes with Python)</li>
<li><strong>Internet connection</strong> - Required to download Python packages</li>
</ul>

<h2>Installation</h2>

<h3>Windows Installation</h3>

<ol>
<li><strong>Install Python 3</strong> (if not already installed):
<ul>
<li>Download Python from <a href="https://www.python.org/downloads/">python.org</a></li>
<li>During installation, check the box "Add Python to PATH"</li>
<li>Verify installation by opening Command Prompt and running: <code>python --version</code></li>
</ul>
</li>
<li><strong>Download the converter script</strong>:
<ul>
<li>Locate the <code>html_to_docx_converter.py</code> file</li>
<li>Note the full path to the file (e.g., <code>C:\\Users\\YourName\\Documents\\html_to_docx_converter.py</code>)</li>
</ul>
</li>
<li><strong>Install required Python packages</strong>:
<p>Open Command Prompt (cmd) or PowerShell and run:</p>
<pre><code>pip install python-docx beautifulsoup4 Pillow</code></pre>
<p>If you get a "pip is not recognized" error, try:</p>
<pre><code>python -m pip install python-docx beautifulsoup4 Pillow</code></pre>
<p>Or if you have multiple Python versions:</p>
<pre><code>py -3 -m pip install python-docx beautifulsoup4 Pillow</code></pre>
</li>
<li><strong>Test the installation</strong>:
<pre><code>python html_to_docx_converter.py --help</code></pre>
</li>
</ol>

<h3>Mac Installation</h3>

<ol>
<li><strong>Install Python 3</strong> (if not already installed):
<ul>
<li>Mac typically comes with Python 2.7, but you need Python 3</li>
<li>Install using Homebrew: <code>brew install python3</code></li>
<li>Or download from <a href="https://www.python.org/downloads/">python.org</a></li>
<li>Verify installation: <code>python3 --version</code></li>
</ul>
</li>
<li><strong>Download the converter script</strong>:
<ul>
<li>Locate the <code>html_to_docx_converter.py</code> file</li>
<li>Note the full path to the file</li>
</ul>
</li>
<li><strong>Install required Python packages</strong>:
<p>Open Terminal and run:</p>
<pre><code>pip3 install python-docx beautifulsoup4 Pillow</code></pre>
<p>If you get a permission error, you may need to use a virtual environment:</p>
<pre><code>python3 -m venv venv
source venv/bin/activate
pip install python-docx beautifulsoup4 Pillow</code></pre>
</li>
<li><strong>Test the installation</strong>:
<pre><code>python3 html_to_docx_converter.py --help</code></pre>
</li>
</ol>

<h2>Usage</h2>

<p>To convert an HTML file to DOCX format:</p>

<p><strong>Windows:</strong></p>
<pre><code>python html_to_docx_converter.py "path\\to\\file.html"</code></pre>

<p><strong>Mac/Linux:</strong></p>
<pre><code>python3 html_to_docx_converter.py /path/to/file.html</code></pre>

<p>To specify an output file:</p>
<pre><code>python html_to_docx_converter.py input.html output.docx</code></pre>

<h2>Troubleshooting</h2>

<h3>Common Issues on Windows</h3>

<p><strong>Issue: "python is not recognized as an internal or external command"</strong></p>
<ul>
<li><strong>Solution:</strong> Python is not in your PATH. Try:
<ul>
<li>Use <code>py</code> instead of <code>python</code>: <code>py html_to_docx_converter.py</code></li>
<li>Reinstall Python and check "Add Python to PATH" during installation</li>
<li>Manually add Python to PATH in System Environment Variables</li>
</ul>
</li>
</ul>

<p><strong>Issue: "pip is not recognized"</strong></p>
<ul>
<li><strong>Solution:</strong> Use one of these alternatives:
<ul>
<li><code>python -m pip install package-name</code></li>
<li><code>py -m pip install package-name</code></li>
<li><code>python3 -m pip install package-name</code></li>
</ul>
</li>
</ul>

<p><strong>Issue: "Permission denied" or "Access is denied"</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Run Command Prompt or PowerShell as Administrator</li>
<li>Or install packages for your user only: <code>pip install --user python-docx beautifulsoup4 Pillow</code></li>
</ul>
</li>
</ul>

<p><strong>Issue: "ModuleNotFoundError: No module named 'docx'"</strong></p>
<ul>
<li><strong>Solution:</strong> The package wasn't installed correctly. Try:
<ul>
<li><code>pip install --upgrade python-docx</code></li>
<li>Verify installation: <code>pip list | findstr docx</code></li>
<li>If using multiple Python versions, ensure you're using the same Python for both installation and running</li>
</ul>
</li>
</ul>

<p><strong>Issue: Images are not appearing in the DOCX file</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Ensure image paths in the HTML are relative to the HTML file location</li>
<li>Check that image files exist at the specified paths</li>
<li>Verify the HTML file and images are in the same directory structure as when the HTML was created</li>
</ul>
</li>
</ul>

<h3>Common Issues on Mac</h3>

<p><strong>Issue: "python3: command not found"</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Install Python 3: <code>brew install python3</code> (if you have Homebrew)</li>
<li>Or download from <a href="https://www.python.org/downloads/">python.org</a></li>
<li>Verify installation: <code>which python3</code></li>
</ul>
</li>
</ul>

<p><strong>Issue: "pip3: command not found"</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Install pip: <code>python3 -m ensurepip --upgrade</code></li>
<li>Or use: <code>python3 -m pip</code> instead of <code>pip3</code></li>
</ul>
</li>
</ul>

<p><strong>Issue: "externally-managed-environment" error</strong></p>
<ul>
<li><strong>Solution:</strong> macOS may prevent system-wide package installation. Use a virtual environment:
<pre><code>python3 -m venv venv
source venv/bin/activate
pip install python-docx beautifulsoup4 Pillow
python3 html_to_docx_converter.py file.html</code></pre>
<p>Remember to activate the virtual environment each time: <code>source venv/bin/activate</code></p>
</li>
</ul>

<p><strong>Issue: "Permission denied" when installing packages</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Don't use <code>sudo</code> with pip (it can cause issues)</li>
<li>Use a virtual environment instead (see above)</li>
<li>Or install for your user only: <code>pip3 install --user python-docx beautifulsoup4 Pillow</code></li>
</ul>
</li>
</ul>

<p><strong>Issue: "zsh: command not found: python"</strong></p>
<ul>
<li><strong>Solution:</strong> On newer Macs, use <code>python3</code> instead of <code>python</code></li>
</ul>

<h3>General Troubleshooting</h3>

<p><strong>Issue: Script runs but produces empty or malformed DOCX file</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Check that the HTML file is valid and readable</li>
<li>Verify the HTML file path is correct (use absolute path if relative path fails)</li>
<li>Check for error messages in the terminal output</li>
<li>Ensure the HTML file contains actual content (not just navigation/headers)</li>
</ul>
</li>
</ul>

<p><strong>Issue: "FileNotFoundError" or "No such file or directory"</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>Use absolute file paths instead of relative paths</li>
<li>On Windows, use double backslashes or forward slashes: <code>C:\\Users\\...\\file.html</code> or <code>C:/Users/.../file.html</code></li>
<li>On Mac/Linux, ensure paths start with <code>/</code> for absolute paths</li>
<li>Check file permissions - ensure the file is readable</li>
</ul>
</li>
</ul>

<p><strong>Issue: Tables or formatting look incorrect in DOCX</strong></p>
<ul>
<li><strong>Solution:</strong>
<ul>
<li>This is expected - some complex HTML formatting may not translate perfectly</li>
<li>Open the DOCX in Microsoft Word or Google Docs and manually adjust formatting if needed</li>
<li>Complex CSS styling is not preserved (only basic formatting like bold, italic, headings)</li>
</ul>
</li>
</ul>

<p><strong>Issue: Code blocks don't have syntax highlighting</strong></p>
<ul>
<li><strong>Solution:</strong> This is expected - the converter preserves code as monospace text but doesn't include syntax highlighting. You can add it manually in Word/Google Docs if needed.</li>
</ul>

<h2>Getting Help</h2>

<p>If you continue to experience issues:</p>

<ol>
<li>Check that all prerequisites are installed correctly</li>
<li>Verify Python version: <code>python --version</code> (Windows) or <code>python3 --version</code> (Mac)</li>
<li>Verify packages are installed: <code>pip list</code> (Windows) or <code>pip3 list</code> (Mac)</li>
<li>Check the script file path and permissions</li>
<li>Review error messages carefully - they often indicate the specific problem</li>
<li>Contact your IT support or the documentation team for assistance</li>
</ol>

<h2>Additional Resources</h2>

<ul>
<li><a href="https://www.python.org/downloads/">Python Downloads</a></li>
<li><a href="https://pip.pypa.io/en/stable/">pip Documentation</a></li>
<li><a href="https://python-docx.readthedocs.io/">python-docx Documentation</a></li>
</ul>
`;

    const pageData = {
      type: 'page',
      title: 'HTML to DOCX Converter - Installation & Troubleshooting',
      space: {
        key: spaceKey
      },
      ancestors: [
        {
          id: parentPageId
        }
      ],
      body: {
        storage: {
          value: pageContent,
          representation: 'storage'
        }
      }
    };

    console.log('Creating Confluence page...');
    const response = await confluenceApi.post('/rest/api/content', pageData);
    
    console.log('✅ Page created successfully!');
    console.log(`Page ID: ${response.data.id}`);
    console.log(`Page URL: ${process.env.CONFLUENCE_BASE_URL}${response.data._links.webui}`);
    console.log(`Title: ${response.data.title}`);
    
    return response.data;
  } catch (error) {
    console.error('❌ Error creating page:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Message:', error.message);
    }
    process.exit(1);
  }
}

// Main execution
const parentPageId = process.argv[2] || '3168376048';

if (!parentPageId) {
  console.error('Please provide a parent page ID');
  console.log('Usage: node create_converter_docs_page.js [parentPageId]');
  process.exit(1);
}

createConverterDocsPage(parentPageId);
