from flask import Blueprint, request, jsonify
from auth import login_required, get_current_user
from models import (
    get_user_datasets, create_dataset, delete_dataset,
    get_dataset_data, set_dataset_data,
    get_user_permission,
    get_dataset_users, add_dataset_user, remove_dataset_user,
    get_user_by_username,
)

api_bp = Blueprint("api", __name__)


# Helpers

def _check_access(dataset_id, require="read"):
    """Check that current user has at least 'require' permission on dataset.
    Returns (data_dict | error_tuple)."""
    user = get_current_user()
    if not user:
        return None, (jsonify({"error": "Not authenticated"}), 401)

    perm = get_user_permission(dataset_id, user["id"])
    if perm is None:
        return None, (jsonify({"error": "Dataset not found or access denied"}), 404)

    levels = {"read": 0, "write": 1, "admin": 2}
    if levels.get(perm, -1) < levels.get(require, 0):
        return None, (jsonify({"error": "Insufficient permissions"}), 403)

    return user, None


def _read_data(dataset_id):
    """Read dataset data blob, updating dataset timestamp."""
    data = get_dataset_data(dataset_id)
    return data


def _write_data(dataset_id, data):
    """Write dataset data blob."""
    set_dataset_data(dataset_id, data)


# Dataset management

@api_bp.route("/api/datasets", methods=["GET"])
@login_required
def list_datasets():
    user = get_current_user()
    datasets = get_user_datasets(user["id"])
    return jsonify({"datasets": datasets})


@api_bp.route("/api/datasets", methods=["POST"])
@login_required
def new_dataset():
    user = get_current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Dataset name is required"}), 400

    dataset_id = create_dataset(name, user["id"])
    return jsonify({"dataset": {"id": dataset_id, "name": name}}), 201


@api_bp.route("/api/datasets/<int:dataset_id>", methods=["DELETE"])
@login_required
def remove_dataset(dataset_id):
    user = get_current_user()
    if not delete_dataset(dataset_id, user["id"]):
        return jsonify({"error": "Cannot delete dataset (not owner or not found)"}), 403
    return jsonify({"success": True})


# Sharing

@api_bp.route("/api/datasets/<int:dataset_id>/users", methods=["GET"])
@login_required
def list_dataset_users(dataset_id):
    result = _check_access(dataset_id, "read")
    if result[1] is not None:
        return result[1]
    users = get_dataset_users(dataset_id)
    return jsonify({"users": users})


@api_bp.route("/api/datasets/<int:dataset_id>/share", methods=["POST"])
@login_required
def share_dataset(dataset_id):
    result = _check_access(dataset_id, "admin")
    if result[1] is not None:
        return result[1]

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    permission = data.get("permission", "write")
    if permission not in ("read", "write", "admin"):
        return jsonify({"error": "Invalid permission"}), 400

    target = get_user_by_username(username)
    if not target:
        return jsonify({"error": "User not found"}), 404

    if not add_dataset_user(dataset_id, target["id"], permission):
        return jsonify({"error": "Failed to share dataset"}), 500
    return jsonify({"success": True})


@api_bp.route("/api/datasets/<int:dataset_id>/users/<int:user_id>", methods=["DELETE"])
@login_required
def unshare_dataset(dataset_id, user_id):
    result = _check_access(dataset_id, "admin")
    if result[1] is not None:
        return result[1]

    if not remove_dataset_user(dataset_id, user_id):
        return jsonify({"error": "Cannot remove user (last admin or not found)"}), 400
    return jsonify({"success": True})


# Full data blob  

@api_bp.route("/api/datasets/<int:dataset_id>/data", methods=["GET"])
@login_required
def get_data(dataset_id):
    result = _check_access(dataset_id, "read")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    return jsonify(data)


