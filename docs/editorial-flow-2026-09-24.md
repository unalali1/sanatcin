# Editorial flow patch — 24 September 2026

Worker 0.13.1 keeps the existing schedule, AI models, concurrency, maximum attempts, time budget and publication thresholds.

- After a source-body extraction failure, prefer qualified alternative sources within that category. Two failures stop that feed in that category for the current run, without disabling other categories or adding retries.
- Publisher-cap overflow remains a last resort for an empty category; qualified publishers below the cap come first.
- Check original-title duplicates before extraction and Turkish-title duplicates immediately after the first draft. Keep the final Turkish-title guard. Concurrent guards share a 60-second WordPress cache, updated by this run's publications (including publications during an in-flight refresh).
- Correct the known museum-name translation deterministically, and flag observed jade terminology, empty explanations, object-as-researcher headlines and overloaded geographic leads through existing editorial checks. Writing/selection prompts clarify naming, main-topic category and artwork-over-protocol priorities. No new AI stage is introduced.
- Hero eligibility requires 1400px width, 1.35–1.9 ratio, safe crop and an appropriate scene. Normal article-image thresholds are unchanged. Existing published posts are not rewritten by this patch.
- Missing categories yield a partial run status even if the numerical minimum is reached. Editorial logs include category coverage, eligible hero count and per-category source failures. Lack of a hero image produces a warning, not a publication failure.

Validation: regression fixtures cover failed-feed switching within the same attempt budget, publisher alternatives, quality floors, early duplicate rejection, shared WordPress requests, language defects and hero geometry. A normal mocked article keeps four AI calls; a duplicate exits after two rather than completing polish/headline processing.

Live acceptance: inspect the next scheduled run for attempts by source, extraction rejection count, category coverage, editorial warnings, AI calls and elapsed time per published article. Test timing does not predict live model/network latency. More successful articles may increase total run duration while reducing wasted work per article.
