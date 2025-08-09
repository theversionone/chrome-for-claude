import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import CDP from 'chrome-remote-interface';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import open from 'open';
import psList from 'ps-list';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ChromeController {
  constructor(config = {}) {
    this.port = config.chrome_port || 9222;
    this.chromePath = config.chrome_path || null;
    this.autoLaunch = config.auto_launch !== false;
    this.headless = config.headless || false;
    this.timeout = config.timeout || 30000;
    this.isolatedProfile = config.isolated_profile !== false;
    this.userDataDir = config.user_data_dir || path.join(os.tmpdir(), `chrome-debug-${Date.now()}`);
    this.screenshotDir = path.join(os.tmpdir(), 'chrome-control-screenshots');
    this.client = null;
    this.isConnected = false;
    
    // Ensure screenshot directory exists
    this.ensureScreenshotDir();
  }

  async ensureScreenshotDir() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create screenshot directory:', error);
    }
  }

  async cleanupOldScreenshots() {
    try {
      const files = await fs.readdir(this.screenshotDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const file of files) {
        if (file.startsWith('screenshot_') && (file.endsWith('.png') || file.endsWith('.jpg'))) {
          const filePath = path.join(this.screenshotDir, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old screenshots:', error);
    }
  }

  async findChromePath() {
    if (this.chromePath) return this.chromePath;

    const platform = process.platform;
    const possiblePaths = {
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ],
      win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      ],
      linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ],
    };

    const paths = possiblePaths[platform] || [];
    for (const chromePath of paths) {
      try {
        await fs.access(chromePath);
        return chromePath;
      } catch {
        continue;
      }
    }

    throw new Error('Chrome executable not found. Please specify chrome_path in configuration.');
  }

  async isChromeRunning() {
    try {
      const processes = await psList();
      return processes.some(p => 
        p.name.toLowerCase().includes('chrome') || 
        p.name.toLowerCase().includes('chromium')
      );
    } catch {
      return false;
    }
  }

  async launchChrome() {
    const chromePath = await this.findChromePath();
    const args = [
      `--remote-debugging-port=${this.port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ];

    // Add isolated profile support
    if (this.isolatedProfile) {
      args.push(`--user-data-dir=${this.userDataDir}`);
      // Create user data directory if it doesn't exist
      try {
        await fs.mkdir(this.userDataDir, { recursive: true });
      } catch (error) {
        console.error('Failed to create user data directory:', error);
      }
    }

    if (this.headless) {
      args.push('--headless=new');
    }

    console.error(`Launching Chrome with args: ${args.join(' ')}`);

    const chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore',
    });

    chromeProcess.unref();

    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time
  }

  async connect() {
    if (this.isConnected && this.client) {
      return this.client;
    }

    try {
      const targets = await CDP.List({ port: this.port });
      if (targets.length === 0) {
        throw new Error('No Chrome targets available');
      }

      const target = targets.find(t => t.type === 'page') || targets[0];
      this.client = await CDP({ target: target.webSocketDebuggerUrl });
      
      await this.client.Page.enable();
      await this.client.Runtime.enable();
      await this.client.Network.enable();
      
      this.isConnected = true;
      return this.client;
    } catch (error) {
      if (this.autoLaunch && !await this.isChromeRunning()) {
        await this.launchChrome();
        return this.connect();
      }
      throw new Error(`Failed to connect to Chrome: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.isConnected = false;
    }
  }

  async getTargets() {
    try {
      return await CDP.List({ port: this.port });
    } catch (error) {
      if (this.autoLaunch) {
        await this.launchChrome();
        return await CDP.List({ port: this.port });
      }
      throw error;
    }
  }

  async createTab(url) {
    const targets = await this.getTargets();
    const response = await CDP.New({ port: this.port, url });
    return response;
  }

  async closeTab(tabId) {
    await CDP.Close({ port: this.port, id: tabId });
    return { success: true };
  }

  async activateTab(tabId) {
    await CDP.Activate({ port: this.port, id: tabId });
    return { success: true };
  }

  async withTab(tabId, callback) {
    let client = null;
    try {
      const targets = await this.getTargets();
      const target = targets.find(t => t.id === tabId);
      
      if (!target) {
        throw new Error(`Tab with ID ${tabId} not found`);
      }

      client = await CDP({ target: target.webSocketDebuggerUrl });
      await client.Page.enable();
      await client.Runtime.enable();
      
      const result = await callback(client);
      return result;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }

  async executeInTab(tabId, expression) {
    return this.withTab(tabId, async (client) => {
      const result = await client.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true,
      });

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'JavaScript execution error');
      }

      return result.result.value;
    });
  }

  async navigateTab(tabId, url) {
    return this.withTab(tabId, async (client) => {
      await client.Page.navigate({ url });
      await client.Page.loadEventFired();
      return { success: true, url };
    });
  }

  async reloadTab(tabId) {
    return this.withTab(tabId, async (client) => {
      await client.Page.reload();
      return { success: true };
    });
  }

  async goBack(tabId) {
    return this.withTab(tabId, async (client) => {
      const history = await client.Page.getNavigationHistory();
      if (history.currentIndex > 0) {
        await client.Page.navigateToHistoryEntry({
          entryId: history.entries[history.currentIndex - 1].id
        });
        return { success: true };
      }
      return { success: false, message: 'No previous page in history' };
    });
  }

  async goForward(tabId) {
    return this.withTab(tabId, async (client) => {
      const history = await client.Page.getNavigationHistory();
      if (history.currentIndex < history.entries.length - 1) {
        await client.Page.navigateToHistoryEntry({
          entryId: history.entries[history.currentIndex + 1].id
        });
        return { success: true };
      }
      return { success: false, message: 'No next page in history' };
    });
  }

  async getPageContent(tabId) {
    return this.withTab(tabId, async (client) => {
      const result = await client.Runtime.evaluate({
        expression: 'document.documentElement.outerHTML',
        returnByValue: true,
      });
      return result.result.value;
    });
  }

  async takeScreenshot(tabId, format = 'png') {
    return this.withTab(tabId, async (client) => {
      // Cleanup old screenshots periodically
      if (Math.random() < 0.1) { // 10% chance to cleanup
        await this.cleanupOldScreenshots();
      }

      const screenshot = await client.Page.captureScreenshot({
        format,
        quality: format === 'jpeg' ? 80 : undefined,
      });

      // Generate unique filename
      const timestamp = Date.now();
      const randomId = crypto.randomBytes(4).toString('hex');
      const extension = format === 'jpeg' ? 'jpg' : 'png';
      const filename = `screenshot_${timestamp}_${randomId}.${extension}`;
      const filePath = path.join(this.screenshotDir, filename);

      // Save screenshot to file
      const buffer = Buffer.from(screenshot.data, 'base64');
      await fs.writeFile(filePath, buffer);

      return {
        path: filePath,
        filename: filename,
        format: format,
        size: buffer.length,
        timestamp: new Date().toISOString(),
        tabId: tabId
      };
    });
  }
}

