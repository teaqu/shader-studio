# Shader View Archi### MessageHandler
- Processes incoming messages from clients (log, debug, error, toggleLock)
- Handles diagnostic collection and error reporting
- **Now shared between panel and web server implementations** (eliminates duplication)

### ShaderProcessore Refactor

## Overview

The extension has been refactored with a clean controller pattern, using a MessageSender for communication and allowing the same shader processing logic to work with both VS Code webview panels and web servers.

## Key Components

### ShaderViewController
- Main controller that orchestrates the entire extension
- Manages commands, event handlers, and component coordination
- Handles the extension lifecycle and initialization
- Provides a clean interface for both panel and web server functionality

### MessageSender
- Handles communication with either a VS Code webview panel or WebSocket server
- Provides a unified interface for sending messages
- Handles URI conversion (webview URIs for panels, regular paths for web servers)

### MessageHandlerService
- Processes incoming messages from clients (log, debug, error, toggleLock)
- Handles diagnostic collection and error reporting
- Shared between panel and web server implementations

### ShaderProcessor
- Processes shader files and configuration
- Now uses MessageSender instead of directly accessing webview panel
- Works with both panel and web server clients

### PanelManager
- Manages VS Code webview panels
- Uses MessageSender for communication
- Handles webview HTML setup

### WebServerManager
- Manages WebSocket server for external web clients
- Uses the same MessageSender for communication
- Allows shader viewing from external applications

### ShaderManager
- Unified interface for both panel and web server functionality
- Can send shaders to panel, web server, or both simultaneously

## Usage Examples

### Simple Extension Usage (current)
```typescript
// The controller handles everything automatically
const controller = new ShaderViewController(context, outputChannel, diagnosticCollection);
```

### Advanced Usage with Web Server
```typescript
const controller = new ShaderViewController(context, outputChannel, diagnosticCollection, 8080);

// Start web server
controller.startWebServer();

// Send to both panel and web server
controller.sendShaderToBoth(editor);
```

## Benefits

1. **Clean Controller Pattern**: ShaderViewController manages the entire extension lifecycle
2. **Simplified Extension Entry Point**: extension.ts is now minimal and focused
3. **Shared Message Handling**: Single MessageHandler instance eliminates code duplication
4. **Decoupled Communication**: MessageSender abstracts the communication layer
5. **Reusable Logic**: ShaderProcessor works with both panels and web servers
6. **Extensible**: Easy to add new communication mechanisms (HTTP, TCP, etc.)
7. **Unified Interface**: Same shader processing logic for different client types
8. **Better Organization**: Related functionality is grouped logically
9. **Better Testing**: Components can be tested independently
10. **Reduced Memory Usage**: Shared components instead of duplicated instances

## Web Server Integration

To connect a web client to the WebSocket server:

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.onmessage = function(event) {
    const message = JSON.parse(event.data);
    if (message.type === 'shaderSource') {
        // Handle shader update
        console.log('Received shader:', message.code);
    }
};

// Send log message back to VS Code
ws.send(JSON.stringify({
    type: 'log',
    payload: ['Shader compiled successfully']
}));
```

This refactor makes it possible to view and interact with shaders from external web applications while maintaining the existing VS Code panel functionality.
