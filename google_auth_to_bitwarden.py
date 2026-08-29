#!/usr/bin/env python3
"""
Convert Google Authenticator export QR codes into Bitwarden JSON.

Accepted inputs:
  - QR-code image files: PNG, JPG, WEBP, etc.
  - Text files containing otpauth-migration:// URIs
  - Literal otpauth-migration:// URIs

Output:
  - Bitwarden-compatible JSON containing TOTP login items

Image decoding requires:
    pip install opencv-python-headless

No protobuf compiler or protobuf Python package is required.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlencode, urlsplit


__version__ = "1.0.0"


MIGRATION_URI_RE = re.compile(
    r"""otpauth-migration://[^\s"'<>]+""",
    re.IGNORECASE,
)

ALGORITHMS = {
    0: "SHA1",      # Unspecified: Google Authenticator defaults to SHA1
    1: "SHA1",
    2: "SHA256",
    3: "SHA512",
    4: "MD5",
}

DIGITS = {
    0: 6,           # Unspecified
    1: 6,
    2: 8,
}

OTP_TYPES = {
    0: "UNSPECIFIED",
    1: "HOTP",
    2: "TOTP",
}


class MigrationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Minimal Protocol Buffers decoder
# ---------------------------------------------------------------------------

def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0

    while True:
        if offset >= len(data):
            raise MigrationError("Unexpected end of protobuf varint")

        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift

        if not byte & 0x80:
            return value, offset

        shift += 7
        if shift > 70:
            raise MigrationError("Invalid protobuf varint")


def protobuf_fields(data: bytes):
    """
    Yield (field_number, wire_type, value) tuples.

    Supported protobuf wire types:
      0: varint
      1: 64-bit
      2: length-delimited
      5: 32-bit
    """
    offset = 0

    while offset < len(data):
        key, offset = read_varint(data, offset)
        field_number = key >> 3
        wire_type = key & 0x07

        if field_number == 0:
            raise MigrationError("Invalid protobuf field number 0")

        if wire_type == 0:
            value, offset = read_varint(data, offset)

        elif wire_type == 1:
            end = offset + 8
            if end > len(data):
                raise MigrationError("Truncated protobuf 64-bit field")
            value = data[offset:end]
            offset = end

        elif wire_type == 2:
            length, offset = read_varint(data, offset)
            end = offset + length
            if end > len(data):
                raise MigrationError("Truncated protobuf field")
            value = data[offset:end]
            offset = end

        elif wire_type == 5:
            end = offset + 4
            if end > len(data):
                raise MigrationError("Truncated protobuf 32-bit field")
            value = data[offset:end]
            offset = end

        else:
            raise MigrationError(
                f"Unsupported protobuf wire type {wire_type}"
            )

        yield field_number, wire_type, value


def decode_text(value: bytes) -> str:
    return value.decode("utf-8", errors="replace").strip()


def parse_otp_parameters(data: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "secret": b"",
        "name": "",
        "issuer": "",
        "algorithm": 0,
        "digits": 0,
        "type": 0,
        "counter": 0,
    }

    for field, wire_type, value in protobuf_fields(data):
        if field == 1 and wire_type == 2:
            result["secret"] = value
        elif field == 2 and wire_type == 2:
            result["name"] = decode_text(value)
        elif field == 3 and wire_type == 2:
            result["issuer"] = decode_text(value)
        elif field == 4 and wire_type == 0:
            result["algorithm"] = value
        elif field == 5 and wire_type == 0:
            result["digits"] = value
        elif field == 6 and wire_type == 0:
            result["type"] = value
        elif field == 7 and wire_type == 0:
            result["counter"] = value

    if not result["secret"]:
        raise MigrationError("Authenticator entry has no secret")

    return result


def parse_migration_payload(data: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "entries": [],
        "version": 0,
        "batch_size": 1,
        "batch_index": 0,
        "batch_id": 0,
    }

    for field, wire_type, value in protobuf_fields(data):
        if field == 1 and wire_type == 2:
            result["entries"].append(parse_otp_parameters(value))
        elif field == 2 and wire_type == 0:
            result["version"] = value
        elif field == 3 and wire_type == 0:
            result["batch_size"] = value
        elif field == 4 and wire_type == 0:
            result["batch_index"] = value
        elif field == 5 and wire_type == 0:
            result["batch_id"] = value

    if not result["entries"]:
        raise MigrationError("Migration payload contains no OTP entries")

    # Older/single-code payloads may leave this unspecified.
    if result["batch_size"] <= 0:
        result["batch_size"] = 1

    return result


