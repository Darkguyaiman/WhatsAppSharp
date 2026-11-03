using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Hubs;
using MessagingApp.Models;

namespace MessagingApp.Services;

public record CallInfo(string Id, int ConversationId, int CallerId, int RecipientId, string CallerName, string RecipientName, string CallerAvatar, string RecipientAvatar, bool Video, string State);

// One active call per account; a chosen browser connection owns each media endpoint.
public sealed class CallService(IServiceScopeFactory scopes, IHubContext<ChatHub> hub, IUserPresenceService presence, ILogger<CallService> logger) : BackgroundService
{
    sealed class ActiveCall(CallRecord record, CallInfo info, string callerConnection)
    {
        public CallRecord Record = record;
        public CallInfo Info = info;
        public string CallerConnection = callerConnection;
        public string? RecipientConnection;
        public DateTime? CallerDisconnected;
        public DateTime? RecipientDisconnected;
    }
    readonly Dictionary<string, ActiveCall> active = new();
    readonly SemaphoreSlim gate = new(1, 1);
    public async Task<CallInfo> StartAsync(int userId, string connectionId, int conversationId, bool video)
    {
        await gate.WaitAsync();
        try
        {
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conversation = await db.Conversations.Include(c => c.Members).ThenInclude(m => m.User).FirstOrDefaultAsync(c => c.Id == conversationId);
            if (conversation == null || conversation.IsGroup || conversation.Members.Count != 2 || !conversation.Members.Any(m => m.UserId == userId))
                throw new HubException("Choose a direct chat to start a voice or video call.");
            var caller = conversation.Members.Single(m => m.UserId == userId).User;
            var peer = conversation.Members.Single(m => m.UserId != userId).User;
            if (!presence.IsUserOnline(peer.Id)) throw new HubException("This person is offline. Try calling when they are online.");
            if (active.Values.Any(c => c.Record.CallerId == userId || c.Record.RecipientId == userId || c.Record.CallerId == peer.Id || c.Record.RecipientId == peer.Id))
                throw new HubException("One of you is already on a call.");
            var record = new CallRecord { CallerId = userId, RecipientId = peer.Id, ConversationId = conversationId, Video = video };
            var info = new CallInfo(record.Id, conversationId, userId, peer.Id, caller.DisplayName, peer.DisplayName, AvatarAppearance.ForUser(caller), AvatarAppearance.ForUser(peer), video, "ringing");
            db.CallRecords.Add(record); await db.SaveChangesAsync();
            active.Add(record.Id, new ActiveCall(record, info, connectionId));
            await hub.Clients.User(peer.Id.ToString()).SendAsync("IncomingCall", info);
            return info;
        }
        finally { gate.Release(); }
    }
    public async Task AcceptAsync(int userId, string connectionId, string id)
    {
        await gate.WaitAsync();
        try
        {
            var call = Require(id, userId);
            if (call.Record.RecipientId != userId || call.Record.State != "ringing") throw new HubException("This call is no longer available.");
            call.RecipientConnection = connectionId; call.Record.State = "active"; call.Record.AnsweredAt = DateTime.UtcNow;
            await SaveAsync(call);
            await hub.Clients.Client(call.CallerConnection).SendAsync("CallAccepted", call.Info with { State = "active" });
            foreach (var other in presence.GetUserConnections(userId).Where(c => c != connectionId)) await hub.Clients.Client(other).SendAsync("CallAnsweredElsewhere", id);
        }
        finally { gate.Release(); }
    }
    public async Task SignalAsync(int userId, string connectionId, string id, string kind, string payload)
    {
        if (payload.Length > 65536 || kind is not ("offer" or "answer" or "ice" or "video-state")) throw new HubException("Invalid call signal.");
        try
        {
            using var signal = System.Text.Json.JsonDocument.Parse(payload);
            var value = signal.RootElement;
            if (value.ValueKind != System.Text.Json.JsonValueKind.Object) throw new HubException("Invalid call signal.");
            if (kind is "offer" or "answer" && (!value.TryGetProperty("type", out var type) || type.GetString() != kind || !value.TryGetProperty("sdp", out var sdp) || sdp.ValueKind != System.Text.Json.JsonValueKind.String)) throw new HubException("Invalid session description.");
            if (kind == "ice" && (!value.TryGetProperty("candidate", out var candidate) || candidate.ValueKind != System.Text.Json.JsonValueKind.String)) throw new HubException("Invalid network candidate.");
            if (kind == "video-state" && (!value.TryGetProperty("enabled", out var enabled) || enabled.ValueKind is not (System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False))) throw new HubException("Invalid camera state.");
        }
        catch (System.Text.Json.JsonException) { throw new HubException("Invalid call signal."); }
        await gate.WaitAsync();
        try
        {
            var call = Require(id, userId);
            if (call.Record.State != "active" || (connectionId != call.CallerConnection && connectionId != call.RecipientConnection)) throw new HubException("This browser does not own the call.");
            if ((kind == "offer" && userId != call.Record.CallerId) || (kind == "answer" && userId != call.Record.RecipientId)) throw new HubException("Invalid call negotiation role.");
            var target = userId == call.Record.CallerId ? call.RecipientConnection : call.CallerConnection;
            if (target != null) await hub.Clients.Client(target).SendAsync("CallSignal", new { id, kind, payload });
        }
        finally { gate.Release(); }
    }
    public async Task EndAsync(int userId, string id, string reason)
    {
        await gate.WaitAsync();
        try
        {
            if (!active.TryGetValue(id, out var call)) return;
            Require(id, userId);
            var state = reason == "declined" && call.Record.State == "ringing" && userId == call.Record.RecipientId ? "declined" :
                call.Record.State == "ringing" ? "cancelled" : reason == "failed" ? "failed" : "completed";
            await FinishAsync(id, call, state);
        }
        finally { gate.Release(); }
    }
    public async Task<CallInfo?> PendingAsync(int userId)
    {
        await gate.WaitAsync();
        try { return active.Values.FirstOrDefault(c => c.Record.RecipientId == userId && c.Record.State == "ringing")?.Info; }
        finally { gate.Release(); }
    }
    public async Task ResumeAsync(int userId, string connectionId, string id)
    {
        await gate.WaitAsync();
        try
        {
            var call = Require(id, userId);
            if (call.Record.CallerId == userId)
            {
                if (call.CallerConnection != connectionId && presence.GetUserConnections(userId).Contains(call.CallerConnection)) throw new HubException("This call is open in another browser.");
                call.CallerConnection = connectionId; call.CallerDisconnected = null;
            }
            else
            {
                if (call.RecipientConnection != connectionId && presence.GetUserConnections(userId).Contains(call.RecipientConnection ?? "")) throw new HubException("This call is open in another browser.");
                call.RecipientConnection = connectionId; call.RecipientDisconnected = null;
            }
        }
        finally { gate.Release(); }
    }
    public async Task DisconnectedAsync(string connectionId)
    {
        await gate.WaitAsync();
        try { foreach (var call in active.Values) { if (call.CallerConnection == connectionId) call.CallerDisconnected = DateTime.UtcNow; if (call.RecipientConnection == connectionId) call.RecipientDisconnected = DateTime.UtcNow; } }
        finally { gate.Release(); }
    }
    ActiveCall Require(string id, int userId)
    {
        if (!active.TryGetValue(id, out var call) || (call.Record.CallerId != userId && call.Record.RecipientId != userId)) throw new HubException("Call not found.");
        return call;
    }
    async Task SaveAsync(ActiveCall call)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.CallRecords.Where(c => c.Id == call.Record.Id).ExecuteUpdateAsync(set => set.SetProperty(c => c.State, call.Record.State).SetProperty(c => c.AnsweredAt, call.Record.AnsweredAt).SetProperty(c => c.EndedAt, call.Record.EndedAt));
    }
    async Task FinishAsync(string id, ActiveCall call, string state)
    {
        call.Record.State = state; call.Record.EndedAt = DateTime.UtcNow;
        await SaveAsync(call); active.Remove(id);
        await hub.Clients.Users(call.Record.CallerId.ToString(), call.Record.RecipientId.ToString()).SendAsync("CallEnded", new { id, state });
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.CallRecords.Where(c => c.State == "active" || c.State == "ringing").ExecuteUpdateAsync(set => set.SetProperty(c => c.State, "interrupted").SetProperty(c => c.EndedAt, DateTime.UtcNow), stoppingToken);
        }
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await gate.WaitAsync(stoppingToken);
            try
            {
                foreach (var entry in active.ToArray())
                {
                    var call = entry.Value; var now = DateTime.UtcNow;
                    if (call.Record.State == "ringing" && now - call.Record.CreatedAt > TimeSpan.FromSeconds(45)) await FinishAsync(entry.Key, call, "missed");
                    else if (call.CallerDisconnected < now.AddSeconds(-35) || call.RecipientDisconnected < now.AddSeconds(-35) || now - call.Record.CreatedAt > TimeSpan.FromHours(4)) await FinishAsync(entry.Key, call, "interrupted");
                }
            }
            catch (Exception error) { logger.LogError(error, "Call cleanup failed"); }
            finally { gate.Release(); }
        }
    }
}
