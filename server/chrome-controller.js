import CDP from 'chrome-remote-interface';
import { spawn } from 'child_process';
import psList from 'ps-list';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';

export class ChromeController {
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
      
      // Enable DOM domain for getContentQuads
      try {
        if (client.DOM && client.DOM.enable) {
          await client.DOM.enable();
        }
      } catch (error) {
        console.error('Warning: Could not enable DOM domain:', error.message);
      }
      
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

  // Get coordinates using CDP DOM.getContentQuads (preferred) or fallback methods
  async getElementCoordinates(client, selector, options = {}) {
    try {
      // Method 1: Try CDP DOM.getContentQuads (most reliable)
      const document = await client.DOM.getDocument();
      const node = await client.DOM.querySelector({
        nodeId: document.root.nodeId,
        selector: selector
      });
      
      if (node.nodeId) {
        // Scroll into view if needed
        try {
          await client.DOM.scrollIntoViewIfNeeded({ nodeId: node.nodeId });
        } catch (e) {
          // scrollIntoViewIfNeeded might not be available, continue
        }
        
        const quads = await client.DOM.getContentQuads({ nodeId: node.nodeId });
        
        if (quads.quads && quads.quads.length > 0) {
          // Use first visible quad and get center point
          const quad = quads.quads[0]; // [x1, y1, x2, y2, x3, y3, x4, y4]
          const x = Math.round((quad[0] + quad[4]) / 2); // average of x coords
          const y = Math.round((quad[1] + quad[5]) / 2); // average of y coords
          
          return {
            success: true,
            coordinates: { x, y },
            method: 'DOM.getContentQuads'
          };
        }
      }
    } catch (error) {
      // Fall through to fallback methods
    }
    
    try {
      // Method 2: Try DOM.getBoxModel as backup
      const document = await client.DOM.getDocument();
      const node = await client.DOM.querySelector({
        nodeId: document.root.nodeId,
        selector: selector
      });
      
      if (node.nodeId) {
        const boxModel = await client.DOM.getBoxModel({ nodeId: node.nodeId });
        
        if (boxModel.model && boxModel.model.content) {
          const content = boxModel.model.content; // [x1, y1, x2, y2, x3, y3, x4, y4]
          const x = Math.round((content[0] + content[4]) / 2);
          const y = Math.round((content[1] + content[5]) / 2);
          
          return {
            success: true,
            coordinates: { x, y },
            method: 'DOM.getBoxModel'
          };
        }
      }
    } catch (error) {
      // Fall through to JavaScript fallback
    }
    
    try {
      // Method 3: JavaScript fallback with proper serialization
      const result = await client.Runtime.evaluate({
        expression: `
          (() => {
            const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (!element) return null;
            
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y, 
              width: rect.width,
              height: rect.height,
              left: rect.left,
              top: rect.top
            };
          })()
        `,
        returnByValue: true
      });
      
      const bounds = result.result.value;
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const x = Math.round(bounds.left + bounds.width / 2);
        const y = Math.round(bounds.top + bounds.height / 2);
        
        return {
          success: true,
          coordinates: { x, y },
          method: 'JavaScript_getBoundingClientRect'
        };
      }
    } catch (error) {
      // All methods failed
    }
    
