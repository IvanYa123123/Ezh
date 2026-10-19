"""Корневые эндпоинты: /, /api/health, /api/groups, /api/groups/custom."""
from flask import Blueprint, jsonify, render_template, request

from . import runtime
from .common import validate_group, load_local_groups, load_custom_groups, save_custom_groups
from .extensions import limiter


bp = Blueprint('core', __name__)


@bp.route("/")
def index():
    return render_template("index.html")


@bp.route("/api/health")
def health():
    return jsonify({"ok": True, "version": runtime.APP_VERSION})


@bp.route("/api/groups")
def get_groups():
    local_groups = load_local_groups()
    if local_groups:
        resp = jsonify(local_groups)
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp

    try:
        params = {"v": "6.2", "section": "0"}
        r = runtime.planner.session.get(runtime.planner.groups_api, params=params, timeout=5)
        if r.status_code == 200:
            try:
                resp = jsonify(r.json())
                resp.headers['Cache-Control'] = 'public, max-age=3600'
                return resp
            except ValueError:
                pass
    except Exception:
        pass
    return jsonify([])


@bp.route("/api/groups/custom", methods=["POST"])
@limiter.limit("30 per minute")
def add_custom_group():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"success": False, "error": "empty name"}), 400
    try:
        name = validate_group(name)
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    existing = load_local_groups()
    if any(g.lower() == name.lower() for g in existing):
        return jsonify({"success": True, "already": True})

    custom = load_custom_groups()
    if not any(g.lower() == name.lower() for g in custom):
        custom.append(name)
        save_custom_groups(custom)

    return jsonify({"success": True})