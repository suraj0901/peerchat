import { useMediaContext } from "../context/media-context";
import { Icons } from "./Icons";

export function LocalMediaControls() {
    const { state: mediaState } = useMediaContext();

    // ── Inactive Media State ──
    if (mediaState._tag !== 'active' && mediaState._tag !== 'switching') {
        return (
            <>
                <div className="control-with-select">
                    <button
                        className="ctrl-btn ctrl-btn--inactive"
                        title="Microphone is not active"
                        id="toggle-mic"
                    >
                        {Icons.mic}
                    </button>
                </div>
                <div className="control-with-select">
                    <button
                        className="ctrl-btn ctrl-btn--inactive"
                        title="Camera is not active"
                        id="toggle-camera"
                    >
                        {Icons.camera}
                    </button>
                </div>
            </>
        );
    }

    // ── Switching Media State ──
    if (mediaState._tag === 'switching') {
        return (
            <>
                <div className="control-with-select">
                    <button
                        className="ctrl-btn ctrl-btn--inactive"
                        title="Microphone is busy"
                        id="toggle-mic"
                        disabled
                    >
                        {Icons.mic}
                    </button>
                </div>
                <div className="control-with-select">
                    <button
                        className="ctrl-btn ctrl-btn--inactive"
                        title="Camera is busy"
                        id="toggle-camera"
                        disabled
                    >
                        {Icons.camera}
                    </button>
                </div>
            </>
        );
    }

    // ── Active Media State ──
    const cameras = mediaState.devices.filter((d) => d.kind === 'videoinput');
    const microphones = mediaState.devices.filter((d) => d.kind === 'audioinput');

    return (
        <>
            <div className="control-with-select">
                <button
                    className={`ctrl-btn ${mediaState.audioMuted ? 'ctrl-btn--off' : ''}`}
                    onClick={mediaState.toggleAudio}
                    title={mediaState.audioMuted ? 'Unmute microphone' : 'Mute microphone'}
                    id="toggle-mic"
                >
                    {mediaState.audioMuted ? Icons.micOff : Icons.mic}
                </button>

                {microphones.length > 1 && (
                    <select
                        className="device-select"
                        onChange={(e) => mediaState.switchDevice('audio', e.target.value)}
                        title="Select microphone"
                    >
                        {microphones.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                                {d.label || `Mic ${d.deviceId.slice(0, 5)}`}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div className="control-with-select">
                <button
                    className={`ctrl-btn ${mediaState.videoMuted ? 'ctrl-btn--off' : ''}`}
                    onClick={mediaState.toggleVideo}
                    title={mediaState.videoMuted ? 'Turn on camera' : 'Turn off camera'}
                    id="toggle-camera"
                >
                    {mediaState.videoMuted ? Icons.cameraOff : Icons.camera}
                </button>

                {cameras.length > 1 && (
                    <select
                        className="device-select"
                        onChange={(e) => mediaState.switchDevice('video', e.target.value)}
                        title="Select camera"
                    >
                        {cameras.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                                {d.label || `Cam ${d.deviceId.slice(0, 5)}`}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        </>
    );
}
