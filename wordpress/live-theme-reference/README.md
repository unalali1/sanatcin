# Live homepage logic patch — 25 September 2026

This is a targeted snapshot of the active, customized SanatCin v0.5.0 homepage.
It is NOT the older theme under wordpress/theme/sanatcin. Do not replace the
whole live theme with that older repository theme.

front-page.before.php is the read-only live baseline; front-page.php is the
prepared update. Existing markup/styles are preserved. Selection prioritizes
publication recency and category coverage; hero selection requires >=1400px,
ratio 1.35–1.90 and respects explicit rejection/crop flags. If no qualifying
photo exists in the seven-day pool, no unsuitable image is forced into hero.

Deployment is pending: Hostinger CDN rejected the WPVibe draft selection edit
with HTTP 403 at 2026-09-25 03:38:36 UTC. Read-back confirmed that selection
changes did not apply. The dimension check alone was accepted into the draft.
No draft was published. Do not retry blocked writes until CDN configuration or
an official Hostinger exception permits WPVibe. Preserve other live changes
by comparing the baseline before applying the patch.
