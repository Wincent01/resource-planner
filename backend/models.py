import sqlite3
import json
import os
from contextlib import contextmanager

DB_PATH = None


def init_db(db_path):
    """Initialize the database, creating tables if they do not exist."""
    global DB_PATH
    DB_PATH = db_path
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS datasets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                data TEXT NOT NULL DEFAULT '{"periods":[],"roles":{},"tasks":{}}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS dataset_users (
                dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                permission TEXT NOT NULL DEFAULT 'write'
                    CHECK(permission IN ('read','write','admin')),
                PRIMARY KEY (dataset_id, user_id)
            );
        """)
        conn.commit()


@contextmanager
def _get_conn():
    """Get a database connection, ensuring row_factory is set."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


# User helpers

def get_user_by_username(username):
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id):
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def create_user(username, password_hash):
    with _get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
            conn.commit()
            return conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        except sqlite3.IntegrityError:
            return None  # username already exists


# Dataset helpers

def get_user_datasets(user_id):
    """Return list of {id, name, permission, created_at, updated_at} for user."""
    with _get_conn() as conn:
        rows = conn.execute("""
            SELECT d.id, d.name, d.created_at, d.updated_at, du.permission
            FROM datasets d
            JOIN dataset_users du ON du.dataset_id = d.id
            WHERE du.user_id = ?
            ORDER BY d.updated_at DESC
        """, (user_id,)).fetchall()
    return [dict(r) for r in rows]


def create_dataset(name, user_id):
    """Create a dataset and make the user its admin owner. Returns dataset id."""
    with _get_conn() as conn:
        conn.execute("INSERT INTO datasets (name) VALUES (?)", (name,))
        dataset_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO dataset_users (dataset_id, user_id, permission) VALUES (?, ?, 'admin')",
            (dataset_id, user_id),
        )
        conn.commit()
        return dataset_id


def delete_dataset(dataset_id, user_id):
    """Delete a dataset (only admin/owner). Returns True on success."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT permission FROM dataset_users WHERE dataset_id = ? AND user_id = ?",
            (dataset_id, user_id),
        ).fetchone()
        if not row or row["permission"] != "admin":
            return False
        conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        conn.commit()
        return True


def get_user_permission(dataset_id, user_id):
    """Return permission string or None."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT permission FROM dataset_users WHERE dataset_id = ? AND user_id = ?",
            (dataset_id, user_id),
        ).fetchone()
        return row["permission"] if row else None


def get_dataset_data(dataset_id):
    with _get_conn() as conn:
        row = conn.execute("SELECT data FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
        return json.loads(row["data"]) if row else None


def set_dataset_data(dataset_id, data):
    with _get_conn() as conn:
        conn.execute(
            "UPDATE datasets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(data), dataset_id),
        )
        conn.commit()


def get_dataset_users(dataset_id):
    with _get_conn() as conn:
        rows = conn.execute("""
            SELECT u.id, u.username, du.permission
            FROM dataset_users du
            JOIN users u ON u.id = du.user_id
            WHERE du.dataset_id = ?
            ORDER BY u.username
        """, (dataset_id,)).fetchall()
    return [dict(r) for r in rows]


def add_dataset_user(dataset_id, target_user_id, permission):
    with _get_conn() as conn:
        try:
            conn.execute(
                "INSERT OR REPLACE INTO dataset_users (dataset_id, user_id, permission) VALUES (?, ?, ?)",
                (dataset_id, target_user_id, permission),
            )
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False


def remove_dataset_user(dataset_id, target_user_id):
    with _get_conn() as conn:
        # Prevent removing the last admin
        row = conn.execute(
            "SELECT permission FROM dataset_users WHERE dataset_id = ? AND user_id = ?",
            (dataset_id, target_user_id),
        ).fetchone()
        if not row:
            return False
        if row["permission"] == "admin":
            admin_count = conn.execute(
                "SELECT COUNT(*) FROM dataset_users WHERE dataset_id = ? AND permission = 'admin'",
                (dataset_id,),
            ).fetchone()[0]
            if admin_count <= 1:
                return False  # cannot remove last admin
        conn.execute(
            "DELETE FROM dataset_users WHERE dataset_id = ? AND user_id = ?",
            (dataset_id, target_user_id),
        )
        conn.commit()
        return True
