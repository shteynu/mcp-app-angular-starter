// Smoke test for the built server (`npm run build` first): starts it over
// stdio, calls the tool, reads its UI resource and checks that the page is a
// single self-contained HTML document a host can render.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';

const client = new Client({ name: 'check', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['dist/server/index.js', '--stdio'],
  }),
);

try {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'get-time');
  assert.ok(tool, 'get-time is listed');
  const uri = tool._meta?.ui?.resourceUri;
  assert.equal(uri, 'ui://get-time/mcp-app.html', 'get-time links its UI resource');

  const result = await client.callTool({ name: 'get-time', arguments: {} });
  const text = result.content.find((c) => c.type === 'text')?.text;
  assert.ok(!Number.isNaN(Date.parse(text)), `get-time returns a date, got ${text}`);

  const { contents } = await client.readResource({ uri });
  assert.equal(contents[0].mimeType, RESOURCE_MIME_TYPE);
  const html = contents[0].text;
  assert.match(html, /<app-root>/, 'page has the Angular root element');
  assert.match(html, /<script type="module">/, 'page inlines its module script');
  // Only the markup counts: the inlined code may contain such tags in strings.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  assert.doesNotMatch(
    markup,
    /<(?:script|link)\b[^>]*\b(?:src|href)="(?![a-z]+:)[^"]*"/i,
    'page loads no local files',
  );

  console.log(`check: ok (${tools.length} tool(s), ${(html.length / 1024).toFixed(1)} kB page)`);
} finally {
  await client.close();
}
