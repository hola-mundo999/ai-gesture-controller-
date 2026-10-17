import time

from gesture_engine import GestureEngine
from virtual_actions import ActionDispatcher


def test_open_palm_classification():
    lm = GestureEngine.generate_synthetic_hand("OPEN_PALM")
    result = GestureEngine.classify_from_landmarks(lm)
    assert result["gesture"] == "OPEN_PALM"
    assert result["action"] == "CURSOR_TRACK"
    assert result["confidence"] == 0.98


def test_pinch_classification_and_intensity_bounds():
    lm = GestureEngine.generate_synthetic_hand("PINCH")
    result = GestureEngine.classify_from_landmarks(lm)
    assert result["gesture"] == "PINCH"
    assert result["action"] == "VOLUME_ADJUST"
    assert 0 <= result["pinch_intensity"] <= 100
    assert result["pinch_distance"] < 0.07


def test_peace_classification():
    lm = GestureEngine.generate_synthetic_hand("PEACE")
    result = GestureEngine.classify_from_landmarks(lm)
    assert result["gesture"] == "PEACE"
    assert result["action"] == "PLAY_PAUSE"


def test_thumbs_up_classification():
    lm = GestureEngine.generate_synthetic_hand("THUMBS_UP")
    result = GestureEngine.classify_from_landmarks(lm)
    assert result["gesture"] == "THUMBS_UP"
    assert result["action"] == "NEXT_SLIDE"


def test_fist_classification():
    lm = GestureEngine.generate_synthetic_hand("FIST")
    result = GestureEngine.classify_from_landmarks(lm)
    assert result["gesture"] == "FIST"
    assert result["action"] == "MUTE_AUDIO"


def test_unknown_for_fewer_than_21_landmarks():
    result = GestureEngine.classify_from_landmarks([(0.5, 0.8)] * 5)
    assert result["gesture"] == "UNKNOWN"
    assert result["confidence"] == 0.0


def test_unknown_for_empty_landmarks():
    assert GestureEngine.classify_from_landmarks([])["gesture"] == "UNKNOWN"


def test_calculate_distance():
    assert GestureEngine.calculate_distance((0, 0), (3, 4)) == 5.0


def test_pinch_distance_above_threshold_not_pinch():
    lm = GestureEngine.generate_synthetic_hand("OPEN_PALM")
    assert GestureEngine.classify_from_landmarks(lm)["gesture"] == "OPEN_PALM"


def test_dispatch_advances_slide_once_within_cooldown():
    d = ActionDispatcher()
    gesture = {"gesture": "THUMBS_UP", "action": "NEXT_SLIDE"}
    state1 = d.dispatch(gesture)
    state2 = d.dispatch(gesture)  # same gesture within 0.8s cooldown
    assert state1["slide"] == 2
    assert state2["slide"] == 2


def test_dispatch_slide_capped_at_max():
    d = ActionDispatcher()
    d.current_slide = d.max_slides
    state = d.dispatch({"gesture": "THUMBS_UP", "action": "NEXT_SLIDE"})
    assert state["slide"] == d.max_slides


def test_dispatch_mute_toggle():
    d = ActionDispatcher()
    assert d.dispatch({"gesture": "FIST", "action": "MUTE_AUDIO"})["is_muted"] is True
    time.sleep(0.81)
    assert d.dispatch({"gesture": "FIST", "action": "MUTE_AUDIO"})["is_muted"] is False


def test_dispatch_pinch_volume_range():
    d = ActionDispatcher()
    assert d.dispatch({"gesture": "PINCH", "action": "VOLUME_ADJUST", "pinch_intensity": 10})["volume"] == 10
    assert d.dispatch({"gesture": "PINCH", "action": "VOLUME_ADJUST", "pinch_intensity": 90})["volume"] == 90


def test_dispatch_unknown_gesture_is_noop():
    d = ActionDispatcher()
    before = d.get_state()
    after = d.dispatch({"gesture": "UNKNOWN", "action": "NONE"})
    assert after["slide"] == before["slide"]
    assert after["volume"] == before["volume"]


def test_dispatch_history_capped():
    d = ActionDispatcher()
    for _ in range(50):
        d.dispatch({"gesture": "THUMBS_UP", "action": "NEXT_SLIDE"})
    assert len(d.action_history) <= 30


def test_media_toggle_flips_state():
    d = ActionDispatcher()
    s1 = d.dispatch({"gesture": "PEACE", "action": "PLAY_PAUSE"})
    time.sleep(0.81)
    s2 = d.dispatch({"gesture": "PEACE", "action": "PLAY_PAUSE"})
    assert s1["is_playing"] is True
    assert s2["is_playing"] is False
