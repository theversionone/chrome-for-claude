export const tabTools = [
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
];

export async function handleTabTool(name, args, chromeController) {
  switch (name) {
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
      
      return {
        tabs: tabs,
        count: tabs.length,
      };
    }

    case 'get_current_tab': {
      const targets = await chromeController.getTargets();
      const activeTab = targets.find(t => t.type === 'page');
      
      if (activeTab) {
        return {
          id: activeTab.id,
          title: activeTab.title,
          url: activeTab.url,
          type: activeTab.type,
        };
      } else {
        return {
          error: 'No active tab found',
        };
      }
    }

    case 'close_tab': {
      const { tab_id } = args;
      await chromeController.closeTab(tab_id);
      return {
        success: true,
        message: `Tab ${tab_id} closed`,
      };
    }

    case 'switch_tab': {
      const { tab_id } = args;
      await chromeController.activateTab(tab_id);
      return {
        success: true,
        message: `Switched to tab ${tab_id}`,
      };
    }

    case 'reload_tab': {
      const { tab_id } = args;
      await chromeController.reloadTab(tab_id);
      return {
        success: true,
        message: `Tab ${tab_id} reloaded`,
      };
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
      
      return {
        tabs: matchingTabs,
        count: matchingTabs.length,
        query: query,
      };
    }

    default:
      throw new Error(`Unknown tab tool: ${name}`);
  }
}