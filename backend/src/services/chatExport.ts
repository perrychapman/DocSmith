import { getChatMessages } from './chatMessages';
import { mergeHtmlIntoDocxTemplate } from './docxCompose';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

// Configure marked for better Word document conversion
marked.setOptions({
  gfm: true,        // GitHub Flavored Markdown (tables, strikethrough, task lists, etc.)
  breaks: true,     // Convert \n to <br>
});

// Custom renderer to add Word-friendly table styling
const renderer = new marked.Renderer();

// Override table rendering to add inline styles
renderer.table = function(header: string, body: string) {
  return `<table style="width: 100%; border-collapse: collapse; margin: 15px 0; border: 1px solid #bfbfbf; font-size: 11pt;">
<thead style="background-color: #4472c4; color: white; font-weight: bold;">
${header}
</thead>
<tbody>
${body}
</tbody>
</table>`;
};

renderer.tablerow = function(content: string) {
  return `<tr style="border: 1px solid #bfbfbf;">${content}</tr>\n`;
};

renderer.tablecell = function(content: string, flags: { header: boolean; align: 'center' | 'left' | 'right' | null }) {
  const type = flags.header ? 'th' : 'td';
  const align = flags.align ? ` text-align: ${flags.align};` : '';
  return `<${type} style="padding: 10px; border: 1px solid #bfbfbf;${align}">${content}</${type}>`;
};

// Style headers
renderer.heading = function(text: string, level: number) {
  const sizes = { 1: '18pt', 2: '16pt', 3: '14pt', 4: '12pt', 5: '11pt', 6: '11pt' };
  const colors = { 1: '#1f4e78', 2: '#2e5c8a', 3: '#4472c4', 4: '#5b9bd5', 5: '#70ad47', 6: '#70ad47' };
  const margins = { 1: '20px 0 12px 0', 2: '18px 0 10px 0', 3: '16px 0 8px 0', 4: '14px 0 6px 0', 5: '12px 0 6px 0', 6: '12px 0 6px 0' };
  return `<h${level} style="color: ${colors[level as keyof typeof colors]}; font-size: ${sizes[level as keyof typeof sizes]}; font-weight: bold; margin: ${margins[level as keyof typeof margins]};">${text}</h${level}>`;
};

// Style paragraphs
renderer.paragraph = function(text: string) {
  return `<p style="margin: 0 0 10px 0; line-height: 1.5; font-size: 11pt;">${text}</p>`;
};

// Style lists
renderer.list = function(body: string, ordered: boolean) {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag} style="margin: 10px 0; padding-left: 25px; font-size: 11pt;">${body}</${tag}>`;
};

renderer.listitem = function(text: string) {
  return `<li style="margin: 4px 0; line-height: 1.5;">${text}</li>`;
};

// Style code blocks
renderer.code = function(code: string, language: string | undefined) {
  return `<pre style="background-color: #f5f5f5; border: 1px solid #d0d0d0; padding: 12px; margin: 10px 0; font-family: 'Courier New', monospace; font-size: 10pt; white-space: pre-wrap; word-wrap: break-word;"><code>${escapeHtml(code)}</code></pre>`;
};

// Style inline code
renderer.codespan = function(code: string) {
  return `<code style="background-color: #f5f5f5; padding: 2px 6px; font-family: 'Courier New', monospace; font-size: 10pt; border: 1px solid #e0e0e0;">${code}</code>`;
};

// Style blockquotes
renderer.blockquote = function(quote: string) {
  return `<blockquote style="border-left: 4px solid #d0d0d0; margin: 10px 0; padding: 10px 15px; background-color: #f9f9f9; font-style: italic;">${quote}</blockquote>`;
};

// Style horizontal rules
renderer.hr = function() {
  return `<hr style="border: none; border-top: 2px solid #d0d0d0; margin: 20px 0;">`;
};

// Style strong/bold
renderer.strong = function(text: string) {
  return `<strong style="font-weight: bold;">${text}</strong>`;
};

// Style emphasis/italic
renderer.em = function(text: string) {
  return `<em style="font-style: italic;">${text}</em>`;
};

marked.use({ renderer });

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  sentAt: string;
  sailpointMetadata?: any;
  conversationId?: string;
  messageIndex?: number;
}

interface ExportOptions {
  workspaceSlug: string;
  sessionId?: string;
  messageIds?: number[];
  includeMetadata?: boolean;
}

/**
 * Generate HTML content for chat export
 */
async function generateChatHtml(messages: ChatMessage[], workspaceSlug: string, customer?: string): Promise<string> {
  const timestamp = new Date().toLocaleString();
  const messageCount = messages.length;
  const isSingleMessage = messageCount === 1;
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
`;

  // Only show metadata table and headers for multi-message exports
  if (!isSingleMessage) {
    html += `
  <h1>Chat Conversation Export</h1>
  
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; background-color: #f2f2f2; border: 1px solid #d0d0d0;">
    <tr>
      <td style="padding: 15px;">
        <p style="margin: 5px 0;"><strong>Workspace:</strong> ${escapeHtml(workspaceSlug)}</p>
        ${customer ? `<p style="margin: 5px 0;"><strong>Customer:</strong> ${escapeHtml(customer)}</p>` : ''}
        <p style="margin: 5px 0;"><strong>Export Date:</strong> ${escapeHtml(timestamp)}</p>
        <p style="margin: 5px 0;"><strong>Message Count:</strong> ${messageCount}</p>
      </td>
    </tr>
  </table>
  
  <h2>Conversation</h2>
`;
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    const isUser = msg.role === 'user';
    const messageTime = new Date(msg.sentAt).toLocaleString();
    
    // Convert markdown to HTML, with fallback to escaped text
    let contentHtml: string;
    try {
      contentHtml = await marked.parse(msg.content);
    } catch (error) {
      console.error('Failed to parse markdown:', error);
      contentHtml = `<div style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(msg.content)}</div>`;
    }
    
    // For single message export, skip the role/timestamp header and just show content
    if (isSingleMessage) {
      html += `
  <div style="margin: 0;">
    ${contentHtml}
  </div>
`;
    } else {
      // Multi-message export: show full header with role and timestamp
      html += `
  <p style="margin: 25px 0 8px 0; padding: 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">
    <strong style="color: #1f4e78; font-size: 12pt;">${roleLabel}</strong>
    <em style="color: #999999; font-size: 10pt; margin-left: 10px;">${escapeHtml(messageTime)}</em>
  </p>
  <div style="margin: 0 0 10px 0;">
    ${contentHtml}
  </div>
`;
    }

    // SailPoint metadata excluded from exports per user request

    // Add more spacing between user and assistant messages (only for multi-message exports)
    if (!isSingleMessage) {
      const nextMessage = messages[i + 1];
      if (nextMessage && msg.role !== nextMessage.role) {
        // Different roles (user → assistant or assistant → user) - add extra spacing
        html += `  <div style="margin-bottom: 40px;"></div>\n`;
      } else {
        // Same role or last message - normal spacing
        html += `  <div style="margin-bottom: 20px;"></div>\n`;
      }
    }
  }

  html += `
</body>
</html>
`;

  return html;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  // Server-side HTML escaping
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

