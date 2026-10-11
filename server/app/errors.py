"""Errors that are reported to the app with a message the user can act on."""

from __future__ import annotations


class ServiceError(Exception):
    """A model provider could not do what was asked.

    These are never swallowed or replaced with stand-in output: a failed
    request surfaces in the app as a failure, with this message.
    """

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class NotConfigured(ServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status=503)
