import * as React from 'react';
import { toast } from 'sonner';
import { apiFetch, apiEventSource } from '../lib/api';

type TemplateMetadataNotification = {
  templateSlug: string;
  status: 'processing' | 'complete' | 'error';
  message?: string;
  metadata?: any;
  timestamp: number;
};

type TemplateMetadataContextType = {
  metadataProcessing: Set<string>;
  startTracking: (templateSlug?: string) => void;
  stopTracking: () => void;
  refreshCallback: (() => void) | null;
  setRefreshCallback: (callback: (() => void) | null) => void;
};

const TemplateMetadataContext = React.createContext<TemplateMetadataContextType | undefined>(undefined);

export function TemplateMetadataProvider({ children }: { children: React.ReactNode }) {
  const [metadataProcessing, setMetadataProcessing] = React.useState<Set<string>>(new Set());
  const refreshCallbackRef = React.useRef<(() => void) | null>(null);
  const eventSourceRef = React.useRef<EventSource | null>(null);

  const setRefreshCallback = React.useCallback((callback: (() => void) | null) => {
    refreshCallbackRef.current = callback;
  }, []);

  const startTracking = React.useCallback((templateSlug?: string) => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Clear processing set when starting new tracking session
    console.log('[TEMPLATE-METADATA-SSE] Starting new tracking session, clearing processing set');
    setMetadataProcessing(new Set());

    // Create new SSE connection with optional slug tracking
    const url = templateSlug 
      ? `/api/templates/metadata/stream?slug=${encodeURIComponent(templateSlug)}`
      : `/api/templates/metadata/stream`;
    
    console.log('[TEMPLATE-METADATA-SSE] Connecting to SSE:', url);
    const eventSource = apiEventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log('[TEMPLATE-METADATA-SSE] Connected to template metadata stream');
        }

        if (data.type === 'notification' && data.notification) {
          const notification: TemplateMetadataNotification = data.notification;
          console.log('[TEMPLATE-METADATA-SSE] Received notification:', notification);

          if (notification.status === 'processing') {
            console.log('[TEMPLATE-METADATA-SSE] Adding to processing set:', notification.templateSlug);
            setMetadataProcessing(prev => {
              const next = new Set(prev);
              next.add(notification.templateSlug);
              console.log('[TEMPLATE-METADATA-SSE] Processing set now contains:', Array.from(next));
              return next;
            });
            toast.info(`Extracting template metadata for ${notification.templateSlug}...`);
          } else if (notification.status === 'complete') {
            // Trigger refresh callback BEFORE updating state and closing connection
            console.log('[TEMPLATE-METADATA-SSE] Checking for refresh callback...', {
              hasCallback: !!refreshCallbackRef.current
            });
            if (refreshCallbackRef.current) {
              console.log('[TEMPLATE-METADATA-SSE] Executing refresh callback');
              refreshCallbackRef.current();
            } else {
              console.warn('[TEMPLATE-METADATA-SSE] No refresh callback set!');
            }

            // Update state and close connection after callback
            setMetadataProcessing(prev => {
              const next = new Set(prev);
              const wasInSet = next.has(notification.templateSlug);
              next.delete(notification.templateSlug);
              
              console.log('[TEMPLATE-METADATA-SSE] Removing from processing set:', notification.templateSlug);
              console.log('[TEMPLATE-METADATA-SSE] Was in set:', wasInSet);
              console.log('[TEMPLATE-METADATA-SSE] Processing set now contains:', Array.from(next));
              
              // Close SSE connection when all processing is complete
              if (next.size === 0 && eventSourceRef.current) {
                console.log('[TEMPLATE-METADATA-SSE] All processing complete, closing connection');
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              
              return next;
            });
            
            toast.success(`Template metadata extracted for ${notification.templateSlug}`);
          } else if (notification.status === 'error') {
            console.log('[TEMPLATE-METADATA-SSE] Error notification:', notification.templateSlug);
            setMetadataProcessing(prev => {
              const next = new Set(prev);
              next.delete(notification.templateSlug);
              console.log('[TEMPLATE-METADATA-SSE] Processing set now contains:', Array.from(next));
              
              // Close SSE connection when all processing is complete
              if (next.size === 0 && eventSourceRef.current) {
                console.log('[TEMPLATE-METADATA-SSE] All processing complete, closing connection');
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              
              return next;
            });
            
            toast.error(notification.message || `Failed to extract template metadata for ${notification.templateSlug}`);
          }
        }
      } catch (error) {
        console.error('[TEMPLATE-METADATA-SSE] Error processing event:', error);
      }
    });

    eventSource.addEventListener('error', (error) => {
      console.error('[TEMPLATE-METADATA-SSE] Connection error:', error);
      // Don't show toast for connection errors as they're common during page navigation
    });
  }, []);

  const stopTracking = React.useCallback(() => {
    console.log('[TEMPLATE-METADATA-SSE] Stopping tracking');
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setMetadataProcessing(new Set());
  }, []);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <TemplateMetadataContext.Provider 
      value={{ 
        metadataProcessing, 
        startTracking, 
        stopTracking, 
        refreshCallback: refreshCallbackRef.current,
        setRefreshCallback 
      }}
    >
      {children}
    </TemplateMetadataContext.Provider>
  );
}

export function useTemplateMetadata() {
  const context = React.useContext(TemplateMetadataContext);
  if (!context) {
    throw new Error('useTemplateMetadata must be used within a TemplateMetadataProvider');
  }
  return context;
}
