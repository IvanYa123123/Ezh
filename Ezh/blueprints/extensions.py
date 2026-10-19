"""Общие расширения Flask — вынесены отдельно, чтобы не было
циклических импортов между app.py и blueprints/*."""
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["120 per minute"],
    storage_uri="memory://",
    strategy="fixed-window",
)