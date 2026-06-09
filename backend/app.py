import os
from flask import Flask, jsonify, send_from_directory
from config import Config
from models import init_db
from auth import auth_bp
from api import api_bp


def create_app():
    app = Flask(__name__,
                static_folder=None,       # Nginx serves static files in production
                static_url_path=None)
    app.config.from_object(Config)

    # Initialize database
    init_db(app.config["DATABASE"])

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    # Health check
    @app.route("/api/health")
    def health():
        return jsonify({"status": "ok"})

    # In development, serve static files from the project root
    STATIC_DIR = os.path.join(os.path.dirname(__file__), "..")

    @app.route("/")
    def index():
        return send_from_directory(STATIC_DIR, "scheduler.html")

    @app.route("/<path:filename>")
    def static_files(filename):
        if filename.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        return send_from_directory(STATIC_DIR, filename)

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
