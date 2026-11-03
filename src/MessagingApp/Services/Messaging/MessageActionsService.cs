using MessagingApp.Data;
using MessagingApp.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MessagingApp.Services;

public sealed class MessageActionsService(AppDbContext db, IMessageService messages)
{
    public async Task<Message> RequireMessageAsync(int id, int userId, bool allowDeleted = false, bool allowHidden = false)
    {
        var message = await db.Messages.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id &&
            m.Conversation.Members.Any(member => member.UserId == userId) &&
            (allowHidden || !m.UserStates.Any(s => s.UserId == userId && s.IsHidden)));
        if (message is null || (!allowDeleted && message.IsDeleted)) throw new HubException("This message is no longer available.");
        return message;
    }

    public async Task<int> DeleteForMeAsync(int id, int userId)
    {
        var message = await RequireMessageAsync(id, userId, allowDeleted: true, allowHidden: true);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO `MessageUserStates` (`MessageId`,`UserId`,`IsHidden`,`IsStarred`) VALUES ({id},{userId},1,0) ON DUPLICATE KEY UPDATE `IsHidden`=1;");
        return message.ConversationId;
    }

    public async Task<MessageDto> SetStarAsync(int id, int userId, bool starred)
    {
        await RequireMessageAsync(id, userId);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO `MessageUserStates` (`MessageId`,`UserId`,`IsHidden`,`IsStarred`) VALUES ({id},{userId},0,{starred}) ON DUPLICATE KEY UPDATE `IsStarred`={starred};");
        return (await messages.GetMessageDtoAsync(id, userId))!;
    }

    public async Task<MessageDto> SaveNoteAsync(int id, int userId, string? note)
    {
        await RequireMessageAsync(id, userId);
        note = note?.Trim();
        if (note?.Length > 5000) throw new HubException("Notes can contain up to 5,000 characters.");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO `MessageUserStates` (`MessageId`,`UserId`,`IsHidden`,`IsStarred`,`Note`) VALUES ({id},{userId},0,0,{note}) ON DUPLICATE KEY UPDATE `Note`={note};");
        return (await messages.GetMessageDtoAsync(id, userId))!;
    }

    public async Task<object> GetInfoAsync(int id, int userId)
    {
        var message = await RequireMessageAsync(id, userId, allowDeleted: true);
        var dto = (await messages.GetMessageDtoAsync(id, userId))!;
        var receipts = await db.MessageReads.AsNoTracking().Where(r => r.MessageId == id && r.UserId != message.SenderId &&
            (message.SenderId == userId || r.UserId == userId))
            .OrderBy(r => r.ReadAt).Select(r => new { r.User.DisplayName, r.ReadAt }).ToListAsync();
        var deliveries = await db.MessageDeliveries.AsNoTracking().Where(r => r.MessageId == id &&
            (message.SenderId == userId || r.UserId == userId))
            .OrderBy(r => r.DeliveredAt).Select(r => new { Name = db.Users.Where(u => u.Id == r.UserId).Select(u => u.DisplayName).First(), r.DeliveredAt }).ToListAsync();
        return new
        {
            dto.Id, dto.SenderName, dto.CreatedAt, dto.IsEdited, dto.IsForwarded, dto.Type, dto.AttachmentSize, dto.ReadStatus,
            Message = dto,
            IsMine = message.SenderId == userId,
            DeliveredBy = deliveries.Select(r => new { r.Name, DeliveredAt = DateTime.SpecifyKind(r.DeliveredAt, DateTimeKind.Utc) }),
            ReadBy = receipts.Select(r => new { Name = r.DisplayName, ReadAt = DateTime.SpecifyKind(r.ReadAt, DateTimeKind.Utc) })
        };
    }

    public async Task<List<MessageDto>> SavedMessagesAsync(int userId, bool notes)
    {
        var ids = await db.MessageUserStates.AsNoTracking().Where(s => s.UserId == userId && !s.IsHidden && !s.Message.IsDeleted &&
            s.Message.Conversation.Members.Any(m => m.UserId == userId) && (notes ? s.Note != null && s.Note != "" : s.IsStarred))
            .OrderByDescending(s => s.MessageId).Select(s => s.MessageId).Take(100).ToListAsync();
        return await messages.GetMessagesByIdsAsync(ids.ToArray(), userId);
    }

    public async Task<List<object>> PinsAsync(int conversationId, int userId)
    {
        if (!await db.ConversationMembers.AnyAsync(m => m.UserId == userId && m.ConversationId == conversationId))
            throw new HubException("You are not a member of this conversation.");
        var pins = await db.MessagePins.AsNoTracking().Where(p => p.ConversationId == conversationId && p.ExpiresAt > DateTime.UtcNow && !p.Message.IsDeleted)
            .OrderByDescending(p => p.ExpiresAt).Take(3).ToListAsync();
        var result = new List<object>();
        foreach (var pin in pins)
        {
            var message = await messages.GetMessageDtoAsync(pin.MessageId, userId);
            if (message is not null) result.Add(new { Message = message, ExpiresAt = DateTime.SpecifyKind(pin.ExpiresAt, DateTimeKind.Utc) });
        }
        return result;
    }

    public async Task<int> SetPinAsync(int id, int userId, bool pinned, int hours)
    {
        var message = await RequireMessageAsync(id, userId);
        if (pinned && hours is not (24 or 168 or 720)) throw new HubException("Choose 24 hours, 7 days, or 30 days.");
        await using var transaction = await db.Database.BeginTransactionAsync();
        // Serialize all pins in a conversation, including requests from multiple tabs.
        await db.Conversations.Where(c => c.Id == message.ConversationId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(c => c.UpdatedAt, c => c.UpdatedAt));
        await db.MessagePins.Where(p => p.ExpiresAt <= DateTime.UtcNow).ExecuteDeleteAsync();
        if (!pinned) await db.MessagePins.Where(p => p.MessageId == id).ExecuteDeleteAsync();
        else
        {
            var existing = await db.MessagePins.FirstOrDefaultAsync(p => p.MessageId == id);
            if (existing is null)
            {
                if (await db.MessagePins.CountAsync(p => p.ConversationId == message.ConversationId) >= 3)
                    throw new HubException("This chat already has three pinned messages. Unpin one first.");
                db.MessagePins.Add(new MessagePin { MessageId = id, ConversationId = message.ConversationId, PinnedByUserId = userId, ExpiresAt = DateTime.UtcNow.AddHours(hours) });
            }
            else { existing.ExpiresAt = DateTime.UtcNow.AddHours(hours); existing.PinnedByUserId = userId; }
            await db.SaveChangesAsync();
        }
        await transaction.CommitAsync();
        return message.ConversationId;
    }

    public async Task<List<MessageDto>> ForwardAsync(int id, int userId, int[] conversationIds)
    {
        var source = await RequireMessageAsync(id, userId);
        var ids = conversationIds.Distinct().ToArray();
        if (ids.Length == 0 || ids.Length > 5) throw new HubException("Select up to five chats.");
        var allowed = await db.ConversationMembers.Where(m => m.UserId == userId && ids.Contains(m.ConversationId) &&
            (!m.Conversation.IsAnnouncement || m.IsAdmin)).Select(m => m.ConversationId).ToArrayAsync();
        if (allowed.Length != ids.Length) throw new HubException("You cannot send to one of the selected chats.");
        var result = new List<MessageDto>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        foreach (var target in ids)
            result.Add(await messages.SendMessageAsync(target, userId, source.Content, source.Type,
                source.AttachmentUrl, source.AttachmentName, source.AttachmentSize, null, isForwarded: true));
        await transaction.CommitAsync();
        return result;
    }
}
