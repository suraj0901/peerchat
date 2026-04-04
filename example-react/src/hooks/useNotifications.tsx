import { useState, useCallback } from 'react';

// ── Notification system ──────────────────────────────────────────────────────

export type AppNotification = {
  id: number;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
};
let notifCounter = 0;
export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const add = useCallback(
    (type: AppNotification['type'], title: string, message: string) => {
      const id = ++notifCounter;
      setNotifications((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 8000);
    },
    []
  );

  const dismiss = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { notifications, add, dismiss };
}
