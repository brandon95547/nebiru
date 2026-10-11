"""Reading the text of a photographed or scanned page.

The page image is normalised (any format Pillow can open, iPhone HEIC
included), handed to the writing model, and its transcript is turned into the
same shape every other import produces: a title and a list of paragraphs.
Structure survives as light markup inside those paragraphs, which the app
understands when it builds a page:

    ## A section heading
    1. A numbered entry          (the page's own numbers are kept)
    - A bulleted entry
    A paragraph. Lines that matter, as in verse, stay on separate lines.
"""

from __future__ import annotations

import base64
import io

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .deepseek import DeepSeek
from .errors import ServiceError
from .markup import parse_marked_text

register_heif_opener()

# Large enough to keep small print legible, small enough to send quickly.
MAX_SIDE = 2000
JPEG_QUALITY = 88
MAX_UPLOAD_BYTES = 40 * 1024 * 1024

NO_TEXT = "NO_TEXT"
NO_IMAGE = "NO_IMAGE"

PROMPT = f"""This is a photo or scan of a page from a book. Transcribe its text so the page can be typeset again in a new design. What you return is parsed by a program, so use exactly this plain format and add nothing else:

- The page's main title, if it has one, on a line starting with "# ".
- Each section heading on a line starting with "## ".
- Each numbered entry on its own line as "1. text", keeping the page's own numbers.
- Each bulleted entry on its own line as "- text".
- Ordinary paragraphs as plain text, with a blank line between paragraphs.

Where the page broke a line only because it ran out of width, join the pieces back into one line. Where the line breaks are part of the writing, as in verse, an incantation or an address, keep each line on its own line. Read a page with columns one column at a time, top to bottom, and keep each heading with the entries under it.

Keep the wording and spelling as printed; do not correct, summarise or translate. Leave out page numbers, running headers and handwriting in the margins, and do not describe pictures or decoration.

If the page has no readable text, reply with exactly {NO_TEXT}. If you were not given an image you can see, reply with exactly {NO_IMAGE}."""



def prepare_image(data: bytes) -> bytes:
    """Any supported image as an upright JPEG of a sensible size."""
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image)
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        if image.mode in ("RGBA", "LA", "P"):
            # Transparent areas become white paper rather than black.
            rgba = image.convert("RGBA")
            flat = Image.new("RGB", rgba.size, "white")
            flat.paste(rgba, mask=rgba.getchannel("A"))
            image = flat
        else:
            image = image.convert("RGB")
        out = io.BytesIO()
        image.save(out, "JPEG", quality=JPEG_QUALITY)
        return out.getvalue()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ServiceError("That file is not an image Nebiru can open.", status=400) from None


async def read_page(deepseek: DeepSeek, data: bytes) -> tuple[str | None, list[str]]:
    """The title and paragraphs of one page image."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ServiceError("That image is too large (the limit is 40 MB).", status=413)
    encoded = base64.b64encode(prepare_image(data)).decode("ascii")
    answer = await deepseek.text(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}},
                ],
            }
        ],
        max_tokens=6000,
        temperature=0.0,
        vision=True,
    )
    reply = answer.strip()
    if reply == NO_IMAGE:
        raise ServiceError(
            "The writing model did not look at the image. Set DEEPSEEK_VISION_MODEL to a model that reads images."
        )
    if reply == NO_TEXT:
        raise ServiceError("No readable text was found in this image.", status=422)
    title, paragraphs = parse_marked_text(reply, take_title=True)
    if title is None and not paragraphs:
        raise ServiceError("No readable text was found in this image.", status=422)
    return title, paragraphs
