"""Gesture Controller — Streamlit host.

The controller itself is a self-contained web app (`index.html`, `styles.css`,
`app.js`) so it can be opened directly, served as a static site, or embedded
here. This entry inlines those assets into a single document because Streamlit
component iframes resolve relative URLs against the parent page, not the
repository.

For the best camera behaviour, open the app at the top level:
    python -m http.server 8000   ->   http://localhost:8000

Or run the Streamlit host:
    streamlit run app.py
"""
import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent

st.set_page_config(
    page_title="Gesture Controller — Touchless Media & Pointer Control",
    page_icon="🖐️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Remove Streamlit chrome so the app owns the viewport.
st.markdown(
    """
<style>
  header[data-testid="stHeader"],
  [data-testid="stToolbar"],
  [data-testid="stDecoration"],
  #MainMenu, footer { display: none !important; }
  .stApp { background: #080a0f; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  [data-testid="stAppViewContainer"] > .main { padding: 0 !important; }
  [data-testid="stVerticalBlock"] { gap: 0 !important; }
  iframe { width: 100% !important; border: 0; display: block; }
</style>
""",
    unsafe_allow_html=True,
)


def build_document() -> str:
    """Inline the controller's CSS and JS into one HTML document."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    js = (ROOT / "app.js").read_text(encoding="utf-8")

    # Match optional cache-busting queries on the asset URLs.
    html, styles = re.subn(
        r'<link rel="stylesheet" href="styles\.css[^"]*" />',
        lambda _: f"<style>\n{css}\n</style>",
        html,
    )
    html, scripts = re.subn(
        r'<script src="app\.js[^"]*" defer></script>',
        lambda _: f"<script>\n{js}\n</script>",
        html,
    )
    if styles != 1 or scripts != 1:
        raise RuntimeError("index.html no longer exposes the expected CSS/JS tags")
    return html


components.html(build_document(), height=1060, scrolling=True)
