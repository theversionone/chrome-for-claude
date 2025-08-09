import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ChromeController } from './chrome-controller.js';
import { allTools, handleToolCall } from './tools/index.js';
import { getConfig, validateConfig } from './utils/config.js';
import { sanitizeForLog } from './utils/helpers.js';

/**
 * Chrome Control Extension for Claude Desktop
 * 
 * A comprehensive browser automation extension that provides:
 * - Tab management and navigation
 * - Content extraction and screenshots  
 * - JavaScript execution
 * - Element interaction (clicking, typing, text extraction)
 * 
 * Uses Chrome DevTools Protocol for reliable browser control.
 */

class ChromeControlServer {
  constructor() {
    this.config = null;
    this.chromeController = null;
    this.server = null;
  }

  async initialize() {
    try {
      // Load and validate configuration
      this.config = getConfig();
      validateConfig(this.config);
      
      // Initialize Chrome controller
      this.chromeController = new ChromeController(this.config);
      
      // Create MCP server
      this.server = new Server(
        {
          name: 'chrome-control',
          version: '3.0.0', // Smart Element Discovery with intelligent selector matching
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );

      this.setupRequestHandlers();
      console.error('Chrome Control server initialized with configuration:', {
        port: this.config.chrome_port,
        autoLaunch: this.config.auto_launch,
        headless: this.config.headless,
        isolatedProfile: this.config.isolated_profile,
        toolsCount: allTools.length
      });
      
    } catch (error) {
      console.error('Failed to initialize Chrome Control server:', error);
      throw error;
    }
  }

  setupRequestHandlers() {
    // Handle tool listing requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error(`Listing ${allTools.length} available tools`);
      return {
        tools: allTools,
      };
    });

    // Handle tool execution requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      console.error(`Executing tool: ${name} with args:`, sanitizeForLog(JSON.stringify(args)));
      
      try {
        // Use centralized tool handler
        const result = await handleToolCall(name, args, this.chromeController);
        
        // Log successful execution
        console.error(`Tool ${name} executed successfully`);
        
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
        
        // Return standardized error response
        const errorResult = {
          success: false,
          error: error.message,
          tool: name,
          args: args,
          timestamp: new Date().toISOString(),
        };
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(errorResult, null, 2),
            },
          ],
        };
      }
    });
  }

  async connect() {
    if (!this.server) {
      throw new Error('Server not initialized. Call initialize() first.');
    }
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Chrome Control MCP server connected and running...');
  }

  async shutdown() {
    try {
      if (this.chromeController) {
        await this.chromeController.disconnect();
      }
      console.error('Chrome Control server shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

// Main execution
async function main() {
  const server = new ChromeControlServer();
  
  try {
    await server.initialize();
    await server.connect();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.error('Received SIGINT, shutting down gracefully...');
      await server.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.error('Received SIGTERM, shutting down gracefully...');
      await server.shutdown();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  console.error('Unhandled error in main:', error);
  process.exit(1);
});