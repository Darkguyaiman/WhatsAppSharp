using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Models;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;

namespace MessagingApp.Services;

// A bounded worker keeps external push-service latency out of message delivery.
// Jobs are best effort; message history remains the source of truth after reconnect.
public sealed class WebPushService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<WebPushService> _logger;
    private readonly Channel<(int MessageId, int[] Recipients)> _queue = Channel.CreateBounded<(int, int[])>(
        new BoundedChannelOptions(1000) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true });
    private readonly Channel<string> _calls = Channel.CreateBounded<string>(
        new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true });
    private readonly VapidAuthentication? _vapid;
    private readonly DeliveryTokenService _deliveryTokens;
    public bool Enabled => _vapid != null;
    public string? PublicKey => _vapid?.PublicKey;

    public WebPushService(IServiceScopeFactory scopes, IConfiguration config, IWebHostEnvironment env,
        IDataProtectionProvider protection, ILogger<WebPushService> logger)
    {
        _scopes = scopes;
        _logger = logger;
        _deliveryTokens = new DeliveryTokenService(protection);
        var publicKey = config["WebPush:PublicKey"];
        var privateKey = config["WebPush:PrivateKey"];
        var subject = config["WebPush:Subject"];
        if (env.IsDevelopment() && (string.IsNullOrWhiteSpace(publicKey) || string.IsNullOrWhiteSpace(privateKey)))
        {
            var folder = Path.Combine(env.ContentRootPath, "App_Data");
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, "vapid.protected");
            var protector = protection.CreateProtector("MessagingApp.WebPush.Vapid.v1");
            VapidKeys keys;
            if (File.Exists(path))
                keys = JsonSerializer.Deserialize<VapidKeys>(protector.Unprotect(File.ReadAllText(path)))!;
            else
            {
                keys = GenerateKeys();
                File.WriteAllText(path, protector.Protect(JsonSerializer.Serialize(keys)));
            }
            publicKey = keys.PublicKey;
            privateKey = keys.PrivateKey;
            if (string.IsNullOrWhiteSpace(subject)) subject = "mailto:developer@localhost";
        }
        if (!string.IsNullOrWhiteSpace(publicKey) && !string.IsNullOrWhiteSpace(privateKey) &&
            Uri.TryCreate(subject, UriKind.Absolute, out var uri) && (uri.Scheme == "mailto" || uri.Scheme == "https"))
        {
            if (WebEncoders.Base64UrlDecode(publicKey).Length != 65 || WebEncoders.Base64UrlDecode(privateKey).Length != 32)
                throw new InvalidOperationException("WebPush VAPID keys must be a P-256 key pair.");
            _vapid = new VapidAuthentication(publicKey, privateKey) { Subject = subject };
        }
        else logger.LogWarning("Web push is unavailable. Configure WebPush:Subject, PublicKey and PrivateKey for production.");
    }

    public void Enqueue(int messageId, IEnumerable<int> recipients)
    {
        if (Enabled && !_queue.Writer.TryWrite((messageId, recipients.Distinct().ToArray())))
            _logger.LogWarning("Push queue is full; notification skipped for message {MessageId}", messageId);
    }

    public void EnqueueCall(string callId)
    {
        if (Enabled && !_calls.Writer.TryWrite(callId))
            _logger.LogWarning("Push queue is full; call notification skipped for {CallId}", callId);
    }

    public static string HashEndpoint(string endpoint) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(endpoint)));

    public sealed record VapidKeys(string PublicKey, string PrivateKey);

    public static VapidKeys GenerateKeys()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(true);
        var publicKey = new byte[65];
        publicKey[0] = 4;
        parameters.Q.X!.CopyTo(publicKey, 1);
        parameters.Q.Y!.CopyTo(publicKey, 33);
        return new(WebEncoders.Base64UrlEncode(publicKey), WebEncoders.Base64UrlEncode(parameters.D!));
    }

    // Only public browser push providers may receive requests. Never follow redirects.
    public static bool IsValidEndpoint(string? endpoint)
    {
        if (endpoint?.Length > 2048 || !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length > 0 || uri.Fragment.Length > 0) return false;
        var host = uri.IdnHost.ToLowerInvariant();
        return host == "fcm.googleapis.com" || host == "updates.push.services.mozilla.com" ||
            host == "web.push.apple.com" || host.EndsWith(".push.apple.com", StringComparison.Ordinal) ||
            host == "notify.windows.com" || host.EndsWith(".notify.windows.com", StringComparison.Ordinal);
    }

    public static bool IsValidKey(string? value, int length)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 128) return false;
        try { return WebEncoders.Base64UrlDecode(value).Length == length; }
        catch (FormatException) { return false; }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
        var client = new PushServiceClient(http) { DefaultAuthentication = _vapid, AutoRetryAfter = false };
        // Time-sensitive calls must not wait behind message notification traffic.
        await Task.WhenAll(ProcessMessagesAsync(client, stoppingToken), ProcessCallsAsync(client, stoppingToken));
    }

    private async Task ProcessCallsAsync(PushServiceClient client, CancellationToken stoppingToken)
    {
        await foreach (var callId in _calls.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = _scopes.CreateScope();
                await SendCallAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), client, callId, stoppingToken);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            { _logger.LogError(ex, "Unable to process notification for call {CallId}", callId); }
        }
    }

    private async Task ProcessMessagesAsync(PushServiceClient client, CancellationToken stoppingToken)
    {
        await foreach (var job in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var msg = await db.Messages.AsNoTracking().Include(m => m.Sender)
                    .FirstOrDefaultAsync(m => m.Id == job.MessageId && !m.IsDeleted, stoppingToken);
                if (msg == null) continue;
                var eligibleIds = await db.ConversationMembers.Where(m => m.ConversationId == msg.ConversationId &&
                    job.Recipients.Contains(m.UserId) && !db.MessageUserStates.Any(s => s.MessageId == msg.Id && s.UserId == m.UserId && s.IsHidden) && (m.LastReadMessageId == null || m.LastReadMessageId < msg.Id))
                    .Select(m => m.UserId).ToArrayAsync(stoppingToken);
                var subscriptions = await db.WebPushSubscriptions.AsNoTracking().Where(s => eligibleIds.Contains(s.UserId))
                    .ToListAsync(stoppingToken);
                var expired = new System.Collections.Concurrent.ConcurrentBag<int>();
                await Parallel.ForEachAsync(subscriptions, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = stoppingToken }, async (subscription, token) =>
                {
                    if (!IsValidEndpoint(subscription.Endpoint)) return;
                    var payload = JsonSerializer.Serialize(new
                    {
                        title = msg.Sender.DisplayName,
                        body = msg.Type == MessageType.Voice ? "Sent a voice message" :
                            string.IsNullOrWhiteSpace(msg.Content) ? "Sent an attachment" : MessageContentPreview.Text(msg.Content)[..Math.Min(MessageContentPreview.Text(msg.Content).Length,180)],
                        url = $"/Chat?conv={msg.ConversationId}",
                        conversationId = msg.ConversationId,
                        recipientId = subscription.UserId,
                        deliveryToken = _deliveryTokens.Issue(msg.Id,subscription.UserId),
                        tag = $"chat-{subscription.UserId}-{msg.ConversationId}"
                    });
                    try
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                        timeout.CancelAfter(TimeSpan.FromSeconds(10));
                        await client.RequestPushMessageDeliveryAsync(new PushSubscription
                        {
                            Endpoint = subscription.Endpoint,
                            Keys = new Dictionary<string, string> { ["p256dh"] = subscription.P256dh, ["auth"] = subscription.Auth }
                        }, new PushMessage(payload) { TimeToLive = 3600 }, timeout.Token);
                    }
                    catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
                    { expired.Add(subscription.Id); }
                    catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                    { _logger.LogWarning("Push delivery failed for subscription {Id}: {ErrorType}", subscription.Id, ex.GetType().Name); }
                });
                if (!expired.IsEmpty)
                    await db.WebPushSubscriptions.Where(s => expired.ToArray().Contains(s.Id)).ExecuteDeleteAsync(stoppingToken);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            { _logger.LogError(ex, "Unable to process notification for message {MessageId}", job.MessageId); }
        }
    }

    private async Task SendCallAsync(AppDbContext db, PushServiceClient client, string callId, CancellationToken stoppingToken)
    {
        var call = await db.CallRecords.AsNoTracking().SingleOrDefaultAsync(c => c.Id == callId && c.State == "ringing", stoppingToken);
        if (call is null) return;
        var expiresAt = new DateTimeOffset(DateTime.SpecifyKind(call.CreatedAt, DateTimeKind.Utc)).AddSeconds(45);
        var callerName = await db.Users.Where(u => u.Id == call.CallerId).Select(u => u.DisplayName).SingleAsync(stoppingToken);
        var subscriptions = await db.WebPushSubscriptions.AsNoTracking().Where(s => s.UserId == call.RecipientId).ToListAsync(stoppingToken);
        await Parallel.ForEachAsync(subscriptions, new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = stoppingToken }, async (subscription, token) =>
        {
            var ttl = (int)(expiresAt - DateTimeOffset.UtcNow).TotalSeconds;
            if (ttl <= 0 || !IsValidEndpoint(subscription.Endpoint)) return;
            var payload = JsonSerializer.Serialize(new {
                type = "incoming-call", callId, title = callerName,
                body = call.Video ? "Incoming video call. Tap to open WhatsAppSharp." : "Incoming voice call. Tap to open WhatsAppSharp.",
                url = $"/Chat?conv={call.ConversationId}&call={call.Id}", recipientId = call.RecipientId,
                tag = $"call-{call.Id}", expiresAt = expiresAt.ToUnixTimeMilliseconds()
            });
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(TimeSpan.FromSeconds(Math.Min(10, ttl)));
                await client.RequestPushMessageDeliveryAsync(new PushSubscription {
                    Endpoint = subscription.Endpoint,
                    Keys = new Dictionary<string, string> { ["p256dh"] = subscription.P256dh, ["auth"] = subscription.Auth }
                }, new PushMessage(payload) { TimeToLive = ttl, Urgency = PushMessageUrgency.High }, timeout.Token);
            }
            catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound)
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().WebPushSubscriptions.Where(s => s.Id == subscription.Id).ExecuteDeleteAsync(token);
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            { _logger.LogWarning("Call push delivery failed for subscription {Id}: {ErrorType}", subscription.Id, ex.GetType().Name); }
        });
    }

    public override void Dispose()
    {
        _vapid?.Dispose();
        base.Dispose();
    }
}