# ---------------------------------------------------------------------------
# URI and QR handling
# ---------------------------------------------------------------------------

def extract_query_parameter(uri: str, parameter: str) -> str:
    """
    Extract a query parameter without converting '+' characters to spaces.

    Base64 data can contain '+', so urllib.parse.parse_qs() is deliberately
    avoided here.
    """
    query = urlsplit(uri).query

    for component in query.split("&"):
        key, separator, value = component.partition("=")
        if separator and unquote(key) == parameter:
            return unquote(value)

    raise MigrationError(f"URI does not contain a {parameter!r} parameter")


def decode_migration_uri(uri: str) -> dict[str, Any]:
    uri = uri.strip()
    parsed = urlsplit(uri)

    if parsed.scheme.lower() != "otpauth-migration":
        raise MigrationError("Not an otpauth-migration URI")

    encoded = extract_query_parameter(uri, "data")
    encoded = encoded.strip()

    # Restore omitted Base64 padding.
    encoded += "=" * (-len(encoded) % 4)

    try:
        payload = base64.b64decode(encoded, validate=False)
    except Exception as exc:
        raise MigrationError(f"Invalid Base64 migration payload: {exc}") from exc

    return parse_migration_payload(payload)


def decode_qr_image(path: Path) -> list[str]:
    try:
        import cv2
    except ImportError as exc:
        raise MigrationError(
            "QR image decoding requires OpenCV. Install it with:\n"
            "  python -m pip install opencv-python-headless"
        ) from exc

    image = cv2.imread(str(path))
    if image is None:
        raise MigrationError(f"Could not read image: {path}")

    detector = cv2.QRCodeDetector()
    decoded: list[str] = []

    def add_decoded(values) -> None:
        for value in values:
            value = value.strip() if value else ""
            if value and value not in decoded:
                decoded.append(value)

    # Keep the fast path for ordinary images and images containing more than
    # one QR code.
    try:
        success, decoded_info, _points, _straight = (
            detector.detectAndDecodeMulti(image)
        )
        if success:
            add_decoded(decoded_info)
    except (AttributeError, ValueError, cv2.error):
        pass

    if not decoded:
        try:
            value, _points, _straight = detector.detectAndDecode(image)
            add_decoded([value])
        except cv2.error:
            pass

    # Dense Google Authenticator export codes in phone screenshots are often
    # detected by OpenCV but not decoded. Locate square, light regions (the QR
    # canvas), crop them, add a quiet zone, and retry at larger resolutions.
    # An expanded crop is also retained because adaptive thresholding benefits
    # from seeing the original edge around some JPEG-compressed screenshots.
    if not decoded:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        binary_images = [
            cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)[1]
            for threshold in (128, 180, 220)
        ]
        binary_images.append(
            cv2.threshold(
                gray,
                0,
                255,
                cv2.THRESH_BINARY + cv2.THRESH_OTSU,
            )[1]
        )

        height, width = gray.shape
        rectangles: set[tuple[int, int, int, int]] = set()

        for binary in binary_images:
            contours, _hierarchy = cv2.findContours(
                binary,
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )

            for contour in contours:
                x, y, box_width, box_height = cv2.boundingRect(contour)
                shortest = min(box_width, box_height)
                aspect_ratio = box_width / box_height

                if (
                    shortest >= 80
                    and 0.75 <= aspect_ratio <= 1.25
                    and box_width < width * 0.98
                    and box_height < height * 0.98
                ):
                    rectangles.add((x, y, box_width, box_height))

        # Prefer the largest likely QR canvases and limit work on noisy images.
        likely_qr_rectangles = sorted(
            rectangles,
            key=lambda rectangle: rectangle[2] * rectangle[3],
            reverse=True,
        )[:8]

        for x, y, box_width, box_height in likely_qr_rectangles:
            margin = max(12, round(max(box_width, box_height) * 0.05))
            exact_crop = image[y:y + box_height, x:x + box_width]
            quiet_crop = cv2.copyMakeBorder(
                exact_crop,
                margin,
                margin,
                margin,
                margin,
                cv2.BORDER_CONSTANT,
                value=(255, 255, 255),
            )
            expanded_crop = image[
                max(0, y - margin):min(height, y + box_height + margin),
                max(0, x - margin):min(width, x + box_width + margin),
            ]

            for crop in (quiet_crop, expanded_crop):
                for scale in (2, 3, 4):
                    enlarged = cv2.resize(
                        crop,
                        None,
                        fx=scale,
                        fy=scale,
                        interpolation=cv2.INTER_NEAREST,
                    )
                    enlarged_gray = cv2.cvtColor(
                        enlarged,
                        cv2.COLOR_BGR2GRAY,
                    )
                    variants = (
                        enlarged,
                        cv2.threshold(
                            enlarged_gray,
                            0,
                            255,
                            cv2.THRESH_BINARY + cv2.THRESH_OTSU,
                        )[1],
                        cv2.adaptiveThreshold(
                            enlarged_gray,
                            255,
                            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                            cv2.THRESH_BINARY,
                            31,
                            5,
                        ),
                    )

                    for variant in variants:
                        try:
                            value, _points, _straight = (
                                detector.detectAndDecode(variant)
                            )
                            add_decoded([value])
                        except cv2.error:
                            continue

                        if decoded:
                            return decoded

    if not decoded:
        raise MigrationError(
            f"No readable QR code found in {path}. "
            "Try using the original screenshot or a lossless PNG."
        )

    return decoded