@api_bp.route("/api/datasets/<int:dataset_id>/data", methods=["PUT"])
@login_required
def replace_data(dataset_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    new_data = request.get_json(silent=True) or {}
    _write_data(dataset_id, new_data)
    return jsonify({"success": True})


# Periods

@api_bp.route("/api/datasets/<int:dataset_id>/periods", methods=["POST"])
@login_required
def add_period(dataset_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    period = request.get_json(silent=True).get("name", "")
    if not period:
        return jsonify({"error": "Period name is required"}), 400
    if period not in data["periods"]:
        data["periods"].insert(0, period)
    _write_data(dataset_id, data)
    return jsonify({"success": True})


@api_bp.route("/api/datasets/<int:dataset_id>/periods", methods=["PUT"])
@login_required
def set_periods(dataset_id):
    """Replace entire periods array."""
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    periods = request.get_json(silent=True).get("periods", [])
    data["periods"] = periods
    _write_data(dataset_id, data)
    return jsonify({"success": True})


@api_bp.route("/api/datasets/<int:dataset_id>/periods/<string:period>", methods=["DELETE"])
@login_required
def delete_period(dataset_id, period):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    if period in data["periods"]:
        data["periods"].remove(period)
    _write_data(dataset_id, data)
    return jsonify({"success": True})


@api_bp.route("/api/datasets/<int:dataset_id>/rename-period", methods=["PUT"])
@login_required
def rename_period(dataset_id):
    """Rename a period across roles, tasks, and the periods array."""
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    body = request.get_json(silent=True) or {}
    old_name = body.get("oldName", "")
    new_name = body.get("newName", "")
    if not old_name or not new_name:
        return jsonify({"error": "oldName and newName required"}), 400

    data = _read_data(dataset_id)

    # Rename in periods array
    periods = data.get("periods", [])
    if old_name in periods:
        periods[periods.index(old_name)] = new_name

    # Rename in role targets
    for role_id, role in data.get("roles", {}).items():
        if "target" in role and old_name in role["target"]:
            role["target"][new_name] = role["target"].pop(old_name)

    # Rename in tasks
    for task_id, task in data.get("tasks", {}).items():
        if task.get("period") == old_name:
            task["period"] = new_name

    _write_data(dataset_id, data)
    return jsonify({"success": True})


# Roles

@api_bp.route("/api/datasets/<int:dataset_id>/roles/<string:role_id>", methods=["PUT"])
@login_required
def upsert_role(dataset_id, role_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    role = request.get_json(silent=True) or {}
    data.setdefault("roles", {})[role_id] = role
    _write_data(dataset_id, data)
    return jsonify({"success": True})


@api_bp.route("/api/datasets/<int:dataset_id>/roles/<string:role_id>", methods=["DELETE"])
@login_required
def delete_role(dataset_id, role_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    data.setdefault("roles", {}).pop(role_id, None)
    _write_data(dataset_id, data)
    return jsonify({"success": True})


# Tasks

@api_bp.route("/api/datasets/<int:dataset_id>/tasks", methods=["POST"])
@login_required
def create_task(dataset_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    task = request.get_json(silent=True) or {}

    # Auto-generate task ID (max existing + 1, start at 1)
    existing_ids = [int(k) for k in data.get("tasks", {}).keys()]
    new_id = max(existing_ids) + 1 if existing_ids else 1
    data.setdefault("tasks", {})[str(new_id)] = task
    _write_data(dataset_id, data)
    return jsonify({"id": new_id}), 201


@api_bp.route("/api/datasets/<int:dataset_id>/tasks/<int:task_id>", methods=["PUT"])
@login_required
def update_task(dataset_id, task_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    task = request.get_json(silent=True) or {}
    if str(task_id) not in data.get("tasks", {}):
        return jsonify({"error": "Task not found"}), 404
    data["tasks"][str(task_id)] = task
    _write_data(dataset_id, data)
    return jsonify({"success": True})


@api_bp.route("/api/datasets/<int:dataset_id>/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(dataset_id, task_id):
    result = _check_access(dataset_id, "write")
    if result[1] is not None:
        return result[1]
    data = _read_data(dataset_id)
    data.setdefault("tasks", {}).pop(str(task_id), None)
    _write_data(dataset_id, data)
    return jsonify({"success": True})
