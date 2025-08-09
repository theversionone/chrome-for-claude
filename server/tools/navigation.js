export const navigationTools = [
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
];

export async function handleNavigationTool(name, args, chromeController) {
  switch (name) {
    case 'open_url': {
      const { url, new_tab = true } = args;
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('URL must start with http:// or https://');
      }

      if (new_tab) {
        const tab = await chromeController.createTab(url);
        return {
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
          return {
            success: true,
            tab_id: activeTab.id,
            url: url,
            message: `Navigated current tab to ${url}`,
          };
        } else {
          const tab = await chromeController.createTab(url);
          return {
            success: true,
            tab_id: tab.id,
            url: url,
            message: `Opened ${url} in new tab (no active tab found)`,
          };
        }
      }
    }

    case 'navigate_to': {
      const { tab_id, url } = args;
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('URL must start with http:// or https://');
      }

      await chromeController.navigateTab(tab_id, url);
      return {
        success: true,
        tab_id: tab_id,
        url: url,
        message: `Navigated tab ${tab_id} to ${url}`,
      };
    }

    case 'go_back': {
      const { tab_id } = args;
      const response = await chromeController.goBack(tab_id);
      return response;
    }

    case 'go_forward': {
      const { tab_id } = args;
      const response = await chromeController.goForward(tab_id);
      return response;
    }

    default:
      throw new Error(`Unknown navigation tool: ${name}`);
  }
}