"""Book projects, stored as one JSON file each.

The server keeps books as opaque documents: their shape belongs to the app.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from .errors import ServiceError

BOOK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class Library:
    def __init__(self, folder: Path) -> None:
        self._folder = folder
        folder.mkdir(parents=True, exist_ok=True)

    def _path(self, book_id: str) -> Path:
        # Ids become file names, so anything that could step outside the folder is refused.
        if not BOOK_ID.match(book_id):
            raise ServiceError("That is not a valid book id.", status=400)
        return self._folder / f"{book_id}.json"

    def all(self) -> list[dict[str, Any]]:
        books = []
        for path in sorted(self._folder.glob("*.json")):
            try:
                book = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                # One damaged file must not hide every other book.
                continue
            if isinstance(book, dict):
                books.append(book)
        return books

    def save(self, book_id: str, book: dict[str, Any]) -> None:
        path = self._path(book_id)
        if book.get("id") != book_id:
            raise ServiceError("The book's id does not match its address.", status=400)
        # Write beside the target and swap it in, so a crash never leaves half a book.
        handle, temporary = tempfile.mkstemp(dir=self._folder, prefix=f".{book_id}.", suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as file:
                json.dump(book, file, ensure_ascii=False, separators=(",", ":"))
            os.replace(temporary, path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def delete(self, book_id: str) -> None:
        self._path(book_id).unlink(missing_ok=True)
