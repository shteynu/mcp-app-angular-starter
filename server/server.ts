import { readFile } from 'node:fs/promises';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

// The Angular view, built and inlined into one HTML file by
// `scripts/build-view.mjs`. Resolved against this module, so it works from
// `dist/server/index.js` no matter where the process was started.
const VIEW_HTML = new URL('../view/mcp-app.html', import.meta.url);

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'Basic MCP App Server (Angular)',
    version: '1.0.0',
  });

  // Two-part registration: tool + resource, tied together by the resource URI.
  const resourceUri = 'ui://get-time/mcp-app.html';

  // Register a tool with UI metadata. When the host calls this tool, it reads
  // `_meta.ui.resourceUri` to know which resource to fetch and render as an
  // interactive UI.
  registerAppTool(
    server,
    'get-time',
    {
      title: 'Get Time',
      description: 'Returns the current server time as an ISO 8601 string.',
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri } }, // Links this tool to its UI resource
    },
    async (): Promise<CallToolResult> => {
      const time = new Date().toISOString();
      return { content: [{ type: 'text', text: time }] };
    },
  );

  // Register the resource, which returns the bundled HTML/JavaScript for the UI.
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await readFile(VIEW_HTML, 'utf-8');
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
