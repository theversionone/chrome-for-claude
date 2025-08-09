export const elementTools = [
  {
    name: 'click_element',
    description: 'Click on an element using CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'string',
          description: 'The ID of the tab',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element to click',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait for element in milliseconds (default: 5000)',
          default: 5000,
          minimum: 1000,
          maximum: 30000,
        },
      },
      required: ['tab_id', 'selector'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into an input field using CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'string',
          description: 'The ID of the tab',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the input element',
        },
        text: {
          type: 'string',
          description: 'Text to type into the element',
        },
        clear: {
          type: 'boolean',
          description: 'Clear existing content before typing (default: true)',
          default: true,
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait for element in milliseconds (default: 5000)',
          default: 5000,
          minimum: 1000,
          maximum: 30000,
        },
      },
      required: ['tab_id', 'selector', 'text'],
    },
  },
  {
    name: 'get_element_text',
    description: 'Get text content from an element using CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'string',
          description: 'The ID of the tab',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait for element in milliseconds (default: 5000)',
          default: 5000,
          minimum: 1000,
          maximum: 30000,
        },
      },
      required: ['tab_id', 'selector'],
    },
  },
  {
    name: 'element_exists',
    description: 'Check if an element exists and is visible using CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'string',
          description: 'The ID of the tab',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for the element',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait for element in milliseconds (default: 1000)',
          default: 1000,
          minimum: 100,
          maximum: 10000,
        },
      },
      required: ['tab_id', 'selector'],
    },
  },
];

export async function handleElementTool(name, args, chromeController) {
  switch (name) {
    case 'click_element': {
      const { tab_id, selector, timeout = 5000 } = args;
      
      try {
        const result = await chromeController.clickElement(tab_id, selector, { timeout });
        return {
          success: true,
          action: 'clicked',
          selector: result.selector,
          coordinates: result.coordinates,
          message: `Successfully clicked element '${selector}' at coordinates (${result.coordinates.x}, ${result.coordinates.y})`,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          selector,
          action: 'click',
        };
      }
    }

    case 'type_text': {
      const { tab_id, selector, text, clear = true, timeout = 5000 } = args;
      
      try {
        const result = await chromeController.typeText(tab_id, selector, text, { clear, timeout });
        return {
          success: true,
          action: 'typed',
          selector: result.selector,
          text_preview: result.text,
          clear_before_typing: clear,
          message: `Successfully typed text into element '${selector}'`,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          selector,
          action: 'type',
        };
      }
    }

    case 'get_element_text': {
      const { tab_id, selector, timeout = 5000 } = args;
      
      try {
        const result = await chromeController.getElementText(tab_id, selector, { timeout });
        return {
          success: true,
          selector: result.selector,
          element: {
            text_content: result.element.text,
            inner_text: result.element.innerText,
            value: result.element.value,
            tag_name: result.element.tagName,
            attributes: result.element.attributes,
          },
          message: `Successfully extracted text from element '${selector}'`,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          selector,
          action: 'get_text',
        };
      }
    }

    case 'element_exists': {
      const { tab_id, selector, timeout = 1000 } = args;
      
      try {
        const result = await chromeController.elementExists(tab_id, selector, { timeout });
        return {
          success: true,
          selector: result.selector,
          exists: result.exists,
          visible: result.visible,
          styles: result.styles,
          message: result.exists ? 
            `Element '${selector}' ${result.visible ? 'exists and is visible' : 'exists but is not visible'}` :
            `Element '${selector}' does not exist`,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          selector,
          action: 'check_existence',
        };
      }
    }

    default:
      throw new Error(`Unknown element tool: ${name}`);
  }
}