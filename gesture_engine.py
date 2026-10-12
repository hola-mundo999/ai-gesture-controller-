import math
from typing import Dict, List, Tuple, Optional


class GestureEngine:
    """
    Analyzes 21 2D/3D hand landmark coordinates (MediaPipe standard)
    and classifies gestures into virtual actions.
    """

    GESTURES = {
        "OPEN_PALM": "🖐️ Open Palm (Cursor Mode)",
        "PINCH": "🤏 Pinch (Volume / Selection)",
        "PEACE": "✌️ Victory / V-Sign (Play / Pause)",
        "THUMBS_UP": "👍 Thumbs Up (Next Slide / Confirm)",
        "FIST": "✊ Closed Fist (Mute / Halt)",
        "UNKNOWN": "🔍 Searching for Hand...",
    }

    @staticmethod
    def calculate_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        """Euclidean distance between two 2D points."""
        return math.hypot(p2[0] - p1[0], p2[1] - p1[1])

    @classmethod
    def classify_from_landmarks(cls, landmarks: List[Tuple[float, float]]) -> Dict:
        """
        Takes 21 normalized landmarks [(x, y), ...]
        Returns classified gesture, confidence score, and metrics.
        """
        if not landmarks or len(landmarks) < 21:
            return {"gesture": "UNKNOWN", "confidence": 0.0, "details": "No landmarks detected"}

        # Landmark Indices (MediaPipe convention)
        wrist = landmarks[0]
        thumb_tip = landmarks[4]
        index_tip = landmarks[8]
        index_pip = landmarks[6]
        middle_tip = landmarks[12]
        middle_pip = landmarks[10]
        ring_tip = landmarks[16]
        ring_pip = landmarks[14]
        pinky_tip = landmarks[20]
        pinky_pip = landmarks[18]

        # Finger Extension states (is tip higher/further than PIP joint)
        # Assuming origin (0,0) is top-left, so lower y means higher up
        index_up = index_tip[1] < index_pip[1]
        middle_up = middle_tip[1] < middle_pip[1]
        ring_up = ring_tip[1] < ring_pip[1]
        pinky_up = pinky_tip[1] < pinky_pip[1]
        thumb_up = thumb_tip[1] < landmarks[3][1]

        # Pinch detection (Thumb tip close to Index tip)
        pinch_dist = cls.calculate_distance(thumb_tip, index_tip)

        if pinch_dist < 0.07:
            pinch_percent = max(0, min(100, int((1.0 - (pinch_dist / 0.07)) * 100)))
            return {
                "gesture": "PINCH",
                "label": cls.GESTURES["PINCH"],
                "confidence": 0.94,
                "pinch_distance": round(pinch_dist, 3),
                "pinch_intensity": pinch_percent,
                "action": "VOLUME_ADJUST",
            }

        # Thumbs up: Only thumb is extended upwards, rest fingers curled
        if thumb_up and not index_up and not middle_up and not ring_up and not pinky_up:
            return {
                "gesture": "THUMBS_UP",
                "label": cls.GESTURES["THUMBS_UP"],
                "confidence": 0.92,
                "action": "NEXT_SLIDE",
            }

        # Peace sign: Index and Middle are extended, others curled
        if index_up and middle_up and not ring_up and not pinky_up:
            return {
                "gesture": "PEACE",
                "label": cls.GESTURES["PEACE"],
                "confidence": 0.96,
                "action": "PLAY_PAUSE",
            }

        # Open palm: All fingers extended
        if index_up and middle_up and ring_up and pinky_up:
            return {
                "gesture": "OPEN_PALM",
                "label": cls.GESTURES["OPEN_PALM"],
                "confidence": 0.98,
                "action": "CURSOR_TRACK",
            }

        # Fist: No fingers extended
        if not index_up and not middle_up and not ring_up and not pinky_up:
            return {
                "gesture": "FIST",
                "label": cls.GESTURES["FIST"],
                "confidence": 0.91,
                "action": "MUTE_AUDIO",
            }

        return {
            "gesture": "UNKNOWN",
            "label": "🖐️ Partial Gesture",
            "confidence": 0.50,
            "action": "NONE",
        }

    @classmethod
    def generate_synthetic_hand(cls, gesture_type: str) -> List[Tuple[float, float]]:
        """
        Generates 21 synthetic landmark points to simulate gestures in web dashboard or tests.
        """
        # Baseline wrist
        base = [(0.5, 0.8)]
        # Thumb: 1, 2, 3, 4
        # Index: 5, 6, 7, 8
        # Middle: 9, 10, 11, 12
        # Ring: 13, 14, 15, 16
        # Pinky: 17, 18, 19, 20

        if gesture_type == "PINCH":
            # Thumb and Index tips touch at (0.45, 0.40)
            return [
                (0.5, 0.8),
                (0.46, 0.7), (0.44, 0.58), (0.44, 0.48), (0.45, 0.40), # Thumb
                (0.48, 0.6), (0.47, 0.50), (0.46, 0.43), (0.45, 0.40), # Index (pinched)
                (0.52, 0.6), (0.52, 0.52), (0.52, 0.58), (0.52, 0.65), # Middle (down)
                (0.55, 0.6), (0.55, 0.54), (0.55, 0.60), (0.55, 0.67), # Ring (down)
                (0.58, 0.6), (0.58, 0.56), (0.58, 0.62), (0.58, 0.69), # Pinky (down)
            ]
        elif gesture_type == "PEACE":
            return [
                (0.5, 0.8),
                (0.44, 0.7), (0.42, 0.6), (0.42, 0.55), (0.44, 0.55), # Thumb (curled)
                (0.48, 0.6), (0.47, 0.45), (0.46, 0.35), (0.45, 0.25), # Index (up)
                (0.52, 0.6), (0.52, 0.45), (0.53, 0.35), (0.54, 0.24), # Middle (up)
                (0.56, 0.6), (0.56, 0.55), (0.56, 0.62), (0.56, 0.68), # Ring (curled)
                (0.60, 0.6), (0.60, 0.57), (0.60, 0.64), (0.60, 0.70), # Pinky (curled)
            ]
        elif gesture_type == "THUMBS_UP":
            return [
                (0.5, 0.8),
                (0.44, 0.65), (0.42, 0.50), (0.42, 0.38), (0.42, 0.25), # Thumb (high up)
                (0.48, 0.6), (0.48, 0.55), (0.48, 0.62), (0.48, 0.68), # Index
                (0.52, 0.6), (0.52, 0.55), (0.52, 0.62), (0.52, 0.68), # Middle
                (0.56, 0.6), (0.56, 0.55), (0.56, 0.62), (0.56, 0.68), # Ring
                (0.60, 0.6), (0.60, 0.55), (0.60, 0.62), (0.60, 0.68), # Pinky
            ]
        elif gesture_type == "FIST":
            return [
                (0.5, 0.8),
                (0.44, 0.7), (0.45, 0.6), (0.46, 0.58), (0.48, 0.58), # Thumb
                (0.48, 0.6), (0.48, 0.55), (0.48, 0.62), (0.48, 0.68), # Index
                (0.52, 0.6), (0.52, 0.55), (0.52, 0.62), (0.52, 0.68), # Middle
                (0.56, 0.6), (0.56, 0.55), (0.56, 0.62), (0.56, 0.68), # Ring
                (0.60, 0.6), (0.60, 0.55), (0.60, 0.62), (0.60, 0.68), # Pinky
            ]
        else: # OPEN_PALM
            return [
                (0.5, 0.8),
                (0.42, 0.7), (0.38, 0.6), (0.35, 0.5), (0.32, 0.42), # Thumb (out)
                (0.46, 0.6), (0.45, 0.45), (0.44, 0.35), (0.43, 0.22), # Index (up)
                (0.51, 0.6), (0.51, 0.43), (0.51, 0.32), (0.51, 0.18), # Middle (up)
                (0.56, 0.6), (0.57, 0.45), (0.58, 0.35), (0.59, 0.22), # Ring (up)
                (0.62, 0.6), (0.63, 0.48), (0.64, 0.40), (0.65, 0.30), # Pinky (up)
            ]
