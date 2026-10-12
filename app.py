import streamlit as st
import time
from gesture_engine import GestureEngine
from virtual_actions import ActionDispatcher

st.set_page_config(
    page_title="AI Gesture Controller | Samyog",
    page_icon="🖐️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Dark Styling
st.markdown("""
<style>
    .stApp {
        background-color: #0a0b10;
        color: #f1f5f9;
    }
    .header-box {
        background: linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(168,85,247,0.15) 100%);
        border: 1px solid rgba(99,102,241,0.3);
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 24px;
    }
    .status-card {
        background: rgba(15,23,42,0.7);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px;
        padding: 18px;
        text-align: center;
    }
    .slide-viewer {
        background: #111827;
        border: 2px solid #374151;
        border-radius: 16px;
        padding: 32px;
        min-height: 220px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
    }
</style>
""", unsafe_allow_html=True)

# State initialization
if "dispatcher" not in st.session_state:
    st.session_state.dispatcher = ActionDispatcher()
if "current_gesture" not in st.session_state:
    st.session_state.current_gesture = "OPEN_PALM"

dispatcher = st.session_state.dispatcher

# Header
st.markdown("""
<div class="header-box">
    <div style="font-family: monospace; font-size: 11px; color: #a5b4fc; margin-bottom: 6px;">
        COMPUTER VISION & HUMAN-COMPUTER INTERACTION (HCI)
    </div>
    <h1 style="margin: 0; font-size: 32px; font-weight: 800; color: white;">
        🖐️ AI Virtual Hand Gesture Controller
    </h1>
    <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 14px;">
        Real-time gesture recognition mapping 21 hand landmarks to virtual system actions (Presentation Slides, Volume, Media).
    </p>
</div>
""", unsafe_allow_html=True)

# Sidebar
with st.sidebar:
    st.markdown("### 🎛️ Control & Mode Settings")
    mode = st.radio(
        "Input Mode",
        options=["Interactive Gesture Simulator", "Live Webcam Stream"],
        help="Interactive simulator runs on all platforms without requiring camera access."
    )

    st.markdown("---")
    st.markdown("### 🖐️ Gesture Trigger Palette")
    st.caption("Select a hand posture to simulate camera recognition:")

    col_g1, col_g2 = st.columns(2)
    with col_g1:
        if st.button("🖐️ Open Palm", use_container_width=True):
            st.session_state.current_gesture = "OPEN_PALM"
        if st.button("🤏 Pinch", use_container_width=True):
            st.session_state.current_gesture = "PINCH"
        if st.button("✌️ Victory / V", use_container_width=True):
            st.session_state.current_gesture = "PEACE"
    with col_g2:
        if st.button("👍 Thumbs Up", use_container_width=True):
            st.session_state.current_gesture = "THUMBS_UP"
        if st.button("✊ Closed Fist", use_container_width=True):
            st.session_state.current_gesture = "FIST"

    st.markdown("---")
    st.markdown("👨‍💻 **Architected by:** Samyog")
    st.caption("Computer Vision & Applied AI Project")

# Process active gesture
landmarks = GestureEngine.generate_synthetic_hand(st.session_state.current_gesture)
classification = GestureEngine.classify_from_landmarks(landmarks)
state = dispatcher.dispatch(classification)

# Metrics Row
col1, col2, col3, col4 = st.columns(4)
with col1:
    st.markdown(f"""
    <div class="status-card">
        <div style="font-size: 11px; font-family: monospace; color: #818cf8;">ACTIVE GESTURE</div>
        <div style="font-size: 18px; font-weight: 700; color: white; margin-top: 4px;">
            {classification.get('label', 'None')}
        </div>
    </div>
    """, unsafe_allow_html=True)

with col2:
    st.markdown(f"""
    <div class="status-card">
        <div style="font-size: 11px; font-family: monospace; color: #c084fc;">CONFIDENCE</div>
        <div style="font-size: 18px; font-weight: 700; color: white; margin-top: 4px;">
            {int(classification.get('confidence', 0) * 100)}%
        </div>
    </div>
    """, unsafe_allow_html=True)

with col3:
    st.markdown(f"""
    <div class="status-card">
        <div style="font-size: 11px; font-family: monospace; color: #38bdf8;">SLIDE NUMBER</div>
        <div style="font-size: 18px; font-weight: 700; color: white; margin-top: 4px;">
            Slide {state['slide']} / {dispatcher.max_slides}
        </div>
    </div>
    """, unsafe_allow_html=True)

with col4:
    vol_text = "MUTED 🔇" if state['is_muted'] else f"{state['volume']}% 🔊"
    st.markdown(f"""
    <div class="status-card">
        <div style="font-size: 11px; font-family: monospace; color: #34d399;">AUDIO STATE</div>
        <div style="font-size: 18px; font-weight: 700; color: white; margin-top: 4px;">
            {vol_text}
        </div>
    </div>
    """, unsafe_allow_html=True)

st.markdown("<br>", unsafe_allow_html=True)

# Main Two Columns: Virtual Screen & Feedback
left_col, right_col = st.columns([3, 2])

with left_col:
    st.subheader("🖥️ Interactive Presentation Screen")
    st.caption("Controlled automatically via gestures: 👍 Next Slide | ✌️ Toggle Play | ✊ Mute")

    # Virtual Slide Deck Content
    slide_titles = [
        "Introduction to Computer Vision & HCI",
        "Spatial Hand Tracking via 21 Landmarks",
        "Real-Time Euclidean Distance Calculations",
        "Edge Inference Optimization on CPUs",
        "Virtual Action Dispatcher Architecture",
        "Gesture Mappings: Pinches, Swipes & Fists",
        "Deploying Vision Pipelines in Production",
        "Summary & Next Steps"
    ]
    current_title = slide_titles[(state['slide'] - 1) % len(slide_titles)]

    st.markdown(f"""
    <div class="slide-viewer">
        <div style="font-size: 12px; font-family: monospace; color: #6366f1; margin-bottom: 8px;">
            SLIDE {state['slide']} OF {dispatcher.max_slides}
        </div>
        <h2 style="color: white; margin: 0 0 16px 0; font-size: 26px;">
            {current_title}
        </h2>
        <p style="color: #94a3b8; font-size: 14px; max-width: 500px; margin: 0 auto;">
            This slide responds directly to hand gestures detected by the vision classifier. Show a thumbs-up to advance or peace sign to toggle media playback.
        </p>
        <div style="margin-top: 20px; font-size: 12px; color: #a5b4fc; background: rgba(99,102,241,0.15); padding: 6px 16px; border-radius: 99px;">
            Media Status: {"▶️ Video Playing" if state["is_playing"] else "⏸️ Video Paused"}
        </div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # Volume Control Slider display
    st.write(f"**Virtual Volume Level ({state['volume']}%)**")
    st.progress(state["volume"] / 100.0)

with right_col:
    st.subheader("📜 Event Audit Log")
    st.caption("Live stream of detected gestures & dispatched system commands:")

    if state["history"]:
        for item in state["history"][:8]:
            st.markdown(f"""
            <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span style="font-family: monospace; color: #94a3b8;">[{item['time']}]</span>
                <strong style="color: #e2e8f0;">{item['type']}</strong>
                <span style="color: #818cf8;">{item['detail']}</span>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.info("No events registered yet. Trigger gestures from the sidebar!")

    st.markdown("---")
    st.markdown("### 📐 Landmark Geometry Reference")
    st.markdown("""
    - **Thumb-Index Pinch Distance:** `Euclidean distance between Landmark 4 & Landmark 8`
    - **Extension Rule:** `Tip Y-coordinate < PIP Joint Y-coordinate`
    - **Classification Rate:** `~30 FPS on standard modern CPU`
    """)
