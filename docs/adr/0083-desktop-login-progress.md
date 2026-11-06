# ADR-0083 — Device login progress survives settings navigation

Status: accepted, 2026-11-05.

Real desktop acceptance exposed that closing and reopening Settings lost the visible pending login
state while Main still owned its loopback request. Main now exposes only a pending flag and the
validated service origin; Renderer polls that status and restores the pending/cancel controls.
The pending request remains memory-only, is bounded and is not resumed after a crash.

Match the desktop's human interaction window to the server's existing ten-minute consent window.
This changes neither the 120-second single-use authorization-code TTL nor PKCE, state, origin/Host
validation, token expiration or any test timeout. Successful connections omit pending metadata.