/**
 * Export chat conversation to Word document
 */
export async function exportChatToWord(options: ExportOptions): Promise<Buffer> {
  const { workspaceSlug, sessionId = 'user-interactive', messageIds, includeMetadata = true } = options;
  
  console.log('[CHAT_EXPORT] Fetching messages for workspace:', workspaceSlug);
  console.log('[CHAT_EXPORT] Session ID:', sessionId);
  console.log('[CHAT_EXPORT] Message IDs requested:', messageIds);
  
  // Fetch messages
  let messages = await getChatMessages(workspaceSlug, {
    sessionId,
    limit: 1000,
    offset: 0,
    onlyVisible: true
  });
  
  console.log('[CHAT_EXPORT] Found', messages.length, 'total messages');
  
  // Filter by specific message IDs if provided
  if (messageIds && messageIds.length > 0) {
    const beforeFilter = messages.length;
    messages = messages.filter((msg: any) => messageIds.includes(msg.id));
    console.log(`[CHAT_EXPORT] Filtered to ${messages.length} messages (from ${beforeFilter}) based on IDs`);
    
    // Log which IDs were not found
    const foundIds = messages.map((msg: any) => msg.id);
    const missingIds = messageIds.filter(id => !foundIds.includes(id));
    if (missingIds.length > 0) {
      console.warn('[CHAT_EXPORT] Warning: Could not find messages with IDs:', missingIds);
    }
  }
  
  if (messages.length === 0) {
    throw new Error('No messages found to export. Messages may not have been saved to the database.');
  }
  
  // Format messages
  const formattedMessages: ChatMessage[] = messages.map((msg: any) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    sentAt: msg.sentAt,
    conversationId: msg.conversationId,
    messageIndex: msg.messageIndex,
    ...(includeMetadata && msg.sailpointContext ? {
      sailpointMetadata: typeof msg.sailpointContext === 'string'
        ? JSON.parse(msg.sailpointContext)
        : msg.sailpointContext
    } : {})
  }));
  
  console.log('[CHAT_EXPORT] Formatted', formattedMessages.length, 'messages for export');
  
  // Generate HTML
  const html = await generateChatHtml(formattedMessages, workspaceSlug);
  
  // Debug: Save HTML to temp file to inspect
  try {
    const debugPath = path.join(process.cwd(), 'data', 'debug-chat-export.html');
    fs.writeFileSync(debugPath, html, 'utf-8');
    console.log('[CHAT_EXPORT] HTML saved to:', debugPath);
  } catch (err) {
    console.error('[CHAT_EXPORT] Failed to save debug HTML:', err);
  }
  
  // Convert HTML directly to DOCX using html-to-docx
  // Note: For better color support and formatting, install Pandoc (see PANDOC_INSTALLATION.md)
  // The docxCompose service will automatically use Pandoc if available
  console.log('[CHAT_EXPORT] Converting HTML to DOCX...');
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const htmlToDocx = require('html-to-docx');
  const docxBuffer = await htmlToDocx(html, null, {
    table: { 
      row: { cantSplit: true } 
    },
    footer: true,
    pageNumber: true,
    font: 'Calibri',
    fontSize: 22, // 11pt in half-points
  });
  
  console.log('[CHAT_EXPORT] Using html-to-docx (limited color support). Install Pandoc for full colors.');
  
  return docxBuffer;
}

/**
 * Create a minimal DOCX template programmatically
 */
async function createMinimalDocxTemplate(): Promise<Buffer> {
  // For now, use html-to-docx to create a minimal template
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const htmlToDocx = require('html-to-docx');
  
  const minimalHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <p>Template</p>
</body>
</html>
`;
  
  return await htmlToDocx(minimalHtml);
}
