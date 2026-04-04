import type { AppNotification } from '../hooks/useNotifications';
import { Icons } from './Icons';

// ═══════════════════════════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════════════════════════
export function Notifications({
  notifications, onDismiss,
}: {
  notifications: AppNotification[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;
  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <div key={n.id} className={`toast toast--${n.type}`}>
          <div className="toast-content">
            <strong>{n.title}</strong>
            <p>{n.message}</p>
          </div>
          <button className="toast-close" onClick={() => onDismiss(n.id)}>
            {Icons.x}
          </button>
        </div>
      ))}
    </div>
  );
}
