using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using MessagingApp.Data;
using MessagingApp.Models;
using MessagingApp.Services;
using Microsoft.EntityFrameworkCore;

namespace MessagingApp.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly IUserPresenceService _presenceService;
    private readonly IConversationService _conversationService;
    private readonly IMessageService _messageService;
    private readonly AppDbContext _context;
    private readonly WebPushService _push;
    private readonly CallService _calls;
    private readonly MessageActionsService _actions;

    public ChatHub(
        IUserPresenceService presenceService,
        IConversationService conversationService,
        IMessageService messageService,
        AppDbContext context, WebPushService push, CallService calls, MessageActionsService actions)
    {
        _presenceService = presenceService;
        _conversationService = conversationService;
        _messageService = messageService;
        _context = context;
        _push = push;
        _calls = calls;
        _actions = actions;
    }

    private int CurrentUserId => int.Parse(Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? "0");
    private string CurrentUserName => Context.User?.Identity?.Name ?? "User";

    public override async Task OnConnectedAsync()
    {
        var userId = CurrentUserId;
        if (userId > 0)
        {
            _presenceService.AddConnection(userId, Context.ConnectionId);

            // Join all conversation groups the user is a member of
            var conversations = await _context.ConversationMembers.Where(m => m.UserId == userId).Select(m => m.ConversationId).ToListAsync();
            foreach (var conv in conversations)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"conv-{conv}");
            }

            // Broadcast online status to all
            await Clients.Others.SendAsync("UserPresenceChanged", new
            {
                UserId = userId,
                IsOnline = true,
                LastSeenAt = DateTime.UtcNow
            });
        }

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await _calls.DisconnectedAsync(Context.ConnectionId);
        var userId = CurrentUserId;
        if (userId > 0)
        {
            _presenceService.RemoveConnection(userId, Context.ConnectionId);

            if (!_presenceService.IsUserOnline(userId))
            {
                var now = DateTime.UtcNow;
                var user = await _context.Users.FindAsync(userId);
                if (user != null)
                {
                    user.LastSeenAt = now;
                    await _context.SaveChangesAsync();
                }

                await Clients.Others.SendAsync("UserPresenceChanged", new
                {
                    UserId = userId,
                    IsOnline = false,
                    LastSeenAt = now
                });
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    public Task<CallInfo> StartCall(int conversationId, bool video) => _calls.StartAsync(CurrentUserId, Context.ConnectionId, conversationId, video);
    public Task AcceptCall(string id) => _calls.AcceptAsync(CurrentUserId, Context.ConnectionId, id);
    public Task CallSignal(string id, string kind, string payload) => _calls.SignalAsync(CurrentUserId, Context.ConnectionId, id, kind, payload);
    public Task EndCall(string id, string reason) => _calls.EndAsync(CurrentUserId, id, reason);
    public Task<CallInfo?> PendingCall() => _calls.PendingAsync(CurrentUserId);
    public Task ResumeCall(string id) => _calls.ResumeAsync(CurrentUserId, Context.ConnectionId, id);

    public async Task JoinConversation(int conversationId)
    {
        var userId = CurrentUserId;
        if (await _conversationService.IsUserMemberAsync(conversationId, userId))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"conv-{conversationId}");
        }
    }

    public async Task SendMessage(
        int conversationId, string? content, string messageTypeStr,
        string? attachmentUrl, string? attachmentName, long? attachmentSize, int? replyToMessageId)
    {
        var userId = CurrentUserId;
        if (!await _conversationService.IsUserMemberAsync(conversationId, userId))
        {
            throw new HubException("You are not a member of this conversation.");
        }

        if (string.IsNullOrWhiteSpace(content) && string.IsNullOrEmpty(attachmentUrl))
        {
            throw new HubException("Message must contain text or attachment.");
        }

        if (!Enum.TryParse<MessageType>(messageTypeStr, true, out var messageType) || !Enum.IsDefined(messageType))
            throw new HubException("Unsupported message type.");

        var message = await _messageService.SendMessageAsync(
            conversationId, userId, content, messageType, attachmentUrl, attachmentName, attachmentSize, replyToMessageId);

        // Broadcast message to conversation group
        await BroadcastMessageAsync("ReceiveMessage", message);

        // Also notify members so conversation list order and previews update
        var updates = await _conversationService.GetConversationUpdatesAsync(conversationId);
        _push.Enqueue(message.Id, updates.Keys.Where(id => id != userId));
        foreach (var update in updates)
            await Clients.User(update.Key.ToString()).SendAsync("ConversationUpdated", update.Value);
    }

    public Task<List<MessageDto>> GetUndeliveredMessages() => _messageService.GetUndeliveredMessagesAsync(CurrentUserId);

    public async Task MarkMessagesDelivered(int[] messageIds)
    {
        var receipts = await _messageService.MarkMessagesDeliveredAsync(messageIds, CurrentUserId);
        foreach (var group in receipts.GroupBy(r => new { r.ConversationId, r.SenderId }))
            await Clients.User(group.Key.SenderId.ToString()).SendAsync("MessagesDelivered", new
            {
                group.Key.ConversationId, MessageIds = group.Select(r => r.MessageId).ToArray()
            });
    }

    public async Task SendTyping(int conversationId, bool isTyping)
    {
        var userId = CurrentUserId;
        if (await _conversationService.IsUserMemberAsync(conversationId, userId))
        {
            await Clients.OthersInGroup($"conv-{conversationId}").SendAsync("UserTyping", new
            {
                ConversationId = conversationId,
                UserId = userId,
                DisplayName = Context.User?.FindFirstValue("DisplayName") ?? CurrentUserName,
                IsTyping = isTyping
            });
        }
    }

    public async Task MarkMessagesAsRead(int conversationId)
    {
        var userId = CurrentUserId;
        if (await _conversationService.IsUserMemberAsync(conversationId, userId))
        {
            var readMessageIds = await _messageService.MarkConversationAsReadAsync(conversationId, userId);
            if (readMessageIds.Count > 0)
            {
                await Clients.Group($"conv-{conversationId}").SendAsync("MessagesRead", new
                {
                    ConversationId = conversationId,
                    ReaderId = userId,
                    MessageIds = readMessageIds
                });
            }
            var details = await _conversationService.GetConversationDetailsAsync(conversationId, userId);
            if (details != null) await Clients.User(userId.ToString()).SendAsync("ConversationUpdated", details);
        }
    }

    public async Task SendReaction(int messageId, string emoji)
    {
        var userId = CurrentUserId;
        var (success, message, error) = await _messageService.ToggleReactionAsync(messageId, userId, emoji);
        if (!success) throw new HubException(error);
        if (success && message != null)
        {
            await BroadcastMessageAsync("MessageReactionUpdated", message);
        }
    }

    public async Task EditMessage(int messageId, string newContent)
    {
        var userId = CurrentUserId;
        var (success, message, error) = await _messageService.EditMessageAsync(messageId, userId, newContent);
        if (!success)
        {
            throw new HubException(error ?? "Failed to edit message.");
        }

        if (message != null)
        {
            await BroadcastMessageAsync("MessageEdited", message);
            await BroadcastConversationUpdatesAsync(message.ConversationId);
        }
    }

    public async Task DeleteMessage(int messageId)
    {
        var userId = CurrentUserId;
        var (success, message, error) = await _messageService.DeleteMessageAsync(messageId, userId);
        if (!success)
        {
            throw new HubException(error ?? "Failed to delete message.");
        }

        if (message != null)
        {
            await BroadcastMessageAsync("MessageDeleted", message);
            await Clients.Group($"conv-{message.ConversationId}").SendAsync("MessagePinsChanged", new { message.ConversationId });
            await BroadcastConversationUpdatesAsync(message.ConversationId);
        }
    }

    private async Task BroadcastMessageAsync(string eventName, MessageDto message)
    {
        var members = await _context.ConversationMembers.AsNoTracking().Where(m => m.ConversationId == message.ConversationId)
            .Select(m => new { m.UserId, IsAdmin = m.IsAdmin && m.Conversation.IsGroup }).ToListAsync();
        var states = eventName == "ReceiveMessage" ? new Dictionary<int, MessageUserState>() :
            await _context.MessageUserStates.AsNoTracking().Where(s => s.MessageId == message.Id).ToDictionaryAsync(s => s.UserId);
        var quote = message.ReplyTo is null ? null : await _context.Messages.AsNoTracking()
            .Where(m => m.Id == message.ReplyTo.Id)
            .Select(m => new { m.Id, SenderName = m.Sender.DisplayName, m.Content, m.Type, m.IsDeleted }).FirstOrDefaultAsync();
        var hiddenQuotes = quote is null ? new HashSet<int>() : (await _context.MessageUserStates.AsNoTracking()
            .Where(s => s.MessageId == quote.Id && s.IsHidden).Select(s => s.UserId).ToListAsync()).ToHashSet();
        foreach (var member in members)
        {
            var state = states.GetValueOrDefault(member.UserId);
            if (state?.IsHidden != true)
            {
                var personalized = message.ForUser(member.UserId, state, member.IsAdmin);
                if (quote is not null) personalized.ReplyTo = new ReplyDto
                {
                    Id = quote.Id, SenderName = quote.SenderName, Type = quote.Type,
                    Content = hiddenQuotes.Contains(member.UserId) ? "Message unavailable" :
                        quote.IsDeleted ? "This message was deleted" : quote.Content
                };
                await Clients.User(member.UserId.ToString()).SendAsync(eventName, personalized);
            }
        }
    }

    public Task<object> GetMessageInfo(int messageId) => _actions.GetInfoAsync(messageId, CurrentUserId);
    public Task<List<MessageDto>> GetSavedMessages(bool notes) => _actions.SavedMessagesAsync(CurrentUserId, notes);
    public Task<List<object>> GetPinnedMessages(int conversationId) => _actions.PinsAsync(conversationId, CurrentUserId);

    public async Task DeleteMessageForMe(int messageId)
    {
        var conversationId = await _actions.DeleteForMeAsync(messageId, CurrentUserId);
        await Clients.User(CurrentUserId.ToString()).SendAsync("MessageHidden", new { MessageId = messageId, ConversationId = conversationId });
        var details = await _conversationService.GetConversationDetailsAsync(conversationId, CurrentUserId);
        if (details is not null) await Clients.User(CurrentUserId.ToString()).SendAsync("ConversationUpdated", details);
    }

    public async Task SetMessageStar(int messageId, bool starred)
        => await Clients.User(CurrentUserId.ToString()).SendAsync("MessagePersonalStateChanged", await _actions.SetStarAsync(messageId, CurrentUserId, starred));

    public async Task SaveMessageNote(int messageId, string? note)
        => await Clients.User(CurrentUserId.ToString()).SendAsync("MessagePersonalStateChanged", await _actions.SaveNoteAsync(messageId, CurrentUserId, note));

    public async Task SetMessagePin(int messageId, bool pinned, int hours)
    {
        var conversationId = await _actions.SetPinAsync(messageId, CurrentUserId, pinned, hours);
        await Clients.Group($"conv-{conversationId}").SendAsync("MessagePinsChanged", new { ConversationId = conversationId, MessageId = messageId, IsPinned = pinned });
    }

    public async Task ForwardMessage(int messageId, int[] conversationIds)
    {
        var forwarded = await _actions.ForwardAsync(messageId, CurrentUserId, conversationIds);
        foreach (var message in forwarded)
        {
            await BroadcastMessageAsync("ReceiveMessage", message);
            var updates = await _conversationService.GetConversationUpdatesAsync(message.ConversationId);
            _push.Enqueue(message.Id, updates.Keys.Where(id => id != CurrentUserId));
            foreach (var update in updates)
                await Clients.User(update.Key.ToString()).SendAsync("ConversationUpdated", update.Value);
        }
    }

    private async Task BroadcastConversationUpdatesAsync(int conversationId)
    {
        var updates = await _conversationService.GetConversationUpdatesAsync(conversationId);
        foreach (var update in updates)
            await Clients.User(update.Key.ToString()).SendAsync("ConversationUpdated", update.Value);
    }
}
