# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x (current: 1.0.0) | ✅ |
| < 1.0 | ❌ |

Security fixes land on the latest 1.x release. Prereleases are best-effort only.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through
[GitHub Security Advisories](https://github.com/hemanth090/meshflow-studio/security/advisories/new)
for this repository. Include:

- the affected version (and the Harness/DSH version you tested),
- browser and OS,
- a minimal reproduction (steps or a snippet of the crafted input),
- the impact you believe it has.

You should receive an initial response within about 7 days. Once the report is validated, a fix and
a coordinated disclosure will be prepared; credit is given in the advisory and the release notes
unless you ask to remain anonymous.

## Scope

MeshFlow Studio is a **client-side DSH Web UI plugin**. Its attack surface is intentionally small:

- It runs entirely in the browser inside the connected Harness page; there is no server component,
  no host service, no tool and no network access (`fetch`/XHR/WebSockets are never used).
- The only runtime dependency is `react`, provided by the Harness bundle.
- Persistence is limited to two `localStorage` keys (`meshflow-studio.state.v2`,
  `meshflow-studio.presets.v1`); saved compositions are normalised and clamped through
  `MF.model.deserialize` / `normalize` before use, and corrupt values are ignored.
- PNG download, CSS/JSON download and clipboard writes happen only after an explicit user action;
  temporary anchors/textareas are removed immediately and no clipboard data is sent anywhere.
- Rendered chrome uses Harness theme tokens; visible strings come from the locale service.

In scope: injection or XSS through composition/preset/locale data, unsafe handling of untrusted
saved state, unintended network or filesystem access, clipboard leakage, and privilege escalation
against the hosting page.

Out of scope: vulnerabilities in the Harness/DSH runtime itself (report those upstream), bugs in the
browser or OS clipboard/canvas implementations, denial of service from deliberately huge
`localStorage` values, and reports that require an already-compromised browser profile.

## Safe harbour

Good-faith security research that follows this policy will not be pursued or reported as abuse.
Please give us a reasonable window to ship a fix before public disclosure.
