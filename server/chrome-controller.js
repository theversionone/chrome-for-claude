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
      
      // Input domain doesn't have an 'enable' method - removed per debugging guide
      
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
      const elementInfo = await this.waitForElement(client, selector, options.timeout);
      
      const x = elementInfo.bounds.left + elementInfo.bounds.width / 2;
      const y = elementInfo.bounds.top + elementInfo.bounds.height / 2;
      
      // Scroll element into view if needed
      await client.Runtime.evaluate({
        expression: `document.querySelector('${selector.replace(/'/g, "\\'")}').scrollIntoView({ behavior: 'instant', block: 'center' })`
      });
      
      // Small delay for scroll to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Try Input API first, fallback to JavaScript simulation
      try {
        if (client.Input && client.Input.dispatchMouseEvent) {
          // Use Chrome DevTools Input API
          await client.Input.dispatchMouseEvent({
            type: 'mousePressed',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1
          });
          
          await client.Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1
          });
        } else {
          throw new Error('Input API not available, using fallback');
        }
      } catch (error) {
        // Fallback: Use JavaScript to simulate click
        await client.Runtime.evaluate({
          expression: `
            const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (element) {
              element.scrollIntoView({ behavior: 'instant', block: 'center' });
              element.click();
            }
          `
        });
      }
      
      return {
        success: true,
        selector,
        coordinates: { x: Math.round(x), y: Math.round(y) }
      };
    });
  }

  async typeText(tabId, selector, text, options = {}) {
    await this.validateSelector(selector);
    
    if (typeof text !== 'string') {
      throw new Error('Text must be a string');
    }
    
    return this.withTab(tabId, async (client) => {
      const elementInfo = await this.waitForElement(client, selector, options.timeout);
      
      // Try Input API first, fallback to JavaScript simulation  
      console.log(`Attempting to type "${text}" into ${selector}`);
      try {
        if (client.Input && client.Input.dispatchMouseEvent && client.Input.insertText) {
          // Focus the element first by clicking it
          const x = elementInfo.bounds.left + elementInfo.bounds.width / 2;
          const y = elementInfo.bounds.top + elementInfo.bounds.height / 2;
          
          await client.Input.dispatchMouseEvent({
            type: 'mousePressed',
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            clickCount: 1
          });
          
          await client.Input.dispatchMouseEvent({
            type: 'mouseReleased',
            x: Math.round(x),
            y: Math.round(y),
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
        } else {
          throw new Error('Input API not available, using fallback');
        }
      } catch (error) {
        // Fallback: Use JavaScript to simulate typing
        console.log(`Input API failed, using JavaScript fallback: ${error.message}`);
        await client.Runtime.evaluate({
          expression: `
            const element = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (element) {
              console.log('Found element for typing:', element.tagName, element.className);
              element.focus();
              element.scrollIntoView({ behavior: 'instant', block: 'center' });
              ${options.clear !== false ? 'element.value = "";' : ''}
              element.value = '${text.replace(/'/g, "\\'")}';
              
              // Trigger comprehensive events for modern web apps
              element.dispatchEvent(new Event('focus', { bubbles: true }));
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
              
              console.log('Text typed successfully:', element.value);
            } else {
              console.error('Element not found during typing fallback');
            }
          `
        });
      }
      
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
        text: text.length > 100 ? text.substring(0, 100) + '...' : text
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