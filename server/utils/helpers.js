/**
 * Utility functions for the Chrome Control extension
 */

/**
 * Sanitize a string for safe logging
 */
export function sanitizeForLog(str, maxLength = 100) {
  if (typeof str !== 'string') return String(str);
  
  // Remove potential sensitive information
  const sanitized = str
    .replace(/password[=:]\s*[^\s&]+/gi, 'password=***')
    .replace(/token[=:]\s*[^\s&]+/gi, 'token=***')
    .replace(/key[=:]\s*[^\s&]+/gi, 'key=***');
    
  return sanitized.length > maxLength 
    ? sanitized.substring(0, maxLength) + '...'
    : sanitized;
}

/**
 * Create a delay/sleep function
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delayMs = baseDelay * Math.pow(2, attempt);
      console.error(`Attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, error.message);
      await delay(delayMs);
    }
  }
  
  throw lastError;
}

/**
 * Validate URL format
 */
export function validateUrl(url) {
  if (typeof url !== 'string') {
    throw new Error('URL must be a string');
  }
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://');
  }
  
  try {
    new URL(url);
    return true;
  } catch (error) {
    throw new Error(`Invalid URL format: ${error.message}`);
  }
}

/**
 * Validate CSS selector
 */
export function validateSelector(selector) {
  if (!selector || typeof selector !== 'string') {
    throw new Error('Selector must be a non-empty string');
  }
  
  // Security checks
  if (selector.includes('javascript:') || selector.includes('<script') || selector.includes('eval(')) {
    throw new Error('Invalid selector: potential security risk detected');
  }
  
  if (selector.length > 1000) {
    throw new Error('Selector too long (max 1000 characters)');
  }
  
  // Basic syntax validation - try to use querySelector syntax check
  try {
    // This is a basic check - actual validation happens in the browser
    if (selector.trim() === '' || selector.includes(';;') || selector.includes('/*')) {
      throw new Error('Invalid selector syntax');
    }
  } catch (error) {
    throw new Error(`Invalid selector: ${error.message}`);
  }
  
  return true;
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Generate a unique filename with timestamp and random component
 */
export function generateUniqueFilename(prefix = 'file', extension = 'txt') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
}

/**
 * Truncate text to a specified length with ellipsis
 */
export function truncateText(text, maxLength = 200) {
  if (typeof text !== 'string') return String(text);
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * Check if a value is a valid tab ID format
 */
export function validateTabId(tabId) {
  if (!tabId || typeof tabId !== 'string') {
    throw new Error('Tab ID must be a non-empty string');
  }
  
  // Chrome tab IDs are typically alphanumeric with hyphens
  if (!/^[a-zA-Z0-9\-_]+$/.test(tabId)) {
    throw new Error('Invalid tab ID format');
  }
  
  return true;
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(error, toolName, args = {}) {
  return {
    success: false,
    error: error.message || 'Unknown error occurred',
    tool: toolName,
    args: args,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse(data, message = '') {
  return {
    success: true,
    ...data,
    message,
    timestamp: new Date().toISOString(),
  };
}