    return {
      success: false,
      coordinates: null,
      method: 'all_methods_failed'
    };
  }

  // NEW: Element interaction methods with MutationObserver support
  async waitForElement(client, selector, timeout = 5000) {
    try {
      const result = await client.Runtime.evaluate({
        expression: `
          new Promise((resolve, reject) => {
            const findElement = () => {
              const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
              if (!element) {
                return null;
              }
              
              // Modern visibility detection - offsetParent is unreliable
              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              
              const isVisible = (
                rect.width > 0 && 
                rect.height > 0 && 
                style.display !== 'none' && 
                style.visibility !== 'hidden' && 
                style.opacity !== '0'
              );
              
              return {
                exists: true,
                visible: isVisible,
                bounds: rect,
                styles: {
                  display: style.display,
                  visibility: style.visibility,
                  opacity: style.opacity
                }
              };
            };
            
            // Check immediately
            const element = findElement();
            if (element && element.visible) {
              return resolve(element);
            }
            
            // Use MutationObserver for dynamic content
            const observer = new MutationObserver((mutations, obs) => {
              const element = findElement();
              if (element && element.visible) {
                obs.disconnect();
                resolve(element);
              }
            });
            
            // Watch for DOM changes
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style', 'class']
            });
            
            // Timeout fallback
            setTimeout(() => {
              observer.disconnect();
              const element = findElement();
              if (element && element.exists) {
                // Element exists but may not be visible
                resolve(element);
              } else {
                reject(new Error(\`Element '\${selector}' not found within \${timeout}ms\`));
              }
            }, ${timeout});
          });
        `,
        returnByValue: true,
        awaitPromise: true
      });

      const elementInfo = result.result.value;
      if (elementInfo && elementInfo.exists) {
        return elementInfo;
      }
      
      throw new Error(`Element '${selector}' not found`);
      
    } catch (error) {
      console.error('waitForElement evaluation error:', error);
      throw new Error(`Element '${selector}' not found or not visible within ${timeout}ms`);
    }
  }

  async validateSelector(selector) {
    // Basic validation to prevent CSS injection
    if (!selector || typeof selector !== 'string') {
      throw new Error('Invalid selector: must be a non-empty string');
    }
    
    if (selector.includes('javascript:') || selector.includes('<script')) {
      throw new Error('Invalid selector: potential security risk detected');
    }
    
    // Test if it's a valid CSS selector
    try {
      await this.executeInTab(null, `document.querySelector('${selector.replace(/'/g, "\\'")}')`, false);
    } catch (error) {
      // We can't test without a tab, so we'll do basic string validation
      if (selector.length > 1000) {
        throw new Error('Invalid selector: too long');
      }
    }
    
    return true;
  }

  async clickElement(tabId, selector, options = {}) {
    await this.validateSelector(selector);
    
    return this.withTab(tabId, async (client) => {
      // Wait for element to be present and visible
      await this.waitForElement(client, selector, options.timeout);
      
      // Get coordinates using CDP DOM methods
      const coordResult = await this.getElementCoordinates(client, selector, options);
      
      // Try CDP Input API if we have valid coordinates
      if (coordResult.success && coordResult.coordinates && client.Input && client.Input.dispatchMouseEvent) {
        try {
          const { x, y } = coordResult.coordinates;
          
          // Use Chrome DevTools Input API - produces trusted events
          await client.Input.dispatchMouseEvent({
            type: 'mousePressed',
            x: x,
            y: y,
            button: 'left',
            clickCount: 1
          });
          
          await client.Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x: x,
            y: y,
            button: 'left',
            clickCount: 1
          });
          
          return {
            success: true,
            selector,
            coordinates: coordResult.coordinates,
            method: `CDP_Input_API_via_${coordResult.method}`
          };
          
        } catch (error) {
          // Fall through to JavaScript fallback
        }
      }
      
      // Enhanced JavaScript fallback with proper event sequence
      await client.Runtime.evaluate({
        expression: `
          const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (element) {
            element.scrollIntoView({ behavior: 'instant', block: 'center' });
            
            // Fire proper event sequence for better compatibility
            element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
          }
        `
      });
      
      return {
        success: true,
        selector,
        coordinates: coordResult.coordinates || { x: null, y: null },
        method: `JavaScript_fallback_from_${coordResult.method}`
      };
    });
  }

  async typeText(tabId, selector, text, options = {}) {
    await this.validateSelector(selector);
    
    if (typeof text !== 'string') {
      throw new Error('Text must be a string');
    }
    
    return this.withTab(tabId, async (client) => {
      // Wait for element to be present and visible
      await this.waitForElement(client, selector, options.timeout);
      
      // Get coordinates using CDP DOM methods
      const coordResult = await this.getElementCoordinates(client, selector, options);
      
      // Try Input API first if coordinates are valid, fallback to JavaScript simulation
      if (coordResult.success && coordResult.coordinates && client.Input && client.Input.dispatchMouseEvent && client.Input.insertText) {
        try {
          const { x, y } = coordResult.coordinates;
          
          // Focus the element first by clicking it
          await client.Input.dispatchMouseEvent({
            type: 'mousePressed',
            x: x,
            y: y,
            button: 'left',
            clickCount: 1
          });
          
          await client.Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x: x,
            y: y,
            button: 'left',
            clickCount: 1
          });
          
          // Clear existing content if specified
          if (options.clear !== false) {
            await client.Runtime.evaluate({
              expression: `
                const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
                if (element) {
                  element.value = '';
                  element.dispatchEvent(new Event('input', { bubbles: true }));
                }
              `
            });
          }
          
          // Type the text using Input API
          await client.Input.insertText({ text });
          
          return {
            success: true,
            selector,
            text: text.length > 100 ? text.substring(0, 100) + '...' : text,
            coordinates: coordResult.coordinates,
            method: `CDP_Input_API_via_${coordResult.method}`
          };
          
        } catch (error) {
          // Fall through to JavaScript fallback
        }
      }
      
      // Fallback: Use JavaScript to simulate typing
      await client.Runtime.evaluate({
        expression: `
          const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (element) {
            element.focus();
            element.scrollIntoView({ behavior: 'instant', block: 'center' });
            ${options.clear !== false ? 'element.value = "";' : ''}
            element.value = '${text.replace(/'/g, "\\'")}';
            
            // Trigger comprehensive events for modern web apps
            element.dispatchEvent(new Event('focus', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          }
        `
      });
      
      // Trigger change event
      await client.Runtime.evaluate({
        expression: `
          const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (element) {
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
          }
        `
      });
      
      return {
        success: true,
        selector,
        text: text.length > 100 ? text.substring(0, 100) + '...' : text,
        coordinates: coordResult.coordinates || { x: null, y: null },
        method: `JavaScript_fallback_from_${coordResult.method || 'unknown'}`
      };
    });
  }

  async getElementText(tabId, selector, options = {}) {
    await this.validateSelector(selector);
    
    return this.withTab(tabId, async (client) => {
      await this.waitForElement(client, selector, options.timeout);
      
      const result = await client.Runtime.evaluate({
        expression: `
          const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
          element ? {
            text: element.textContent?.trim() || '',
            innerText: element.innerText?.trim() || '',
            value: element.value || '',
            tagName: element.tagName.toLowerCase(),
            attributes: Object.fromEntries([...element.attributes].map(attr => [attr.name, attr.value]))
          } : null
        `,
        returnByValue: true
      });
      
      if (!result.result.value) {
        throw new Error(`Element '${selector}' not found`);
      }
      
      return {
        success: true,
        selector,
        element: result.result.value
      };
    });
  }

  async elementExists(tabId, selector, options = {}) {
    await this.validateSelector(selector);
    
    return this.withTab(tabId, async (client) => {
      try {
        const elementInfo = await this.waitForElement(client, selector, options.timeout || 1000);
        return {
          success: true,
          exists: true,
          visible: elementInfo.visible,
          selector
        };
      } catch (error) {
        // Check if element exists but is not visible
        const result = await client.Runtime.evaluate({
          expression: `
            const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (!element) {
              return { exists: false };
            }
            
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            
            const isVisible = (
              rect.width > 0 && 
              rect.height > 0 && 
              style.display !== 'none' && 
              style.visibility !== 'hidden' && 
              style.opacity !== '0'
            );
            
            return {
              exists: true,
              visible: isVisible,
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity
            };
          `,
          returnByValue: true
        });
        
        const elementInfo = result.result.value;
        if (!elementInfo) {
          return {
            success: false,
            error: 'Failed to evaluate element existence',
            selector
          };
        }
        
        return {
          success: true,
          exists: elementInfo.exists,
          visible: elementInfo.visible || false,
          selector,
          styles: elementInfo.exists ? {
            display: elementInfo.display,
            visibility: elementInfo.visibility,
            opacity: elementInfo.opacity
          } : null
        };
      }
    });
  }
}