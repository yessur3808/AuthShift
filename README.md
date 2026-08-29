# AuthShift — Google Authenticator to Bitwarden

Convert Google Authenticator export QR codes into a JSON file that can be
imported by Bitwarden Authenticator or Bitwarden Password Manager.

The converter runs locally and supports:

- ordinary QR-code images;
- dense QR codes embedded in full phone screenshots;
- JPEG-compressed screenshots using automatic cropping, scaling, and
  thresholding;
- multi-part Google Authenticator exports; and
- text files or literal `otpauth-migration://` URIs.

No QR contents or authenticator secrets are sent over the network.

## Web app

AuthShift includes a responsive browser interface with drag-and-drop input,
automatic screenshot enhancement, multi-part export assembly, account review,
and local JSON download. The web app is completely static: conversion happens
inside the browser and does not require a server.

Run it locally:

```bash
npm install
npm run dev
```

Open the local address printed by Vite. Add every QR screenshot, select
**Create Bitwarden export**, review the account labels, and download the JSON.

The original Python command-line converter remains available for automation or
offline terminal use.

## Security warning

Google Authenticator QR codes and the generated JSON contain the secret keys
needed to generate your verification codes. Anyone who obtains them may be able
to bypass the second factor on your accounts.

- Keep input images and output JSON private.
- Do not commit them to source control or upload them to public services.
- Import the JSON promptly, verify the entries, and then delete the images and
  JSON when they are no longer needed.
- Keep recovery codes in a separate secure location before migrating.

The included `.gitignore` excludes the default output, common QR screenshot
formats, and the recommended `private/` and `qr-codes/` directories. Git cannot
protect secrets that were already committed.

## Python CLI requirements

- Python 3.9 or newer
- OpenCV for QR-code decoding

## Python CLI installation

Create an isolated environment and install the dependency:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

On Windows PowerShell, activate the environment with:

```powershell
.venv\Scripts\Activate.ps1
```

You can alternatively install the project as a command-line tool:

```bash
python -m pip install .
google-auth-to-bitwarden --help
```

## Export from Google Authenticator

1. Open Google Authenticator.
2. Choose **Transfer accounts** and then **Export accounts**.
3. Select the accounts to export.
4. Save a clear screenshot of every QR part. Google Authenticator may produce
   more than one code, labelled `1 of 3`, `2 of 3`, and so on.
5. Put the screenshots in the ignored `qr-codes/` directory if convenient.

Every QR part must be supplied to the converter. File order does not matter;
the batch metadata inside each code determines the correct order.

## Python CLI usage

Pass all QR images in a single command:

```bash
python google_auth_to_bitwarden.py \
  qr-codes/code-1.jpg \
  qr-codes/code-2.jpg \
  qr-codes/code-3.jpg
```

The default output is:

```text
bitwarden-authenticator-import.json
```

Use a different destination and list converted account names without exposing
their secrets:

```bash
python google_auth_to_bitwarden.py qr-codes/*.png \
  --output my-authenticator-import.json \
  --list
```

If the output already exists, explicitly allow replacement:

```bash
python google_auth_to_bitwarden.py qr-codes/*.jpg --force
```

The script also accepts a text file containing one or more migration URIs:

```bash
python google_auth_to_bitwarden.py migration-uris.txt
```

Run `python google_auth_to_bitwarden.py --help` for every option.

## Import into Bitwarden

### Bitwarden Authenticator

1. Open Bitwarden Authenticator.
2. Go to **Settings → Import**.
3. Select **Authenticator Export (JSON)**.
4. Choose the generated JSON file.
5. Verify that the expected verification codes are present.

The generated structure matches Bitwarden's documented Authenticator JSON
format:

```json
{
  "encrypted": false,
  "items": [
    {
      "favorite": false,
      "id": "GENERATED-UUID",
      "login": {
        "totp": "otpauth://totp/...",
        "username": "account@example.com"
      },
      "name": "Example",
      "type": 1
    }
  ]
}
```

See Bitwarden's [Authenticator import and export
documentation](https://bitwarden.com/help/authenticator-import-export/)
for the current import workflow and schema.

### Bitwarden Password Manager

The same file can be imported through **Tools → Import data** by selecting
**Bitwarden (JSON)** as the format. It creates a separate login item for every
TOTP. Bitwarden does not merge these with matching logins or check for
duplicates, so review an existing vault before importing.

See Bitwarden's [custom JSON import
documentation](https://bitwarden.com/help/condition-bitwarden-import/)
for details.

## Troubleshooting

### No readable QR code found

- Use the original screenshot rather than an image copied through a messaging
  service.
- Prefer PNG when possible, although JPEG is supported.
- Ensure the complete QR square is visible and not covered by controls.
- Avoid perspective distortion, blur, and aggressive image compression.

### Batch is incomplete

Google Authenticator created a multi-part export. Provide every image from that
export in the same command.

### Output already exists

Choose another path with `--output`, or use `--force` if replacing it is
intentional.

### Unsupported entry

Bitwarden imports time-based one-time passwords (TOTP). Use
`--skip-unsupported` to omit HOTP entries or unsupported algorithms while
converting the rest.

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`, which tests,
builds, and deploys the static site whenever the `main` branch is updated.

1. Push the project to a GitHub repository using `main` as the default branch.
2. Open **Settings → Pages** in that repository.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Push to `main`, or manually run **Deploy AuthShift to GitHub Pages** from the
   repository’s **Actions** tab.

Pages must be enabled before the workflow runs for the first time. If the
**Configure GitHub Pages** step reports `Get Pages site failed` or `Not Found`,
repeat steps 2–3, save the Pages setting, and then re-run the failed workflow.
The workflow intentionally does not request an administrator personal access
token merely to enable Pages automatically.

Vite uses relative asset paths, so the build works for both
`username.github.io` sites and `username.github.io/repository-name` project
sites. The workflow injects the final Pages URL into the social preview
metadata at build time.

To validate the production build locally:

```bash
npm test
npm run build
npm run preview
```

## Development

Run the dependency-free unit tests with:

```bash
python -m unittest discover -s tests -v
```

The tests use synthetic secrets and do not read the private QR screenshots.

Run the browser converter tests with:

```bash
npm test
```
