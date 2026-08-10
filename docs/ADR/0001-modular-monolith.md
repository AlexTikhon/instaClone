# ADR 0001: Begin with a modular monolith

- Status: Accepted
- Date: 2026-08-10

## Context

The product needs many domains but has no demonstrated independent scale or deployment constraints.

## Decision

Run synchronous product modules in one NestJS application. Preserve explicit module APIs, prohibit
cross-module repository access, and use events where temporal coupling is unnecessary. Keep workers
as a separate process because their failure and scaling characteristics already differ.

## Consequences

Transactions, local development, and debugging remain simple. The team must actively enforce module
boundaries. High-load modules can later be extracted around established contracts, but extraction is
not assumed to be free.
