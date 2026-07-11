# ADR-004: Agent execution framework and graph migration boundary

## Status

Accepted

## Date

2026-07-11

## Context

StoryForge needs streaming responses, native tool calling, MCP tools, approval pause/resume, project storage isolation and durable multi-turn context. The current implementation uses Vercel AI SDK v7 `ToolLoopAgent` behind `AgentRuntimePort`.

The previous host integration persisted visible chat turns but did not feed them back to the model, did not retain tool outputs, and used fixed turn/character limits. These are host memory-policy defects, not limitations of tool calling itself.

LangChain provides broad provider, retriever and tool abstractions. LangGraph adds explicit graph state, checkpoints, branching and durable resume. Neither framework supplies StoryForge's registry-backed project tools, adoption approval contract, IndexedDB/local-folder backend or UI event model automatically.

## Decision

- Keep Vercel AI SDK `ToolLoopAgent` as the current execution implementation behind `AgentRuntimePort`.
- Treat conversation persistence, tool-result retention, token budgeting, summarization and project checkpoint storage as explicit StoryForge host services.
- Derive context limits from the active model configuration. Do not use fixed character or turn limits.
- Compress older history with the configured model when usage reaches the configured threshold; preserve recent raw messages and tool-derived project facts.
- Keep internal and MCP tools framework-neutral through `ToolRegistry` and `ProjectStoragePort`.
- Do not add LangChain only as an additional provider/tool wrapper because it would duplicate existing ports without removing current responsibilities.
- Re-evaluate a LangGraph.js runtime adapter when durable background graphs, multi-agent branching, restart-safe node execution or human approval across application restarts enter the active roadmap.

## Consequences

- The current React/browser/Tauri-compatible streaming path remains small and does not require a second tool schema layer.
- Memory correctness remains a StoryForge responsibility and must have request-level regression tests.
- A future LangGraph adapter can replace `AiSdkAgentRuntimeAdapter` without changing StoryForge tools, storage ports or the Agent Dock event contract.
- Adopting LangGraph later still requires a custom checkpoint saver backed by the active `ProjectStoragePort`; framework adoption alone is not considered persistence.
