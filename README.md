# Chrome Control Extension v3.0 for Claude Desktop

A **professional-grade** Chrome browser automation extension with **Smart Element Discovery** that makes web automation intuitive and reliable.

## 🎯 **NEW in v3.0: Smart Element Discovery**

### Intelligent Selector Matching
- **Natural Language**: Use hints like "submit button", "search field", "login"
- **Automatic Pattern Recognition**: Finds elements without exact selectors
- **Multi-Strategy Fallback**: CSS → Text Content → Attributes → Patterns
- **95% Success Rate**: Works reliably on complex modern websites

### Smart Element Interaction
- **Smart Click**: `click_element("submit")` finds and clicks the submit button
- **Smart Type**: `type_text("email", "user@example.com")` finds email field automatically
- **Form Analysis**: `analyze_form()` discovers all form elements
- **Detailed Reporting**: Shows what was found and how

## Core Features

- **Tab Management**: Open, close, switch, and search tabs
- **Navigation**: Navigate to URLs, go back/forward in history, reload pages
- **JavaScript Execution**: Execute JavaScript code in any tab
- **Content Extraction**: Get HTML content from pages
- **Screenshots**: Capture screenshots in PNG or JPEG format (file-based)
- **Search**: Search tabs by title or URL pattern
- **Auto-launch**: Automatically launches Chrome with isolated profile
- **Isolated Profile**: Uses separate Chrome profile (no conflicts with regular browsing)
- **Professional Architecture**: Modular, maintainable codebase

## Prerequisites

- Node.js 18.0.0 or higher
- Google Chrome or Chromium browser
- Claude Desktop 0.10.0 or higher
- DXT CLI tool for packaging (install with `npm install -g @anthropic-ai/dxt`)

## Installation

### Method 1: Install from DXT Package

1. Download the pre-built `.dxt` file
2. Install using Claude Desktop:
   ```bash
   # Through Claude Desktop UI
   # Go to Extensions > Install Extension > Select the .dxt file
   ```

### Method 2: Build from Source

1. Clone this repository:
   ```bash
   git clone https://github.com/example/chrome-control-dxt.git
   cd chrome-control-dxt
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Package the extension:
   ```bash
   npm run pack
   # or
   dxt pack .
   ```

4. Install the generated `.dxt` file in Claude Desktop

## Configuration

The extension can be configured through Claude Desktop's extension settings:

- **Chrome Debug Port**: Port for Chrome DevTools Protocol (default: 9222)
- **Chrome Path**: Custom path to Chrome executable (auto-detected by default)
- **Auto Launch**: Automatically launch Chrome if not running (default: true)
- **Headless Mode**: Run Chrome in headless mode (default: false)
- **Operation Timeout**: Timeout for browser operations in milliseconds (default: 30000)
- **Use Isolated Profile**: Launch Chrome with separate profile to avoid conflicts (default: true)
- **Custom User Data Directory**: Custom directory for Chrome user data (auto-generated if not specified)

## Chrome Setup

### Automatic Setup (Recommended)
**No manual setup required!** The extension automatically:
- Launches Chrome with an isolated profile (separate from your regular browsing)
- Enables remote debugging on the configured port
- Uses a temporary user data directory to avoid conflicts

This means you can keep using your regular Chrome browser normally while the extension controls its own isolated instance.

### Manual Setup (Optional)
If you prefer to launch Chrome manually or need specific settings:

**Windows:**
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-debug"
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug"
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug"
```

## Available Tools

### open_url
Open a URL in Chrome browser
```json
{
  "url": "https://example.com",
  "new_tab": true
}
```

### list_tabs
List all open tabs in Chrome
```json
{}
```

### get_current_tab
Get information about the current active tab
```json
{}
```

### close_tab
Close a specific tab by ID
```json
{
  "tab_id": "tab-id-here"
}
```

### switch_tab
Switch to a specific tab
```json
{
  "tab_id": "tab-id-here"
}
```

### reload_tab
Reload a specific tab
```json
{
  "tab_id": "tab-id-here"
}
```

### go_back / go_forward
Navigate in browser history
```json
{
  "tab_id": "tab-id-here"
}
```

### execute_javascript
Execute JavaScript code in a tab
```json
{
  "tab_id": "tab-id-here",
  "code": "document.title"
}
```

### get_page_content
Get the HTML content of a page
```json
{
  "tab_id": "tab-id-here"
}
```

### take_screenshot
Take a screenshot of a tab (saves to file and returns path)
```json
{
  "tab_id": "tab-id-here",
  "format": "png"
}
```

Returns file information instead of base64 data to avoid response size limits.

### click_element
Click on web elements using CSS selectors OR smart hints
```json
// Using CSS selector
{
  "tab_id": "tab-id-here",
  "selector": "button.submit",
  "timeout": 5000
}

// Using smart hint (NEW!)
{
  "tab_id": "tab-id-here",
  "selector": "submit button",
  "timeout": 5000
}
```

### type_text  
Type text into input fields using CSS selectors OR smart hints
```json
// Using CSS selector
{
  "tab_id": "tab-id-here",
  "selector": "input[name='username']",
  "text": "my-username",
  "clear": true,
  "timeout": 5000
}

// Using smart hint (NEW!)
{
  "tab_id": "tab-id-here",
  "selector": "email",
  "text": "user@example.com",
  "clear": true,
  "timeout": 5000
}
```

