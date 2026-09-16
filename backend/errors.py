"""Every non-2xx reply from the API, in one place.

The contract the front end relies on (docs/design/frontend.md §6): any error
reply, whether our code raised it or Flask did, is `{"message": "<sentence>"}`
with the matching status. Nothing else is ever in an error body.
"""

from flask import jsonify
from werkzeug.exceptions import HTTPException


class ApiRefusal(Exception):
    """The API says no.

    A service raises this next to the rule it is enforcing and never builds a
    response itself: `raise ApiRefusal(403, "Only the assigned coordinator may
    edit this event.")`.
    """

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def register_error_handlers(app):
    @app.errorhandler(ApiRefusal)
    def handle_api_refusal(error):
        return jsonify(message=error.message), error.status

    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        # 404, 405, 415 and the rest that Flask raises before our code runs.
        return jsonify(message=error.description), error.code

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        # A test must see the real exception, not a tidy 500.
        if app.config.get("TESTING"):
            raise error
        # The traceback goes to the log; the client is told nothing about it.
        app.logger.exception("Unhandled error")
        return jsonify(message="Something went wrong"), 500
