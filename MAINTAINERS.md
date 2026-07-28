# Maintainers

## Responsibilities

Maintainers protect the product contract, privacy boundary, accessibility baseline, release integrity, and contributor experience.

At least one maintainer review is required for ordinary changes. Security, persistence migrations, provider credential handling, source deletion, licensing, and public releases require an additional focused review.

## Release checks

- Verified commit and clean working tree.
- Passing required checks.
- No high or critical dependency findings.
- No secret or protected-content matches.
- Reviewed license and SBOM reports.
- Documented unresolved issues.
- Explicit approval immediately before any public promotion.

## Decision records

Material architecture or privacy changes belong in `docs/decisions` as a short decision record with context, decision, alternatives, risks, and rollback.
