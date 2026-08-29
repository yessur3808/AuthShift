import base64
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

import google_auth_to_bitwarden as converter


def encode_varint(value):
    encoded = bytearray()
    while value > 0x7F:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def bytes_field(number, value):
    return encode_varint((number << 3) | 2) + encode_varint(len(value)) + value


def integer_field(number, value):
    return encode_varint(number << 3) + encode_varint(value)


def synthetic_migration_uri(
    *,
    secret=b"synthetic-test-key",
    name="Example:alice@example.com",
    issuer="Example",
    batch_size=1,
    batch_index=0,
    batch_id=1234,
):
    entry = b"".join(
        (
            bytes_field(1, secret),
            bytes_field(2, name.encode()),
            bytes_field(3, issuer.encode()),
            integer_field(4, 1),  # SHA1
            integer_field(5, 1),  # Six digits
            integer_field(6, 2),  # TOTP
        )
    )
    payload = b"".join(
        (
            bytes_field(1, entry),
            integer_field(2, 1),
            integer_field(3, batch_size),
            integer_field(4, batch_index),
            integer_field(5, batch_id),
        )
    )
    encoded = quote(base64.b64encode(payload).decode(), safe="")
    return f"otpauth-migration://offline?data={encoded}"


class MigrationTests(unittest.TestCase):
    def test_decodes_synthetic_migration_uri(self):
        payload = converter.decode_migration_uri(synthetic_migration_uri())

        self.assertEqual(payload["batch_size"], 1)
        self.assertEqual(payload["batch_index"], 0)
        self.assertEqual(payload["batch_id"], 1234)
        self.assertEqual(len(payload["entries"]), 1)
        self.assertEqual(payload["entries"][0]["issuer"], "Example")
        self.assertEqual(
            payload["entries"][0]["name"],
            "Example:alice@example.com",
        )

    def test_builds_bitwarden_authenticator_shape(self):
        payload = converter.decode_migration_uri(synthetic_migration_uri())
        result, skipped = converter.build_bitwarden_json(
            payload["entries"],
            skip_unsupported=False,
        )

        self.assertFalse(skipped)
        self.assertEqual(set(result), {"encrypted", "items"})
        self.assertIs(result["encrypted"], False)
        self.assertEqual(len(result["items"]), 1)

        item = result["items"][0]
        self.assertEqual(
            set(item),
            {"favorite", "id", "login", "name", "type"},
        )
        self.assertEqual(item["type"], 1)
        self.assertEqual(item["name"], "Example")
        self.assertEqual(item["login"]["username"], "alice@example.com")

        parsed = urlsplit(item["login"]["totp"])
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.scheme, "otpauth")
        self.assertEqual(parsed.netloc, "totp")
        self.assertEqual(query["issuer"], ["Example"])
        self.assertEqual(query["algorithm"], ["SHA1"])
        self.assertEqual(query["digits"], ["6"])
        self.assertEqual(query["period"], ["30"])

    def test_assembles_batch_in_index_order(self):
        second = converter.decode_migration_uri(
            synthetic_migration_uri(
                name="Second",
                issuer="",
                batch_size=2,
                batch_index=1,
            )
        )
        first = converter.decode_migration_uri(
            synthetic_migration_uri(
                name="First",
                issuer="",
                batch_size=2,
                batch_index=0,
            )
        )

        entries = converter.assemble_batches([second, first])

        self.assertEqual([entry["name"] for entry in entries], ["First", "Second"])

    def test_rejects_incomplete_batch(self):
        payload = converter.decode_migration_uri(
            synthetic_migration_uri(batch_size=2, batch_index=0)
        )

        with self.assertRaisesRegex(converter.MigrationError, "incomplete"):
            converter.assemble_batches([payload])

    def test_secure_write_refuses_overwrite_without_force(self):
        content = {"encrypted": False, "items": []}
        with tempfile.TemporaryDirectory() as temporary_directory:
            destination = Path(temporary_directory) / "export.json"
            converter.secure_write_json(destination, content, force=False)

            self.assertEqual(json.loads(destination.read_text()), content)
            if os.name == "posix":
                mode = stat.S_IMODE(destination.stat().st_mode)
                self.assertEqual(mode, 0o600)

            with self.assertRaisesRegex(converter.MigrationError, "already exists"):
                converter.secure_write_json(destination, content, force=False)


if __name__ == "__main__":
    unittest.main()