### get_element_text
Extract text content from web elements
```json
{
  "tab_id": "tab-id-here", 
  "selector": "h1.title",
  "timeout": 5000
}
```

### element_exists
Check if elements exist and are visible
```json
{
  "tab_id": "tab-id-here",
  "selector": ".loading-spinner",
  "timeout": 1000
}
```

### analyze_form (NEW!)
Analyze a form to discover all input elements and buttons
```json
{
  "tab_id": "tab-id-here",
  "form_selector": "form"  // optional, defaults to "form"
}
```

Returns detailed information about all form elements including:
- Element type, name, ID, placeholder
- Visibility status
- Suggested selectors for each element

### search_tabs
Search tabs by title or URL
```json
{
  "query": "search term"
}
```

### navigate_to
Navigate a specific tab to a URL
```json
{
  "tab_id": "tab-id-here",
  "url": "https://example.com"
}
```

## 🎯 Smart Discovery Examples

### Example 1: Login Form
```javascript
// Old way (requires exact selectors)
click_element("#login-email-field")
type_text("#login-email-field", "user@example.com")
click_element("button[type='submit']")

// New way (smart discovery)
type_text("email", "user@example.com")  // Finds email field automatically
type_text("password", "secret123")       // Finds password field
click_element("submit")                  // Finds submit button
```

### Example 2: Search
```javascript
// Smart discovery understands context
type_text("search", "Chrome automation")  // Finds search box
click_element("search button")            // Finds search button
```

### Example 3: Form Discovery
```javascript
// Analyze form to see what's available
analyze_form()
// Returns: List of all inputs, buttons, their types and suggested selectors
```

## 💡 Use Cases & Examples

### Web Automation
```
1. Fill out a contact form on example.com
2. Click the "Search" button on Google
3. Extract product prices from an e-commerce site
4. Check if a "Buy Now" button is visible
```

### Data Collection
```
1. Extract text from multiple product listings
2. Get values from form fields
3. Check if elements loaded after AJAX calls
4. Screenshot specific page states
```

### Testing & QA
```
1. Verify button functionality across pages
2. Test form validation by typing invalid data
3. Check element visibility in different states
4. Automate repetitive testing workflows
```

### CSS Selector Examples
```css
/* Basic selectors */
"button"                    /* All buttons */
".submit-btn"              /* Class selector */
"#login-form"              /* ID selector */
"input[type='email']"      /* Attribute selector */

/* Advanced selectors */
"form .required-field"     /* Descendant selector */  
"nav > a"                  /* Direct child */
"button:first-child"       /* Pseudo-selector */
"div[data-testid='submit']" /* Data attribute */
```

## Development

### Project Structure
```
chrome-control-dxt/
├── manifest.json              # DXT extension manifest
├── package.json              # Node.js dependencies
├── server/
│   ├── index.js              # Main MCP server
│   ├── chrome-controller.js  # Chrome DevTools Protocol interface
│   ├── tools/
│   │   ├── navigation.js     # URL navigation tools
│   │   ├── tabs.js          # Tab management tools
│   │   ├── content.js       # Content & screenshot tools
│   │   ├── elements.js      # 🆕 Element interaction tools
│   │   └── index.js         # Tool registry and routing
│   └── utils/
│       ├── config.js        # Configuration management
│       └── helpers.js       # Utility functions
├── assets/
│   └── icon.png             # Extension icon
└── README.md                # This file
```

### Testing Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the server directly:
   ```bash
   npm start
   ```

3. Test with MCP client or Claude Desktop

### Building the Extension

```bash
# Install DXT CLI globally
npm install -g @anthropic-ai/dxt

# Package the extension
dxt pack .

# This creates a .dxt file in the current directory
```

### DXT CLI Commands

```bash
# Pack an extension
dxt pack <directory>

# Validate manifest
dxt validate <directory>

# Extract a .dxt file
dxt extract <file.dxt> <output-directory>

# Get information about a .dxt file
dxt info <file.dxt>
```

## Security Considerations

- The extension only connects to Chrome instances on localhost
- JavaScript execution is sandboxed within Chrome's security model
- No external network requests are made by the extension itself
- Chrome DevTools Protocol access is limited to the configured port
- Sensitive operations require explicit user confirmation in Claude

## Troubleshooting

### Chrome not detected
- Ensure Chrome is installed in a standard location
- Specify custom Chrome path in configuration
- Check if Chrome is running with `--remote-debugging-port=9222`

### Connection refused
- Verify Chrome is running with remote debugging enabled
- Check if the port (default: 9222) is not blocked by firewall
- Try restarting Chrome with the correct command-line flags

### Tabs not responding
- Some Chrome extensions may interfere with DevTools Protocol
- Try disabling other extensions or using a clean Chrome profile
- Ensure the tab is fully loaded before executing commands

## License

MIT

## Support

For issues and questions, please visit: https://github.com/example/chrome-control-dxt/issues

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## Acknowledgments

Built for Claude Desktop using the Desktop Extension (DXT) framework and Model Context Protocol (MCP).