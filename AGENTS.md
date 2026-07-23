# Family engineering guidance

- Prefer a maintained, existing tool or library over a new home-grown implementation when it satisfies the requirement and preserves Family's privacy, authorization, and confirmation boundaries.
- For AI orchestration, tool calling, retrieval, structured output, conversation state, and agent workflows, prefer LangChain or LangGraph primitives when they fit. Keep Family-specific policy, data ownership, audit events, and human confirmation in Family code.
- Reuse the project's registered LangChain tools from application flows instead of duplicating their underlying parsing or retrieval logic.
- Add regression coverage for multi-turn context, pronoun resolution, memory confirmation, idempotency, and trusted-evidence retrieval whenever those paths change.
- Do not persist model guesses as family facts. Durable memory still requires explicit user confirmation and source provenance.
