using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Models;
using MySql.Data.MySqlClient;

namespace MessagingApp.Services;

public class MessageService : IMessageService
{
    private readonly AppDbContext _context;

    public MessageService(AppDbContext context, IUserPresenceService presenceService)
    {
        _context = context;
    }

    public async Task<List<MessageDto>> GetMessagesAsync(int conversationId, int currentUserId, int limit = 50, int? beforeMessageId = null)
    {
        var query = VisibleMessages(currentUserId).Where(m => m.ConversationId == conversationId);
        if (beforeMessageId.HasValue)
            query = query.Where(m => m.Id < beforeMessageId.Value);

        var messages = await LoadMessageDtosAsync(query.OrderByDescending(m => m.Id)
            .Take(Math.Clamp(limit, 1, 100)), currentUserId);
        messages.Reverse();
        return messages;
    }

    public async Task<MessageDto> SendMessageAsync(
        int conversationId, int senderId, string? content, MessageType type = MessageType.Text,
        string? attachmentUrl = null, string? attachmentName = null, long? attachmentSize = null, int? replyToMessageId = null, bool isForwarded = false)
    {
        var now = DateTime.UtcNow;
        var announcement = await _context.Conversations.AnyAsync(c => c.Id == conversationId && c.IsAnnouncement);
        if (announcement && !await _context.ConversationMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == senderId && m.IsAdmin))
            throw new Microsoft.AspNetCore.SignalR.HubException("Only community admins can post announcements.");
        if (content?.Length > 10000) throw new Microsoft.AspNetCore.SignalR.HubException("Messages can contain up to 10,000 characters.");
        if (replyToMessageId.HasValue && !await VisibleMessages(senderId).AnyAsync(m => m.Id == replyToMessageId && m.ConversationId == conversationId && !m.IsDeleted))
            throw new Microsoft.AspNetCore.SignalR.HubException("The reply must belong to this conversation.");
        if (attachmentUrl != null && (!System.Text.RegularExpressions.Regex.IsMatch(attachmentUrl, @"^/uploads/[a-f0-9]{32}\.[a-z0-9]+$") ||
            attachmentName?.Length > 255 || attachmentSize is < 1 or > 15728640))
            throw new Microsoft.AspNetCore.SignalR.HubException("Invalid attachment.");
        if (type == MessageType.Voice)
        {
            if (!VoiceMessageMetadata.IsAudioPath(attachmentUrl) || attachmentSize is null ||
                !VoiceMessageMetadata.TryParse(content, out var metadata))
                throw new Microsoft.AspNetCore.SignalR.HubException("Invalid voice message. Record between half a second and ten minutes.");
            content = System.Text.Json.JsonSerializer.Serialize(metadata);
        }
        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = senderId,
            Content = content?.Trim(),
            Type = type,
            IsForwarded = isForwarded,
            AttachmentUrl = attachmentUrl,
            AttachmentName = attachmentName,
            AttachmentSize = attachmentSize,
            ReplyToMessageId = replyToMessageId,
            CreatedAt = now,
            UpdatedAt = now
        };

        _context.Messages.Add(message);

        // Update conversation UpdatedAt
        var conv = await _context.Conversations.FindAsync(conversationId);
        if (conv != null)
        {
            conv.UpdatedAt = now;
        }

        // Sender automatically has read their own message
        var member = await _context.ConversationMembers
            .FirstOrDefaultAsync(cm => cm.ConversationId == conversationId && cm.UserId == senderId);
        if (member != null)
        {
            member.LastReadAt = now;
        }

        await _context.SaveChangesAsync();

        return await GetMessageDtoAsync(message.Id, senderId)
            ?? throw new InvalidOperationException("The saved message could not be loaded.");
    }

    public Task<List<MessageDto>> GetUndeliveredMessagesAsync(int userId) => LoadMessageDtosAsync(
        VisibleMessages(userId).Where(m => m.SenderId != userId && !m.IsDeleted &&
            m.Conversation.Members.Any(member => member.UserId == userId) && !m.Deliveries.Any(r => r.UserId == userId))
            .OrderBy(m => m.Id).Take(100), userId);

    public async Task<List<DeliveryReceiptDto>> MarkMessagesDeliveredAsync(int[] messageIds, int userId)
    {
        if (messageIds is null || messageIds.Length > 100) throw new Microsoft.AspNetCore.SignalR.HubException("Acknowledge up to 100 messages at a time.");
        var ids = messageIds.Where(id => id > 0).Distinct().ToArray();
        if (ids.Length == 0) return [];
        var parameters = new List<object> { new MySqlParameter("@recipient", userId), new MySqlParameter("@at", DateTime.UtcNow) };
        for (var i = 0; i < ids.Length; i++) parameters.Add(new MySqlParameter("@id" + i, ids[i]));
        var placeholders = string.Join(",", Enumerable.Range(0, ids.Length).Select(i => "@id" + i));
        // Only parameter names are composed; IDs and account data remain SQL parameters.
        var sql = "INSERT IGNORE INTO `MessageDeliveries` (`MessageId`,`UserId`,`DeliveredAt`) " +
            "SELECT m.`Id`,@recipient,@at FROM `Messages` m JOIN `ConversationMembers` cm ON cm.`ConversationId`=m.`ConversationId` AND cm.`UserId`=@recipient " +
            "WHERE m.`Id` IN (" + placeholders + ") AND m.`SenderId`<>@recipient AND m.`IsDeleted`=0 " +
            "AND NOT EXISTS (SELECT 1 FROM `MessageUserStates` s WHERE s.`MessageId`=m.`Id` AND s.`UserId`=@recipient AND s.`IsHidden`=1)";
        await _context.Database.ExecuteSqlRawAsync(sql, parameters);
        var rows = await _context.MessageDeliveries.AsNoTracking().Where(r => r.UserId == userId && ids.Contains(r.MessageId) &&
            r.Message.Conversation.Members.Any(m => m.UserId == userId) && !r.Message.UserStates.Any(s => s.UserId == userId && s.IsHidden))
            .Select(r => new DeliveryReceiptDto { MessageId = r.MessageId, ConversationId = r.Message.ConversationId,
                SenderId = r.Message.SenderId, DeliveredAt = r.DeliveredAt }).ToListAsync();
        rows.ForEach(row => row.DeliveredAt = DateTime.SpecifyKind(row.DeliveredAt, DateTimeKind.Utc));
        return rows;
    }

    public async Task<List<int>> MarkConversationAsReadAsync(int conversationId, int userId)
    {
        var now = DateTime.UtcNow;
        // Lock the membership so simultaneous tabs cannot insert duplicate receipts.
        await using var transaction = await _context.Database.BeginTransactionAsync();
        await _context.ConversationMembers.Where(m => m.ConversationId == conversationId && m.UserId == userId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(m => m.LastReadAt, now));
        var lastMessageId = await VisibleMessages(userId).Where(m => m.ConversationId == conversationId)
            .Select(m => (int?)m.Id).MaxAsync();
        var unreadMessages = await VisibleMessages(userId)
            .Where(m => m.ConversationId == conversationId && m.Id <= lastMessageId && !m.IsDeleted && m.SenderId != userId && !m.Reads.Any(r => r.UserId == userId))
            .ToListAsync();

        var readMessageIds = new List<int>();

        foreach (var msg in unreadMessages)
        {
            _context.MessageReads.Add(new MessageRead
            {
                MessageId = msg.Id,
                UserId = userId,
                ReadAt = now
            });
            readMessageIds.Add(msg.Id);
        }

        var member = await _context.ConversationMembers
            .FirstOrDefaultAsync(cm => cm.ConversationId == conversationId && cm.UserId == userId);

        if (member != null && lastMessageId.HasValue)
        {
            member.LastReadMessageId = Math.Max(member.LastReadMessageId ?? 0, lastMessageId.Value);
            member.LastReadAt = now;
        }

        await _context.Database.ExecuteSqlInterpolatedAsync($@"INSERT IGNORE INTO `MessageDeliveries` (`MessageId`,`UserId`,`DeliveredAt`)
            SELECT m.`Id`,{userId},{now} FROM `Messages` m
            WHERE m.`ConversationId`={conversationId} AND m.`Id`<={lastMessageId} AND m.`SenderId`<>{userId} AND m.`IsDeleted`=0
            AND EXISTS (SELECT 1 FROM `ConversationMembers` cm WHERE cm.`ConversationId`=m.`ConversationId` AND cm.`UserId`={userId})
            AND NOT EXISTS (SELECT 1 FROM `MessageUserStates` s WHERE s.`MessageId`=m.`Id` AND s.`UserId`={userId} AND s.`IsHidden`=1)");
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        return readMessageIds;
    }

    public async Task<(bool Success, MessageDto? Message, string? Error)> ToggleReactionAsync(int messageId, int userId, string emoji)
    {
        if (!EmojiReaction.IsValid(emoji)) return (false, null, "Invalid reaction.");
        await using var transaction = await _context.Database.BeginTransactionAsync();
        // Serialize toggles from multiple tabs before reading this person's reaction.
        await _context.Messages.Where(m => m.Id == messageId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(m => m.UpdatedAt, m => m.UpdatedAt));
        var message = await _context.Messages
            .Where(m => !m.UserStates.Any(s => s.UserId == userId && s.IsHidden))
            .Include(m => m.Conversation)
                .ThenInclude(c => c.Members)
            .FirstOrDefaultAsync(m => m.Id == messageId);

        if (message == null) return (false, null, "Message not found.");

        if (message.IsDeleted)
            return (false, null, "Invalid reaction.");

        if (!message.Conversation.Members.Any(cm => cm.UserId == userId))
        {
            return (false, null, "Unauthorized.");
        }

        var existingReaction = await _context.MessageReactions
            .FirstOrDefaultAsync(r => r.MessageId == messageId && r.UserId == userId);

        if (existingReaction?.Emoji == emoji)
        {
            _context.MessageReactions.Remove(existingReaction!);
        }
        else if (existingReaction is not null)
        {
            existingReaction.Emoji = emoji;
            existingReaction.CreatedAt = DateTime.UtcNow;
        }
        else
        {
            _context.MessageReactions.Add(new MessageReaction
            {
                MessageId = messageId,
                UserId = userId,
                Emoji = emoji,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync();
        await transaction.CommitAsync();

        var dto = await GetMessageDtoAsync(messageId, userId);
        return (true, dto, null);
    }

    public async Task<(bool Success, MessageDto? Message, string? Error)> EditMessageAsync(int messageId, int userId, string newContent)
    {
        if (string.IsNullOrWhiteSpace(newContent) || newContent.Length > 10000) return (false, null, "Enter between 1 and 10,000 characters.");
        var message = await VisibleMessages(userId).FirstOrDefaultAsync(m => m.Id == messageId && m.Conversation.Members.Any(member => member.UserId == userId));
        if (message == null) return (false, null, "Message not found.");

        if (message.SenderId != userId) return (false, null, "You can only edit your own messages.");
        if (message.IsDeleted) return (false, null, "Cannot edit a deleted message.");
        if (message.Type == MessageType.Voice) return (false, null, "Voice messages cannot be edited.");
        var now = DateTime.UtcNow;
        var cutoff = now.AddMinutes(-15);
        // Check the original send time in the write itself, including an editor left open past expiry.
        var changed = await _context.Database.ExecuteSqlInterpolatedAsync($@"UPDATE `Messages` m
            SET m.`Content`={newContent.Trim()},m.`IsEdited`=1,m.`UpdatedAt`={now}
            WHERE m.`Id`={messageId} AND m.`SenderId`={userId} AND m.`IsDeleted`=0 AND m.`CreatedAt`>{cutoff}
            AND EXISTS (SELECT 1 FROM `ConversationMembers` cm WHERE cm.`ConversationId`=m.`ConversationId` AND cm.`UserId`={userId})
            AND NOT EXISTS (SELECT 1 FROM `MessageUserStates` s WHERE s.`MessageId`=m.`Id` AND s.`UserId`={userId} AND s.`IsHidden`=1)");
        if (changed == 0) return (false, null, "Messages can only be edited within 15 minutes of being sent.");

        var dto = await GetMessageDtoAsync(messageId, userId);
        return (true, dto, null);
    }

    public async Task<(bool Success, MessageDto? Message, string? Error)> DeleteMessageAsync(int messageId, int userId)
    {
        var message = await _context.Messages.FirstOrDefaultAsync(m => m.Id == messageId && m.Conversation.Members.Any(member => member.UserId == userId));
        if (message == null) return (false, null, "Message not found.");

        if (message.SenderId != userId && !await _context.ConversationMembers.AnyAsync(member => member.ConversationId == message.ConversationId && member.UserId == userId && member.IsAdmin && member.Conversation.IsGroup))
            return (false, null, "Only the sender or a group admin can delete for everyone.");

        message.IsDeleted = true;
        message.Content = null;
        message.AttachmentUrl = null;
        message.AttachmentName = null;
        message.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        await _context.MessagePins.Where(p => p.MessageId == messageId).ExecuteDeleteAsync();
        var dto = (await LoadMessageDtosAsync(_context.Messages.Where(m => m.Id == messageId), userId)).FirstOrDefault();
        return (true, dto, null);
    }

    public Task<List<MessageDto>> SearchMessagesAsync(int conversationId, int userId, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return Task.FromResult(new List<MessageDto>());
        var q = query.Trim().ToLowerInvariant();
        return LoadMessageDtosAsync(VisibleMessages(userId)
            .Where(m => m.ConversationId == conversationId && !m.IsDeleted && m.Content != null && m.Content.ToLower().Contains(q))
            .OrderByDescending(m => m.CreatedAt).Take(30), userId);
    }

    public async Task<MessageDto?> GetMessageDtoAsync(int messageId, int currentUserId)
        => (await LoadMessageDtosAsync(VisibleMessages(currentUserId).Where(m => m.Id == messageId), currentUserId)).FirstOrDefault();

    public Task<List<MessageDto>> GetMessagesByIdsAsync(int[] messageIds, int currentUserId)
    {
        var ids = messageIds.Distinct().Take(100).ToArray();
        return LoadMessageDtosAsync(VisibleMessages(currentUserId).Where(m => ids.Contains(m.Id) &&
            m.Conversation.Members.Any(member => member.UserId == currentUserId)).OrderByDescending(m => m.Id), currentUserId);
    }

    private IQueryable<Message> VisibleMessages(int userId) => _context.Messages
        .Where(m => !m.UserStates.Any(s => s.UserId == userId && s.IsHidden));

    private async Task<List<MessageDto>> LoadMessageDtosAsync(IQueryable<Message> query, int currentUserId)
    {
        // Reactions are the only joined collection. Read state uses EXISTS and online
        // membership checks, avoiding three additional queries and repeated user/receipt data.
        var snapshots = await query.AsNoTracking().AsSingleQuery().Select(m => new MessageSnapshot
        {
            Data = new MessageDto
            {
                Id = m.Id,
                ConversationId = m.ConversationId,
                SenderId = m.SenderId,
                SenderName = m.Sender.DisplayName,
                Content = m.IsDeleted ? null : m.Content,
                Type = m.Type,
                AttachmentUrl = m.IsDeleted ? null : m.AttachmentUrl,
                AttachmentName = m.IsDeleted ? null : m.AttachmentName,
                AttachmentSize = m.IsDeleted ? null : m.AttachmentSize,
                ReplyTo = m.ReplyToMessage == null ? null : new ReplyDto
                {
                    Id = m.ReplyToMessage.Id,
                    SenderName = m.ReplyToMessage.Sender.DisplayName,
                    Content = m.ReplyToMessage.UserStates.Any(s => s.UserId == currentUserId && s.IsHidden) ? "Message unavailable" :
                        m.ReplyToMessage.IsDeleted ? "This message was deleted" : m.ReplyToMessage.Content,
                    Type = m.ReplyToMessage.Type
                },
                IsEdited = m.IsEdited,
                IsDeleted = m.IsDeleted,
                IsForwarded = m.IsForwarded,
                IsStarred = m.UserStates.Any(s => s.UserId == currentUserId && s.IsStarred),
                Note = m.UserStates.Where(s => s.UserId == currentUserId).Select(s => s.Note).FirstOrDefault(),
                IsPinned = _context.MessagePins.Any(p => p.MessageId == m.Id && p.ExpiresAt > DateTime.UtcNow) && !m.IsDeleted,
                CanDeleteForEveryone = !m.IsDeleted && (m.SenderId == currentUserId || m.Conversation.IsGroup && m.Conversation.Members.Any(member => member.UserId == currentUserId && member.IsAdmin)),
                CreatedAt = m.CreatedAt,
                IsMine = m.SenderId == currentUserId,
                ReadStatus = m.Reads.Any(r => r.UserId != m.SenderId) ? "read" :
                    m.Deliveries.Any(r => r.UserId != m.SenderId)
                        ? "delivered" : "sent"
            },
            Sender = new User
            {
                Id = m.SenderId,
                DisplayName = m.Sender.DisplayName,
                AvatarUrl = m.Sender.AvatarUrl,
                AvatarColor = m.Sender.AvatarColor
            },
            Reactions = m.Reactions.Select(r => new ReactionSnapshot
            {
                Emoji = r.Emoji,
                UserId = r.UserId,
                UserName = r.User.DisplayName
            }).ToList()
        }).ToListAsync();

        return snapshots.Select(snapshot =>
        {
            var message = snapshot.Data;
            message.CreatedAt = DateTime.SpecifyKind(message.CreatedAt, DateTimeKind.Utc);
            message.SenderAvatarUrl = AvatarAppearance.ForUser(snapshot.Sender);
            message.Reactions = snapshot.Reactions.GroupBy(r => r.Emoji).Select(group => new ReactionSummaryDto
            {
                Emoji = group.Key,
                Count = group.Count(),
                HasReacted = group.Any(r => r.UserId == currentUserId),
                UserNames = group.Select(r => r.UserName).ToList(),
                UserIds = group.Select(r => r.UserId).ToList()
            }).ToList();
            return message;
        }).ToList();
    }

    private sealed class MessageSnapshot
    {
        public MessageDto Data { get; set; } = null!;
        public User Sender { get; set; } = null!;
        public List<ReactionSnapshot> Reactions { get; set; } = [];
    }

    private sealed class ReactionSnapshot
    {
        public string Emoji { get; set; } = "";
        public int UserId { get; set; }
        public string UserName { get; set; } = "";
    }
}