// Initialize with user configuration (will be populated from environment or config)
const chromeController = new ChromeController({
  chrome_port: process.env.CHROME_PORT ? parseInt(process.env.CHROME_PORT) : 9222,
  chrome_path: process.env.CHROME_PATH || null,
  auto_launch: process.env.AUTO_LAUNCH !== 'false',
  headless: process.env.HEADLESS === 'true',
  timeout: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT) : 30000,
  isolated_profile: process.env.ISOLATED_PROFILE !== 'false',
  user_data_dir: process.env.USER_DATA_DIR || null,
});

const server = new Server(
  {
    name: 'chrome-control',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'open_url',
        description: 'Open a URL in Chrome browser',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to open',
            },
            new_tab: {
              type: 'boolean',
              description: 'Open in a new tab (default: true)',
              default: true,
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'list_tabs',
        description: 'List all open tabs in Chrome',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_current_tab',
        description: 'Get information about the current active tab',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'close_tab',
        description: 'Close a specific tab by ID',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab to close',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'switch_tab',
        description: 'Switch to a specific tab',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab to switch to',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'reload_tab',
        description: 'Reload a specific tab',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab to reload',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'go_back',
        description: 'Navigate back in browser history',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'go_forward',
        description: 'Navigate forward in browser history',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'execute_javascript',
        description: 'Execute JavaScript code in a tab',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab',
            },
            code: {
              type: 'string',
              description: 'JavaScript code to execute',
            },
          },
          required: ['tab_id', 'code'],
        },
      },
      {
        name: 'get_page_content',
        description: 'Get the HTML content of a page',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'take_screenshot',
        description: 'Take a screenshot of a tab',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab',
            },
            format: {
              type: 'string',
              enum: ['png', 'jpeg'],
              description: 'Screenshot format (default: png)',
              default: 'png',
            },
          },
          required: ['tab_id'],
        },
      },
      {
        name: 'search_tabs',
        description: 'Search tabs by title or URL',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query to match against tab titles and URLs',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'navigate_to',
        description: 'Navigate a specific tab to a URL',
        inputSchema: {
          type: 'object',
          properties: {
            tab_id: {
              type: 'string',
              description: 'The ID of the tab',
            },
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
          },
          required: ['tab_id', 'url'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'open_url': {
        const { url, new_tab = true } = args;
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          throw new Error('URL must start with http:// or https://');
        }

        if (new_tab) {
          const tab = await chromeController.createTab(url);
          result = {
            success: true,
            tab_id: tab.id,
            url: url,
            message: `Opened ${url} in new tab`,
          };
        } else {
          const targets = await chromeController.getTargets();
          const activeTab = targets.find(t => t.type === 'page');
          if (activeTab) {
            await chromeController.navigateTab(activeTab.id, url);
            result = {
              success: true,
              tab_id: activeTab.id,
              url: url,
              message: `Navigated current tab to ${url}`,
            };
          } else {
            const tab = await chromeController.createTab(url);
            result = {
              success: true,
              tab_id: tab.id,
              url: url,
              message: `Opened ${url} in new tab (no active tab found)`,
            };
          }
        }
        break;
      }

      case 'list_tabs': {
        const targets = await chromeController.getTargets();
        const tabs = targets
          .filter(t => t.type === 'page')
          .map(t => ({
            id: t.id,
            title: t.title,
            url: t.url,
            type: t.type,
          }));
        
        result = {
          tabs: tabs,
          count: tabs.length,
        };
        break;
      }

      case 'get_current_tab': {
        const targets = await chromeController.getTargets();
        const activeTab = targets.find(t => t.type === 'page');
        
        if (activeTab) {
          result = {
            id: activeTab.id,
            title: activeTab.title,
            url: activeTab.url,
            type: activeTab.type,
          };
        } else {
          result = {
            error: 'No active tab found',
          };
        }
        break;
      }

      case 'close_tab': {
        const { tab_id } = args;
        await chromeController.closeTab(tab_id);
        result = {
          success: true,
          message: `Tab ${tab_id} closed`,
        };
        break;
      }

      case 'switch_tab': {
        const { tab_id } = args;
        await chromeController.activateTab(tab_id);
        result = {
          success: true,
          message: `Switched to tab ${tab_id}`,
        };
        break;
      }

      case 'reload_tab': {
        const { tab_id } = args;
        await chromeController.reloadTab(tab_id);
        result = {
          success: true,
          message: `Tab ${tab_id} reloaded`,
        };
        break;
      }

      case 'go_back': {
        const { tab_id } = args;
        const response = await chromeController.goBack(tab_id);
        result = response;
        break;
      }

      case 'go_forward': {
        const { tab_id } = args;
        const response = await chromeController.goForward(tab_id);
        result = response;
        break;
      }

      case 'execute_javascript': {
        const { tab_id, code } = args;
        
        const maxCodeLength = 50000;
        if (code.length > maxCodeLength) {
          throw new Error(`JavaScript code exceeds maximum length of ${maxCodeLength} characters`);
        }

        const executionResult = await chromeController.executeInTab(tab_id, code);
        result = {
          success: true,
          result: executionResult,
        };
        break;
      }

      case 'get_page_content': {
        const { tab_id } = args;
        const content = await chromeController.getPageContent(tab_id);
        result = {
          success: true,
          content: content,
        };
        break;
      }

      case 'take_screenshot': {
        const { tab_id, format = 'png' } = args;
        const screenshotInfo = await chromeController.takeScreenshot(tab_id, format);
        result = {
          success: true,
          screenshot: {
            path: screenshotInfo.path,
            filename: screenshotInfo.filename,
            format: screenshotInfo.format,
            size_bytes: screenshotInfo.size,
            timestamp: screenshotInfo.timestamp,
            tab_id: screenshotInfo.tabId
          },
          message: `Screenshot saved as ${screenshotInfo.filename} (${Math.round(screenshotInfo.size / 1024)}KB)`,
        };
        break;
      }

      case 'search_tabs': {
        const { query } = args;
        const targets = await chromeController.getTargets();
        const searchLower = query.toLowerCase();
        
        const matchingTabs = targets
          .filter(t => t.type === 'page')
          .filter(t => 
            t.title.toLowerCase().includes(searchLower) ||
            t.url.toLowerCase().includes(searchLower)
          )
          .map(t => ({
            id: t.id,
            title: t.title,
            url: t.url,
            type: t.type,
          }));
        
        result = {
          tabs: matchingTabs,
          count: matchingTabs.length,
          query: query,
        };
        break;
      }

      case 'navigate_to': {
        const { tab_id, url } = args;
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          throw new Error('URL must start with http:// or https://');
        }

        await chromeController.navigateTab(tab_id, url);
        result = {
          success: true,
          tab_id: tab_id,
          url: url,
          message: `Navigated tab ${tab_id} to ${url}`,
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            tool: name,
            args: args,
          }, null, 2),
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Chrome Control MCP server running...');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});