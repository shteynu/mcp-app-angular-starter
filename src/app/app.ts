import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CallToolResult } from '@modelcontextprotocol/client';
import {
  App as McpApp,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';

function extractTime(result: CallToolResult): string {
  const content = result.content?.find((c) => c.type === 'text');
  return content?.type === 'text' ? content.text : '[no text content]';
}

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '[style.padding-top.px]': 'hostContext()?.safeAreaInsets?.top',
    '[style.padding-right.px]': 'hostContext()?.safeAreaInsets?.right',
    '[style.padding-bottom.px]': 'hostContext()?.safeAreaInsets?.bottom',
    '[style.padding-left.px]': 'hostContext()?.safeAreaInsets?.left',
  },
})
export class App {
  private readonly app = signal<McpApp | null>(null);
  protected readonly hostContext = signal<McpUiHostContext | undefined>(undefined);
  protected readonly serverTime = signal('Loading...');
  protected readonly messageText = signal('This is message text.');
  protected readonly logText = signal('This is log text.');
  protected readonly linkUrl = signal('https://modelcontextprotocol.io/');

  constructor() {
    // Apply host styles reactively when hostContext changes
    effect(() => {
      const ctx = this.hostContext();
      if (ctx?.theme) {
        applyDocumentTheme(ctx.theme);
      }
      if (ctx?.styles?.variables) {
        applyHostStyleVariables(ctx.styles.variables);
      }
      if (ctx?.styles?.css?.fonts) {
        applyHostFonts(ctx.styles.css.fonts);
      }
    });

    const instance = new McpApp({ name: 'Get Time App', version: '1.0.0' });

    instance.ontoolinput = (params) => {
      console.info('Received tool call input:', params);
    };

    instance.ontoolresult = (result) => {
      console.info('Received tool call result:', result);
      this.serverTime.set(extractTime(result));
    };

    instance.ontoolcancelled = (params) => {
      console.info('Tool call cancelled:', params.reason);
    };

    instance.onerror = console.error;

    instance.onhostcontextchanged = (params) => {
      this.hostContext.update((ctx) => ({ ...ctx, ...params }));
    };

    instance.connect().then(
      () => {
        this.app.set(instance);
        this.hostContext.set(instance.getHostContext());
      },
      (e) => console.error('Failed to connect to host:', e),
    );

    inject(DestroyRef).onDestroy(() => void instance.close());
  }

  protected async handleGetTime(): Promise<void> {
    const app = this.app();
    if (!app) return;
    try {
      console.info('Calling get-time tool...');
      const result = await app.callServerTool({ name: 'get-time', arguments: {} });
      console.info('get-time result:', result);
      this.serverTime.set(extractTime(result));
    } catch (e) {
      console.error(e);
      this.serverTime.set('[ERROR]');
    }
  }

  protected async handleSendMessage(): Promise<void> {
    const app = this.app();
    if (!app) return;
    const signal = AbortSignal.timeout(5000);
    try {
      console.info('Sending message text to Host:', this.messageText());
      const { isError } = await app.sendMessage(
        { role: 'user', content: [{ type: 'text', text: this.messageText() }] },
        { signal },
      );
      console.info('Message', isError ? 'rejected' : 'accepted');
    } catch (e) {
      console.error('Message send error:', signal.aborted ? 'timed out' : e);
    }
  }

  protected async handleSendLog(): Promise<void> {
    const app = this.app();
    if (!app) return;
    console.info('Sending log text to Host:', this.logText());
    await app.sendLog({ level: 'info', data: this.logText() });
  }

  protected async handleOpenLink(): Promise<void> {
    const app = this.app();
    if (!app) return;
    console.info('Sending open link request to Host:', this.linkUrl());
    const { isError } = await app.openLink({ url: this.linkUrl() });
    console.info('Open link request', isError ? 'rejected' : 'accepted');
  }
}
