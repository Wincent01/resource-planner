import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me-in-production")
    DATABASE = os.environ.get("DATABASE", os.path.join(os.path.dirname(__file__), "..", "data", "scheduler.db"))
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_PERMANENT = False
