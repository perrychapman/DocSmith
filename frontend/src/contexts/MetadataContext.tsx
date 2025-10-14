import * as React from 'react';
import { toast } from 'sonner';
import { apiFetch, apiEventSource } from '../lib/api';

type MetadataNotification = {
  customerId: number;
  filename: string;
  status: 'processing' | 'complete' | 'error';
  message?: string;
  metadata?: any;
  timestamp: number;
};

type MetadataContextType = {
  metadataProcessing: Set<string>;
  startTracking: (customerId: number, filename?: string) => void;
  stopTracking: () => void;
  refreshCallback: ((customerId: number) => void) | null;
  setRefreshCallback: (callback: ((customerId: number) => void) | null) => void;
};

const MetadataContext = React.createContext<MetadataContextType | undefined>(undefined);

export function MetadataProvider({ children }: { children: React.ReactNode }) {
  const [metadataProcessing, setMetadataProcessing] = React.useState<Set<string>>(new Set());
  const [currentCustomerId, setCurrentCustomerId] = React.useState<number | null>(null);
  const refreshCallbackRef = React.useRef<((customerId: number) => void) | null>(null);
  const eventSourceRef = React.useRef<EventSource | null>(null);

  const setRefreshCallback = React.useCallback((callback: ((customerId: number) => void) | null) => {
    refreshCallbackRef.current = callback;
  }, []);

  const startTracking = React.useCallback((customerId: number, filename?: string) => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Clear processing set when starting new tracking session
    console.log('[METADATA-SSE] Starting new tracking session, clearing processing set');
    setMetadataProcessing(new Set());
    setCurrentCustomerId(customerId);

    // Create new SSE connection with optional filename tracking
    const url = filename 
      ? `/api/uploads/metadata-stream/${customerId}?filename=${encodeURIComponent(filename)}`
      : `/api/uploads/metadata-stream/${customerId}`;
    
    console.log('[METADATA-SSE] Connecting to SSE:', url);
    const eventSource = apiEventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          console.log('[METADATA-SSE] Connected to metadata stream for customer', customerId);
        }

        if (data.type === 'notification' && data.notification) {
          const notification: MetadataNotification = data.notification;
          console.log('[METADATA-SSE] Received notification:', notification);

          if (notification.status === 'processing') {
            console.log('[METADATA-SSE] Adding to processing set:', notification.filename);
            setMetadataProcessing(prev => {
              const next = new Set(prev);
              next.add(notification.filename);
              console.log('[METADATA-SSE] Processing set now contains:', Array.from(next));
              return next;
            });
            toast.info(`Extracting metadata for ${notification.filename}...`);
          } else if (notification.status === 'complete') {
            // Trigger refresh callback BEFORE updating state and closing connection
            console.log('[METADATA-SSE] Checking for refresh callback...', {
              hasCallback: !!refreshCallbackRef.current,
              customerId: notification.customerId
            });
            if (refreshCallbackRef.current) {
              console.log('[METADATA-SSE] Executing refresh callback for customer', notification.customerId);
              refreshCallbackRef.current(notification.customerId);
            } else {
              console.warn('[METADATA-SSE] No refresh callback set!');
            }

            // Update state and close connection after callback
            setMetadataProcessing(prev => {
              const next = new Set(prev);
              const wasInSet = next.has(notification.filename);
              next.delete(notification.filename);
              
              console.log('[METADATA-SSE] Removing from processing set:', notification.filename);
              console.log('[METADATA-SSE] Was in set:', wasInSet);
              console.log('[METADATA-SSE] Processing set now contains:', Array.from(next));
              
              // Close SSE connection when all processing is complete
              if (next.size === 0 && eventSourceRef.current) {
                console.log('[METADATA-SSE] All extractions complete, closing SSE connection');
                // Delay closing slightly to ensure callback completes
                setTimeout(() => {
                  if (eventSourceRef.current) {
                    eventSourceRef.current.close();
                    eventSourceRef.current = null;
                  }
                }, 100);
              }
              
              return next;
            });
            toast.success(`Metadata extracted for ${notification.filename}`);
          } else if (notification.status === 'error') {
            setMetadataProcessing(prev => {
              const next = new Set(prev);
              next.delete(notification.filename);
              
              // Close SSE connection when all processing is complete
              if (next.size === 0 && eventSourceRef.current) {
                console.log('[METADATA-SSE] All extractions complete (with errors), closing SSE connection');
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              
              return next;
            });
            toast.error(`Metadata extraction failed: ${notification.message || 'Unknown error'}`);
          }
        }
      } catch (err) {
        console.error('[METADATA-SSE] Failed to parse event:', err);
      }
    });

    eventSource.addEventListener('error', () => {
      console.error('[METADATA-SSE] Connection error');
      eventSource.close();
    });
  }, []); // No dependencies - use ref instead

  const stopTracking = React.useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    // Clear processing set when stopping tracking
    console.log('[METADATA-SSE] Stopping tracking, clearing processing set');
    setMetadataProcessing(new Set());
    setCurrentCustomerId(null);
  }, []);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const value: MetadataContextType = {
    metadataProcessing,
    startTracking,
    stopTracking,
    refreshCallback: refreshCallbackRef.current,
    setRefreshCallback
  };

  return (
    <MetadataContext.Provider value={value}>
      {children}
    </MetadataContext.Provider>
  );
}

export function useMetadata() {
  const context = React.useContext(MetadataContext);
  if (context === undefined) {
    throw new Error('useMetadata must be used within a MetadataProvider');
  }
  return context;
}
