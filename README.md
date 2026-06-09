# Resource Planner

## Running the app

### Development (Flask dev server)

```bash
cd resource-planner
python -m venv .venv && source .venv/bin/activate
pip install flask gunicorn

python -c "
import sys; sys.path.insert(0, 'backend')
from backend.app import create_app
create_app().run(host='0.0.0.0', port=5000, debug=True)
"
# Open http://localhost:5000
```

Flask serves both the API and static files in dev mode.

### Production (Docker)

```bash
docker-compose up --build
# Open http://localhost:8080
```

Nginx serves static files and reverse-proxies `/api/` to the Flask backend (gunicorn). SQLite data persists in `./data/`.

Set `SECRET_KEY` via environment or `.env`:

```bash
echo 'SECRET_KEY=secret-key' > .env
docker-compose up --build
```

---

## API Reference

All endpoints use JSON. Authenticated endpoints require a session cookie that are set on login/register.

### Authentication

| Method | Endpoint | Body | Response | Auth |
|--------|----------|------|----------|------|
| `POST` | `/api/auth/register` | `{ username, password }` | `{ user: { id, username } }` | No |
| `POST` | `/api/auth/login` | `{ username, password }` | `{ user: { id, username } }` | No |
| `POST` | `/api/auth/logout` | — | `{ success: true }` | No |
| `GET` | `/api/auth/me` | — | `{ user: { id, username } }` | Yes |

**Password rules**: username >= 2 chars, password >= 4 chars. Returns `401` on bad credentials, `409` on duplicate username.

### Datasets

A dataset contains all data for one schedule (periods, roles, tasks).

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `GET` | `/api/datasets` | — | `{ datasets: [{ id, name, permission, ... }] }` |
| `POST` | `/api/datasets` | `{ name }` | `{ dataset: { id, name } }` |
| `DELETE` | `/api/datasets/:id` | — | `{ success: true }` |

All require authentication. Only the dataset admin can delete.

### Full Data Blob

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `GET` | `/api/datasets/:id/data` | — | `{ periods, roles, tasks }` |
| `PUT` | `/api/datasets/:id/data` | full data blob | `{ success: true }` |

`GET` requires `read` permission. `PUT` requires `write`.

The data blob matches the JSON export format:

```json
{
  "periods": ["2025", "2026"],
  "roles": {
    "role-id": { "type": "person", "name": "...", "target": { "2025": 850 }, ... }
  },
  "tasks": {
    "1": { "roles": { "person": "role-id", "course": "role-other" }, "period": "2025", "value": 340 }
  }
}
```

### Periods

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/datasets/:id/periods` | `{ name }` | `{ success: true }` |
| `PUT` | `/api/datasets/:id/periods` | `{ periods: [...] }` | `{ success: true }` |
| `DELETE` | `/api/datasets/:id/periods/:name` | — | `{ success: true }` |
| `PUT` | `/api/datasets/:id/rename-period` | `{ oldName, newName }` | `{ success: true }` |

All require `write` permission. The rename endpoint updates all role targets and task periods.

### Roles

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `PUT` | `/api/datasets/:id/roles/:roleId` | role object | `{ success: true }` |
| `DELETE` | `/api/datasets/:id/roles/:roleId` | — | `{ success: true }` |

`PUT` upserts (creates or updates). Both require `write`.

### Tasks

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/datasets/:id/tasks` | task object | `{ id: <newId> }` |
| `PUT` | `/api/datasets/:id/tasks/:taskId` | task object | `{ success: true }` |
| `DELETE` | `/api/datasets/:id/tasks/:taskId` | — | `{ success: true }` |

All require `write`. Task IDs are auto-generated integers.

### Sharing

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `GET` | `/api/datasets/:id/users` | — | `{ users: [{ id, username, permission }] }` |
| `POST` | `/api/datasets/:id/share` | `{ username, permission }` | `{ success: true }` |
| `DELETE` | `/api/datasets/:id/users/:userId` | — | `{ success: true }` |

Permissions: `read` (view only), `write` (edit data), `admin` (edit + share/delete dataset).  
Only admins can share or remove users. The last admin cannot be removed.

### Misc

| Method | Endpoint | Response |
|--------|----------|----------|
| `GET` | `/api/health` | `{ status: "ok" }` |