def extract_uris_from_input(value: str) -> list[str]:
    if value.lower().startswith("otpauth-migration://"):
        return [value.strip()]

    path = Path(value).expanduser()

    if not path.exists():
        raise MigrationError(f"Input does not exist: {value}")

    if not path.is_file():
        raise MigrationError(f"Input is not a file: {value}")

    # First check whether it is a text file containing migration URIs.
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="ignore")
    matches = MIGRATION_URI_RE.findall(text)

    if matches:
        return [match.strip() for match in matches]

    # Otherwise treat it as an image.
    return decode_qr_image(path)


# ---------------------------------------------------------------------------
# Conversion to otpauth:// and Bitwarden JSON
# ---------------------------------------------------------------------------

def split_account_name(name: str, issuer: str) -> tuple[str, str]:
    name = name.strip()
    issuer = issuer.strip()

    if issuer:
        prefix = issuer + ":"
        if name.casefold().startswith(prefix.casefold()):
            account = name[len(prefix):].strip()
        else:
            account = name
        return issuer, account or name or issuer

    # Google exports sometimes put "Issuer:account" entirely in the name.
    if ":" in name:
        inferred_issuer, account = name.split(":", 1)
        inferred_issuer = inferred_issuer.strip()
        account = account.strip()

        if inferred_issuer and account:
            return inferred_issuer, account

    return "", name or "Unknown account"


def base32_secret(secret: bytes) -> str:
    return base64.b32encode(secret).decode("ascii").rstrip("=")


def make_otpauth_uri(entry: dict[str, Any]) -> tuple[str, str, str]:
    otp_type = OTP_TYPES.get(entry["type"], "UNKNOWN")
    algorithm = ALGORITHMS.get(entry["algorithm"])
    digits = DIGITS.get(entry["digits"])

    if otp_type != "TOTP":
        raise MigrationError(
            f"{entry['name'] or 'Unnamed entry'} uses {otp_type}, not TOTP"
        )

    if algorithm not in {"SHA1", "SHA256", "SHA512"}:
        raise MigrationError(
            f"{entry['name'] or 'Unnamed entry'} uses unsupported "
            f"algorithm {algorithm or entry['algorithm']}"
        )

    if digits not in {6, 8}:
        raise MigrationError(
            f"{entry['name'] or 'Unnamed entry'} uses unsupported "
            f"digit count {entry['digits']}"
        )

    issuer, account = split_account_name(
        entry["name"],
        entry["issuer"],
    )

    label = f"{issuer}:{account}" if issuer else account

    parameters = {
        "secret": base32_secret(entry["secret"]),
        "algorithm": algorithm,
        "digits": str(digits),
        "period": "30",
    }

    if issuer:
        parameters["issuer"] = issuer

    query = urlencode(parameters, quote_via=quote)
    uri = f"otpauth://totp/{quote(label, safe=':')}?{query}"

    display_name = issuer or account or "Authenticator item"
    return uri, display_name, account


