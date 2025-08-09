export const contentTools = [
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
    description: 'Take a screenshot of a tab (saves to file and returns path)',
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
];

export async function handleContentTool(name, args, chromeController) {
  switch (name) {
    case 'execute_javascript': {
      const { tab_id, code } = args;
      
      const maxCodeLength = 50000;
      if (code.length > maxCodeLength) {
        throw new Error(`JavaScript code exceeds maximum length of ${maxCodeLength} characters`);
      }

      const executionResult = await chromeController.executeInTab(tab_id, code);
      return {
        success: true,
        result: executionResult,
      };
    }

    case 'get_page_content': {
      const { tab_id } = args;
      const content = await chromeController.getPageContent(tab_id);
      return {
        success: true,
        content: content,
      };
    }

    case 'take_screenshot': {
      const { tab_id, format = 'png' } = args;
      const screenshotInfo = await chromeController.takeScreenshot(tab_id, format);
      return {
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
    }

    default:
      throw new Error(`Unknown content tool: ${name}`);
  }
}