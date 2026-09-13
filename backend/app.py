from flask import Flask, jsonify
from flask_cors import CORS


def create_app(config=None):
    app = Flask(__name__)
    CORS(app)

    if config:
        app.config.update(config)

    @app.route("/api/health")
    def health():
        return jsonify(status="ok")

    @app.route("/api/ping")
    def ping():
        return jsonify(message="pong")

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=5000)
