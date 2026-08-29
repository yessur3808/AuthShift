# Security policy

## Sensitive data

This project processes authenticator seeds. QR screenshots, migration URIs,
debug output containing decoded data, and generated JSON must all be treated as
credentials.

Do not include real QR codes, TOTP seeds, migration URIs, generated import
files, recovery codes, or account details in public issues, commits, test
fixtures, or logs.

The converter operates locally and does not intentionally make network
requests. Its only runtime dependency is OpenCV, which is used for image and QR
decoding.

## Reporting a vulnerability

Report vulnerabilities privately to the repository owner or maintainer. Do not
open a public issue when a report includes an exploit, a real credential, or
other sensitive material. Include reproduction steps using synthetic test data
whenever possible.

## After conversion

Verify the Bitwarden import, then remove temporary screenshots, URI files, and
plaintext JSON exports when they are no longer required. If any of these files
were exposed, rotate the affected services' authenticator secrets and recovery
codes.

