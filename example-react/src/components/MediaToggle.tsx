import { Icons } from './Icons';
import { useMediaContext } from '../context/media-context';

// ── MediaToggle — renders based on media state _tag ──────────────────────────
export function MediaToggle() {
  const { state } = useMediaContext();

  switch (state._tag) {
    case 'idle':
      return (
        <div className="home-media-row">
          <button
            className="btn btn--secondary"
            onClick={() => state.request({ audio: true, video: true })}
          >
            {Icons.camera} Preview Camera
          </button>
        </div>
      );

    case 'checkingPermissions':
    case 'requesting':
    case 'recovering':
      return (
        <div className="home-media-row">
          <button className="btn btn--secondary" disabled>
            <div className="loader" style={{ width: 16, height: 16, margin: 0, borderWidth: 2 }} />
            Starting…
          </button>
        </div>
      );

    case 'active':
    case 'switching':
      return (
        <div className="home-media-row">
          <button className="btn btn--secondary" onClick={() => state.stop()}>
            {Icons.cameraOff} Stop Preview
          </button>
        </div>
      );

    case 'denied':
      return (
        <div className="home-media-row">
          <button className="btn btn--secondary" onClick={() => state.retry()}>
            {Icons.camera} Retry Camera
          </button>
        </div>
      );
  }
}
