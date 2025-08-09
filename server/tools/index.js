import { navigationTools, handleNavigationTool } from './navigation.js';
import { tabTools, handleTabTool } from './tabs.js';
import { contentTools, handleContentTool } from './content.js';
import { elementTools, handleElementTool } from './elements.js';

// Combine all tools
export const allTools = [
  ...navigationTools,
  ...tabTools,
  ...contentTools,
  ...elementTools,
];

// Route tool calls to appropriate handlers
export async function handleToolCall(name, args, chromeController) {
  try {
    // Navigation tools
    if (navigationTools.some(tool => tool.name === name)) {
      return await handleNavigationTool(name, args, chromeController);
    }
    
    // Tab management tools  
    if (tabTools.some(tool => tool.name === name)) {
      return await handleTabTool(name, args, chromeController);
    }
    
    // Content tools
    if (contentTools.some(tool => tool.name === name)) {
      return await handleContentTool(name, args, chromeController);
    }
    
    // Element interaction tools
    if (elementTools.some(tool => tool.name === name)) {
      return await handleElementTool(name, args, chromeController);
    }
    
    throw new Error(`Unknown tool: ${name}`);
    
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    
    // Return standardized error response
    return {
      success: false,
      error: error.message,
      tool: name,
      args: args,
      timestamp: new Date().toISOString(),
    };
  }
}

// Export individual tool categories for easier testing/debugging
export {
  navigationTools,
  tabTools, 
  contentTools,
  elementTools,
  handleNavigationTool,
  handleTabTool,
  handleContentTool,
  handleElementTool,
};