import { useMediaContext } from "../context/media-context";
import { Icons } from "./Icons";

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════════════════════
export function LocalPiP() {
    const { state: mediaState } = useMediaContext();

    // ── Inactive Media State ──
    if (mediaState._tag !== 'active' && mediaState._tag !== 'switching') {
        return (
            <div className="local-pip">
                <div className="pip-muted-overlay">{Icons.cameraOff}</div>
            </div>
        );
    }

    // ── Active / Switching Media State ──
    const isVideoMuted = mediaState._tag === 'active' ? mediaState.videoMuted : false;

    return (
        <div className="local-pip">
            <video
                ref={(element) => {
                    if (element) {
                        element.srcObject = mediaState.stream;
                    }
                }}
                autoPlay
                playsInline
                muted
                className="local-video"
                id="local-video" />
            {isVideoMuted && (
                <div className="pip-muted-overlay">{Icons.cameraOff}</div>
            )}
        </div>
    );
}
