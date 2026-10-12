import time
from typing import Dict, List


class ActionDispatcher:
    """
    Manages state for virtual controls: Volume, Slide Position, Playback state,
    and maintains an audit log of triggered events.
    """

    def __init__(self):
        self.volume = 50 # 0 to 100
        self.current_slide = 1
        self.max_slides = 20
        self.is_playing = False
        self.is_muted = False
        self.last_action_time = 0
        self.action_history: List[Dict] = []

    def dispatch(self, gesture_result: Dict) -> Dict:
        now = time.time()
        gesture = gesture_result.get("gesture")
        action = gesture_result.get("action")
        feedback = "Idle"

        # Cooldown check for discrete gestures (to prevent rapid-fire triggers)
        is_discrete = gesture in ["THUMBS_UP", "PEACE", "FIST"]
        if is_discrete and (now - self.last_action_time < 0.8):
            return self.get_state(feedback="Cooldown active")

        if gesture == "PINCH":
            intensity = gesture_result.get("pinch_intensity", 50)
            self.volume = intensity
            feedback = f"Volume adjusted to {self.volume}%"
            self._log("Volume Change", f"{self.volume}%")

        elif gesture == "THUMBS_UP":
            self.current_slide = min(self.max_slides, self.current_slide + 1)
            feedback = f"Advanced to Slide {self.current_slide}"
            self._log("Slide Navigation", f"Slide {self.current_slide}")
            self.last_action_time = now

        elif gesture == "PEACE":
            self.is_playing = not self.is_playing
            state_str = "Playing ▶️" if self.is_playing else "Paused ⏸️"
            feedback = f"Media State: {state_str}"
            self._log("Media Toggle", state_str)
            self.last_action_time = now

        elif gesture == "FIST":
            self.is_muted = not self.is_muted
            feedback = "Audio Muted 🔇" if self.is_muted else "Audio Unmuted 🔊"
            self._log("Mute Toggle", "Muted" if self.is_muted else "Unmuted")
            self.last_action_time = now

        elif gesture == "OPEN_PALM":
            feedback = "Tracking Hand Position (Cursor Mode)"

        return self.get_state(feedback=feedback)

    def _log(self, event_type: str, detail: str):
        timestamp = time.strftime("%H:%M:%S")
        self.action_history.insert(0, {
            "time": timestamp,
            "type": event_type,
            "detail": detail
        })
        if len(self.action_history) > 30:
            self.action_history.pop()

    def get_state(self, feedback: str = "") -> Dict:
        return {
            "volume": self.volume,
            "is_muted": self.is_muted,
            "slide": self.current_slide,
            "is_playing": self.is_playing,
            "feedback": feedback,
            "history": self.action_history
        }
