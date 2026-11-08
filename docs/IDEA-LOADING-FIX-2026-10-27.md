# Idea Library loading recovery — local verification

The observed service-availability error disappeared on reload. The original transport response was not captured, so its initiating cause remains unconfirmed. Source inspection identified why a transient failure required a reload: configuration, library and report loads were one-shot requests with no timeout or retry; configuration and report failures shared the same error state. Configuration failure could suppress the briefing loading indicator, and failed library loading could be misrepresented as an unavailable category.

Changed only saved-data loading:

- Each read has a 12-second deadline covering authentication, fetch and response parsing. One retry after 500 ms is allowed for network failures, timeout, or HTTP 500/502/503/504.
- Authorization errors, not-found responses and rate limits are not retried. Mutations, research and generation are unchanged and never automatically replayed.
- Configuration, library and report failures are separate. Saved topics remain usable during configuration failure. Failed reads have an in-page Try again action; old effect responses are ignored.
- Account/workspace changes invalidate read results and retries. Timed-out authentication cannot later dispatch its request.

Validation: all 135 local regression tests passed; build, TypeScript and lint passed. Seven new tests cover bounded stalled requests, transient failures, no mutation retry, scope changes, library/category recovery without remount, report retry and independent configuration errors. HTTP 500 was subsequently added to the transient list and the four request tests passed again.

Live Chrome: Idea Library displayed the existing AI and astrology categories; astrology displayed seven saved topics; opening Weekly Horoscope Cluster displayed its details. No research refresh, model generation, paid service, deployment or production change was performed. Fault recovery was simulated in executable request/component tests, not by interrupting the user's running server.
