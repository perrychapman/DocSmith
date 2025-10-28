import { getDB } from './storage';
import { logInfo, logError } from '../utils/logger';

interface ChatMessage {
  id?: number;
  workspaceSlug: string;
  customerId?: number;
  role: 'user' | 'assistant';
  content: string;
  conversationId?: string;
  messageIndex?: number;
  sailpointContext?: string; // JSON string
  sessionId?: string;
  isVisible?: number; // 0 or 1
  sentAt?: Date | string | number;
}

interface ChatMessageRow {
  id: number;
  workspaceSlug: string;
  customerId: number | null;
  role: string;
  content: string;
  conversationId: string | null;
  messageIndex: number;
  sailpointContext: string | null;
  sessionId: string;
  isVisible: number;
  sentAt: string;
  createdAt: string;
}

/**
 * Store a chat message in our local database
 */
export function storeChatMessage(message: ChatMessage): Promise<number> {
  return new Promise((resolve, reject) => {
    const db = getDB();
    
    const sql = `
      INSERT INTO chat_messages (
        workspaceSlug, customerId, role, content, conversationId, messageIndex,
        sailpointContext, sessionId, isVisible, sentAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const sentAt = message.sentAt 
      ? new Date(message.sentAt).toISOString() 
      : new Date().toISOString();
    
    const contentLength = message.content?.length || 0;
    const contextLength = message.sailpointContext?.length || 0;
    
    logInfo(`[CHAT_MESSAGES] Storing ${message.role} message (content: ${contentLength} chars, context: ${contextLength} chars)`);
    
    const params = [
      message.workspaceSlug,
      message.customerId || null,
      message.role,
      message.content,
      message.conversationId || null,
      message.messageIndex || 0,
      message.sailpointContext || null,
      message.sessionId || 'user-interactive',
      message.isVisible !== undefined ? message.isVisible : 1,
      sentAt
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        logError(`[CHAT_MESSAGES] Failed to store ${message.role} message (${contentLength} chars):`, err);
        reject(err);
      } else {
        logInfo(`[CHAT_MESSAGES] ✓ Stored message ${this.lastID} for workspace ${message.workspaceSlug} (${message.role})`);
        resolve(this.lastID);
      }
    });
  });
}

/**
 * Get chat messages for a workspace with filtering and pagination
 */
export function getChatMessages(
  workspaceSlug: string,
  options: {
    sessionId?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'asc' | 'desc';
    onlyVisible?: boolean;
  } = {}
): Promise<ChatMessageRow[]> {
  return new Promise((resolve, reject) => {
    const db = getDB();
    
    const { 
      sessionId, 
      limit = 100, 
      offset = 0, 
      orderBy = 'desc',
      onlyVisible = true
    } = options;
    
    let sql = `
      SELECT * FROM chat_messages 
      WHERE workspaceSlug = ?
    `;
    
    const params: any[] = [workspaceSlug];
    
    if (sessionId) {
      sql += ` AND sessionId = ?`;
      params.push(sessionId);
    }
    
    if (onlyVisible) {
      sql += ` AND isVisible = 1`;
    }
    
    sql += ` ORDER BY sentAt ${orderBy.toUpperCase()}, id ${orderBy.toUpperCase()}`;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    db.all<ChatMessageRow>(sql, params, (err, rows) => {
      if (err) {
        logError('[CHAT_MESSAGES] Failed to fetch messages:', err);
        reject(err);
      } else {
        logInfo(`[CHAT_MESSAGES] Retrieved ${rows?.length || 0} messages for workspace ${workspaceSlug}${sessionId ? ` (session: ${sessionId})` : ''}`);
        if (rows && rows.length > 0) {
          logInfo(`[CHAT_MESSAGES] Message ID range: ${rows[rows.length - 1].id} to ${rows[0].id}, CustomerIDs: ${[...new Set(rows.map(r => r.customerId))].join(', ')}`);
        }
        resolve(rows || []);
      }
    });
  });
}

/**
 * Delete all chat messages for a workspace
 */
export function deleteChatMessages(workspaceSlug: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = getDB();
    
    db.run(
      'DELETE FROM chat_messages WHERE workspaceSlug = ?',
      [workspaceSlug],
      (err) => {
        if (err) {
          logError('[CHAT_MESSAGES] Failed to delete messages:', err);
          reject(err);
        } else {
          logInfo(`[CHAT_MESSAGES] Deleted all messages for workspace ${workspaceSlug}`);
          resolve();
        }
      }
    );
  });
}

/**
 * Delete all chat messages for a customer
 */
export function deleteChatMessagesByCustomer(customerId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = getDB();
    
    db.run(
      'DELETE FROM chat_messages WHERE customerId = ?',
      [customerId],
      (err) => {
        if (err) {
          logError('[CHAT_MESSAGES] Failed to delete customer messages:', err);
          reject(err);
        } else {
          logInfo(`[CHAT_MESSAGES] Deleted all messages for customer ${customerId}`);
          resolve();
        }
      }
    );
  });
}

/**
 * Generate a conversation ID
 */
export function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
