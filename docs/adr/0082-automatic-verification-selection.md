# ADR-0082 — Verification is a product action

Status: accepted, requested by the user on 2026-11-05.

Users must not compose terminal commands to validate, review or deliver work. The Runtime selects
verification from the actual workspace configuration: a declared package test script and its package
manager, Node test files, or an established Python/Rust/Go test configuration. Selection is read-only;
it neither installs dependencies nor starts a process. An unconfigured project is blocked with an
actionable request to have the engineering Agent establish tests; absence of tests never counts as
passing validation. Existing explicit internal command requests remain compatible for trusted tests.

The operation freezes the selected command and full content fingerprint before its existing separate
human approval. The same post-approval freshness checks, ToolCall output, exit code and unchanged
content gate apply. Technical execution details remain expandable for audit. Primary project and
task flows expose “运行验证”, not editable command fields. The workspace offers change review and
synchronization instead of a manual terminal. Navigation uses “搜索或跳转”.
