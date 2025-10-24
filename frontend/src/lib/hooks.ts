import * as React from 'react';

/**
 * Custom hook for debounced state management
 * Returns [debouncedValue, immediateValue, setImmediateValue]
 * - debouncedValue: updates after delay
 * - immediateValue: updates immediately (for controlled input)
 * - setImmediateValue: setter function
 */
export function useDebouncedState<T>(
  initialValue: T,
  delay: number = 300
): [T, T, React.Dispatch<React.SetStateAction<T>>] {
  const [immediateValue, setImmediateValue] = React.useState<T>(initialValue);
  const [debouncedValue, setDebouncedValue] = React.useState<T>(initialValue);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(immediateValue);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [immediateValue, delay]);

  return [debouncedValue, immediateValue, setImmediateValue];
}

/**
 * Custom hook to detect if user is actively typing/interacting
 * Returns true when user has typed within the last `timeout` milliseconds
 */
export function useUserActivity(timeout: number = 1000): [boolean, () => void] {
  const [isActive, setIsActive] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const signal = React.useCallback(() => {
    setIsActive(true);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      setIsActive(false);
      timeoutRef.current = null;
    }, timeout);
  }, [timeout]);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [isActive, signal];
}
