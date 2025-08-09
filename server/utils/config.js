import os from 'os';
import path from 'path';

/**
 * Get configuration from environment variables with defaults
 */
export function getConfig() {
  return {
    chrome_port: process.env.CHROME_PORT ? parseInt(process.env.CHROME_PORT) : 9222,
    chrome_path: process.env.CHROME_PATH || null,
    auto_launch: process.env.AUTO_LAUNCH !== 'false',
    headless: process.env.HEADLESS === 'true',
    timeout: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT) : 30000,
    isolated_profile: process.env.ISOLATED_PROFILE !== 'false',
    user_data_dir: process.env.USER_DATA_DIR || null,
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(config) {
  const errors = [];
  
  if (config.chrome_port < 1024 || config.chrome_port > 65535) {
    errors.push('chrome_port must be between 1024 and 65535');
  }
  
  if (config.timeout < 1000 || config.timeout > 300000) {
    errors.push('timeout must be between 1000ms and 300000ms (5 minutes)');
  }
  
  if (config.chrome_path && typeof config.chrome_path !== 'string') {
    errors.push('chrome_path must be a string');
  }
  
  if (config.user_data_dir && typeof config.user_data_dir !== 'string') {
    errors.push('user_data_dir must be a string');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
  }
  
  return true;
}

/**
 * Get default paths for different operating systems
 */
export function getDefaultPaths() {
  const platform = process.platform;
  
  return {
    tempDir: os.tmpdir(),
    chromeUserDataDir: path.join(os.tmpdir(), `chrome-debug-${Date.now()}`),
    screenshotDir: path.join(os.tmpdir(), 'chrome-control-screenshots'),
    chromePaths: {
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
    }[platform] || [],
  };
}

/**
 * Merge user config with defaults
 */
export function mergeConfig(userConfig = {}) {
  const defaultConfig = getConfig();
  const merged = { ...defaultConfig, ...userConfig };
  validateConfig(merged);
  return merged;
}