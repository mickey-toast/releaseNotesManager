const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let serverProcess;

// Start the Express server
function startServer() {
  // When packaged, __dirname points to app.asar/electron or app.asar.unpacked/electron
  // Server files are in the app bundle
  let serverPath;
  let appRoot;
  
  if (app.isPackaged) {
    // In packaged app, server is in extraResources or app.asar.unpacked
    appRoot = process.resourcesPath || path.join(path.dirname(app.getPath('exe')), '..', 'Resources');
    
    // Try multiple possible locations
    const possiblePaths = [
      path.join(appRoot, 'server', 'index.js'), // extraResources location
      path.join(appRoot, 'app.asar.unpacked', 'server', 'index.js'), // asarUnpack location
      path.join(appRoot, 'app', 'server', 'index.js') // fallback
    ];
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        serverPath = possiblePath;
        break;
      }
    }
    
    // If still not found, try to find it
    if (!serverPath || !fs.existsSync(serverPath)) {
      console.error('Server file not found. Tried:', possiblePaths);
      serverPath = possiblePaths[0]; // Use first as default, will show error when trying to run
    }
  } else {
    // Development mode
    appRoot = path.join(__dirname, '..');
    serverPath = path.join(__dirname, '../server/index.js');
  }
  
  // Look for .env file in multiple locations
  const envPaths = [
    path.join(appRoot, '.env'),
    path.join(appRoot, 'resources', '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getPath('userData'), '.env'),
    path.join(__dirname, '..', '.env')
  ];
  
  let envFile = null;
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      envFile = envPath;
      break;
    }
  }
  
  // Set environment to production for Electron
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '3001'
  };
  
  // Load .env file if found
  if (envFile) {
    try {
      const envContent = fs.readFileSync(envFile, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=:#]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          if (key && value) {
            env[key] = value;
          }
        }
      });
    } catch (err) {
      console.error('Error reading .env file:', err);
    }
  }

  // Use the correct working directory
  const cwd = app.isPackaged ? appRoot : path.join(__dirname, '..');
  
  // Set NODE_PATH to include node_modules from asar
  if (app.isPackaged) {
    const asarNodeModules = path.join(appRoot, 'app.asar', 'node_modules');
    env.NODE_PATH = asarNodeModules + (env.NODE_PATH ? path.delimiter + env.NODE_PATH : '');
  }
  
  console.log('Starting server from:', serverPath);
  console.log('Working directory:', cwd);
  console.log('Server exists:', fs.existsSync(serverPath));
  console.log('NODE_PATH:', env.NODE_PATH);

  // Use electron's Node.js (process.execPath) instead of system node
  // This allows access to node_modules in the asar
  const nodeExecutable = app.isPackaged ? process.execPath : 'node';
  const nodeArgs = app.isPackaged ? [serverPath] : [serverPath];
  
  serverProcess = spawn(nodeExecutable, nodeArgs, {
    env,
    cwd: cwd,
    stdio: ['ignore', 'pipe', 'pipe'] // Capture output for debugging
  });
  
  // Log server output for debugging
  serverProcess.stdout.on('data', (data) => {
    console.log(`Server stdout: ${data}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`Server stderr: ${data}`);
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
  });

  serverProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Server process exited with code ${code}`);
    }
  });
}

// Stop the server when app quits
function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    },
    icon: path.join(__dirname, 'icon.png'), // Optional: add an icon
    show: false // Don't show until ready
  });

  // Wait for server to be ready before loading
  const checkServer = setInterval(() => {
    const http = require('http');
    const req = http.get('http://localhost:3001/api/config', (res) => {
      if (res.statusCode === 200) {
        clearInterval(checkServer);
        mainWindow.loadURL('http://localhost:3001');
        mainWindow.show();
      }
    });
    req.on('error', () => {
      // Server not ready yet, keep waiting
    });
  }, 500);

  // Timeout after 30 seconds
  setTimeout(() => {
    clearInterval(checkServer);
    if (!mainWindow.isVisible()) {
      mainWindow.loadURL('http://localhost:3001');
      mainWindow.show();
    }
  }, 30000);

  // Open DevTools in development or for debugging
  if (isDev || process.env.DEBUG === 'true') {
    mainWindow.webContents.openDevTools();
  }
  
  // Show window even if server check fails (for debugging)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
    // Show window anyway so user can see what's happening
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about', label: 'About' },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide ' + app.getName() },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit ' + app.getName() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'close', label: 'Close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createMenu();
  startServer();
  
  // Wait a bit for server to start
  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

app.on('will-quit', () => {
  stopServer();
});

// Handle app termination
process.on('SIGTERM', () => {
  stopServer();
  app.quit();
});

process.on('SIGINT', () => {
  stopServer();
  app.quit();
});
