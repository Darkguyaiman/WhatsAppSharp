# Performance

The chat screen previously built its full hidden emoji catalogue on page startup: 1,861 buttons and 1,876 emoji images in the measured test screen. The picker now initializes when opened, and its images load lazily inside the scrolling panel. The initial screen went from 4,425 DOM elements to 652; the hidden catalogue creates no buttons at startup. Emoji search also respects the `hidden` attribute despite the grid display rule.

Message history, search, and message updates now project only the values sent to clients. Reactions are the only joined collection; read receipts and delivery status use SQL existence checks. This avoids loading complete users, all read receipts, and repeated conversation memberships for every message. Conversation previews still load only the latest message and use two queries rather than four. Message timestamps reuse locale formatters rather than constructing one for every displayed timestamp.

## Local measurements

Measured in a Debug build on the same machine / MySQL server, using an isolated database with 2,000 additional messages. Each service measurement is the median of 12 warmed calls with a fresh database context. These are service timings, not full browser or network timings.

| Operation | Before | After | SQL queries before → after |
| --- | ---: | ---: | ---: |
| Conversation list | 17.47 ms | 16.03 ms | 4 → 2 |
| Latest message page | 11.69 ms | 5.41 ms | 4 → 1 |
| Conversation update | 16.37 ms | 15.08 ms | 4 → 2 |
| Save message and load its response | 20.80 ms | 14.83 ms | 8 → 5 |

Formatting 500 timestamps in the local JavaScript benchmark fell from about 39.72 ms to 0.97 ms. This is a small rendering benchmark, not a claim about whole-app speed. Actual results depend on data size, server load, browser/device, and network latency.

## Running locally

Use an optimized build for normal use:

```bash
dotnet run --project src/MessagingApp --configuration Release --launch-profile http
```

Plain `dotnet run` uses Debug by default. Release still uses the selected development launch profile, so local HTTP and development settings continue to work. The Linux installer already publishes a Release build.

Routine SQL command logging is set to Warning in `appsettings.Development.json`; errors still appear. Temporarily change `Microsoft.EntityFrameworkCore.Database.Command` to `Information` when inspecting generated SQL.

Message history remains paged at 50 messages. Opening older messages fetches another page. Conversation unread counts still inspect stored message/read state; unusually large histories or groups may need further profiling. Read receipts remain transactional, and authentication and conversation-membership checks remain in place.

References: [EF Core efficient querying](https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying), [single and split queries](https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries), [.NET run configurations](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-run).