def assemble_batches(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Group migration payloads by batch ID and make sure every QR part exists.
    """
    batches: OrderedDict[int, dict[str, Any]] = OrderedDict()

    for payload in payloads:
        batch_id = payload["batch_id"]
        batch_size = payload["batch_size"]
        batch_index = payload["batch_index"]

        batch = batches.setdefault(
            batch_id,
            {
                "size": batch_size,
                "parts": {},
            },
        )

        if batch["size"] != batch_size:
            raise MigrationError(
                f"Inconsistent batch size for batch ID {batch_id}"
            )

        existing = batch["parts"].get(batch_index)
        if existing is not None:
            # Duplicate QR input: ignore it if it contains the same data.
            if existing != payload["entries"]:
                raise MigrationError(
                    f"Conflicting QR codes for batch {batch_id}, "
                    f"index {batch_index}"
                )
            continue

        batch["parts"][batch_index] = payload["entries"]

    entries: list[dict[str, Any]] = []

    for batch_id, batch in batches.items():
        expected = set(range(batch["size"]))
        received = set(batch["parts"])
        missing = sorted(expected - received)

        if missing:
            readable = ", ".join(str(index + 1) for index in missing)
            raise MigrationError(
                f"Batch {batch_id} is incomplete. Missing QR part(s): "
                f"{readable} of {batch['size']}"
            )

        for index in sorted(batch["parts"]):
            entries.extend(batch["parts"][index])

    return entries


def build_bitwarden_json(
    entries: list[dict[str, Any]],
    skip_unsupported: bool,
) -> tuple[dict[str, Any], list[str]]:
    items = []
    skipped = []

    for entry in entries:
        try:
            totp_uri, display_name, username = make_otpauth_uri(entry)
        except MigrationError as exc:
            if skip_unsupported:
                skipped.append(str(exc))
                continue
            raise

        items.append(
            {
                "favorite": False,
                "id": str(uuid.uuid4()).upper(),
                "login": {
                    "totp": totp_uri,
                    "username": username,
                },
                "name": display_name,
                "type": 1,
            }
        )

    if not items:
        raise MigrationError("No supported TOTP entries were found")

    return {
        "encrypted": False,
        "items": items,
    }, skipped


def secure_write_json(
    destination: Path,
    content: dict[str, Any],
    force: bool,
) -> None:
    destination = destination.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)

    if destination.exists():
        if not force:
            raise MigrationError(
                f"Output already exists: {destination}\n"
                "Use --force to overwrite it."
            )
        destination.unlink()

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(destination, flags, 0o600)

    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(content, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
    except Exception:
        try:
            destination.unlink()
        except OSError:
            pass
        raise

    # Reinforce owner-only permissions on Unix-like systems.
    try:
        os.chmod(destination, 0o600)
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Convert Google Authenticator export QR codes into "
            "Bitwarden-compatible JSON."
        )
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help=(
            "QR image, text file, or literal otpauth-migration:// URI. "
            "Provide every QR image if Google generated multiple parts."
        ),
    )
    parser.add_argument(
        "-o",
        "--output",
        default="bitwarden-authenticator-import.json",
        help=(
            "Destination JSON file "
            "(default: bitwarden-authenticator-import.json)"
        ),
    )
    parser.add_argument(
        "--skip-unsupported",
        action="store_true",
        help="Skip HOTP or unsupported algorithm entries instead of failing.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List converted account names without displaying secrets.",
    )
    parser.add_argument(
        "-f",
        "--force",
        action="store_true",
        help="Overwrite the output file if it already exists.",
    )

    args = parser.parse_args()

    try:
        uris: list[str] = []

        for input_value in args.inputs:
            uris.extend(extract_uris_from_input(input_value))

        migration_uris = [
            uri for uri in uris
            if uri.lower().startswith("otpauth-migration://")
        ]

        if not migration_uris:
            raise MigrationError(
                "No Google Authenticator migration QR codes were found"
            )

        payloads = [
            decode_migration_uri(uri)
            for uri in migration_uris
        ]

        entries = assemble_batches(payloads)
        output, skipped = build_bitwarden_json(
            entries,
            skip_unsupported=args.skip_unsupported,
        )

        destination = Path(args.output)
        secure_write_json(destination, output, force=args.force)

        print(
            f"Created {destination} with "
            f"{len(output['items'])} TOTP entr"
            f"{'y' if len(output['items']) == 1 else 'ies'}."
        )

        if args.list:
            for item in output["items"]:
                username = item["login"].get("username", "")
                description = item["name"]
                if username and username != description:
                    description += f" — {username}"
                print(f"  - {description}")

        if skipped:
            print("\nSkipped unsupported entries:", file=sys.stderr)
            for reason in skipped:
                print(f"  - {reason}", file=sys.stderr)

        print(
            "\nSECURITY WARNING: The output file contains plaintext "
            "authenticator secrets. Import it promptly and securely delete it."
        )

        return 0

    except MigrationError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
