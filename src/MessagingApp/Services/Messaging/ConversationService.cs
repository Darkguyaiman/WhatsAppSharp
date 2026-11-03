using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Models;

namespace MessagingApp.Services;

public class ConversationService : IConversationService
{
    private readonly AppDbContext _context;
    private readonly IUserPresenceService _presenceService;

    public ConversationService(AppDbContext context, IUserPresenceService presenceService)
    {
        _context = context;
        _presenceService = presenceService;
    }

    public Task<List<ConversationDto>> GetUserConversationsAsync(int userId, string? search = null)
        => LoadConversationsAsync(userId, null, search);

    public async Task<ConversationDto?> GetConversationDetailsAsync(int conversationId, int currentUserId)
        => (await LoadConversationsAsync(currentUserId, conversationId, null)).FirstOrDefault();

    public async Task<Dictionary<int, ConversationDto>> GetConversationUpdatesAsync(int conversationId)
    {
        var conv = await _context.Conversations.AsNoTracking().Where(c => c.Id == conversationId)
            .Include(c => c.Members).ThenInclude(m => m.User).AsSingleQuery().FirstOrDefaultAsync();
        if (conv == null) return new();
        var previews = await _context.ConversationMembers.AsNoTracking().Where(m => m.ConversationId == conversationId)
            .Select(member => new
            {
                member.UserId,
                LastId = _context.Messages.Where(m => m.ConversationId == conversationId &&
                    !m.UserStates.Any(s => s.UserId == member.UserId && s.IsHidden)).Max(m => (int?)m.Id),
                Unread = _context.Messages.Count(m => m.ConversationId == conversationId && m.SenderId != member.UserId && !m.IsDeleted &&
                    !m.UserStates.Any(s => s.UserId == member.UserId && s.IsHidden) && !m.Reads.Any(r => r.UserId == member.UserId))
            }).ToListAsync();
        var ids = previews.Where(p => p.LastId.HasValue).Select(p => p.LastId!.Value).Distinct().ToArray();
        var lastMessages = await _context.Messages.AsNoTracking().Where(m => ids.Contains(m.Id)).ToDictionaryAsync(m => m.Id);
        return previews.ToDictionary(p => p.UserId, p => MapConversation(conv, p.UserId, p.Unread,
            p.LastId.HasValue ? lastMessages.GetValueOrDefault(p.LastId.Value) : null));
    }

    private async Task<List<ConversationDto>> LoadConversationsAsync(int userId, int? conversationId, string? search)
    {
        var query = _context.Conversations.AsNoTracking()
            .Where(c => c.Members.Any(m => m.UserId == userId));
        if (conversationId.HasValue) query = query.Where(c => c.Id == conversationId.Value);

        // Fetch one preview per conversation, never the entire history.
        var conversations = await query
            .Include(c => c.Members).ThenInclude(m => m.User)
            .Include(c => c.Messages.Where(m => !m.UserStates.Any(s => s.UserId == userId && s.IsHidden)).OrderByDescending(msg => msg.Id).Take(1))
            // Only one message per conversation: joining members cannot multiply message history.
            .AsSingleQuery().ToListAsync();
        var ids = conversations.Select(c => c.Id).ToArray();
        var unread = await _context.Messages.AsNoTracking()
            .Where(m => ids.Contains(m.ConversationId) && m.SenderId != userId && !m.IsDeleted && !m.UserStates.Any(s => s.UserId == userId && s.IsHidden) &&
                !m.Reads.Any(r => r.UserId == userId))
            .GroupBy(m => m.ConversationId)
            .Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Id, g => g.Count);

        var result = conversations.Select(conv => MapConversation(conv, userId, unread.GetValueOrDefault(conv.Id), conv.Messages.FirstOrDefault()));
        if (!string.IsNullOrWhiteSpace(search))
            result = result.Where(c => c.Title.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase) ||
                c.LastMessageContent?.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase) == true);
        return result.OrderByDescending(c => c.LastMessageTimestamp).ToList();
    }

    private ConversationDto MapConversation(Conversation conv, int userId, int unreadCount, Message? last)
    {
        var other = conv.Members.FirstOrDefault(m => m.UserId != userId);
        return new ConversationDto
        {
            MemberNames = conv.IsGroup ? string.Join(", ", conv.Members.OrderBy(m => m.UserId).Select(m => m.User.DisplayName)) : string.Empty,
            Id = conv.Id,
            Title = conv.IsGroup ? conv.Title ?? "Group chat" : other?.User.DisplayName ?? "Saved messages",
            IsGroup = conv.IsGroup,
            AvatarUrl = conv.IsGroup ? AvatarAppearance.ForGroup(conv.AvatarColor) : AvatarAppearance.ForUser(other?.User ?? conv.Members.FirstOrDefault(m => m.UserId == userId)?.User),
            OtherUserId = conv.IsGroup ? null : other?.UserId,
            OtherUserAbout = conv.IsGroup ? null : other?.User.About,
            IsOnline = !conv.IsGroup && other != null && _presenceService.IsUserOnline(other.UserId),
            LastMessageContent = last?.IsDeleted == true ? "This message was deleted" : last?.Content,
            LastMessageTimestamp = DateTime.SpecifyKind(last?.CreatedAt ?? conv.UpdatedAt, DateTimeKind.Utc),
            LastMessageType = last?.Type,
            LastMessageSenderId = last?.SenderId,
            LastMessageIsRead = last != null && conv.Members.Any(m => m.UserId != last.SenderId && m.LastReadMessageId >= last.Id),
            UnreadCount = unreadCount
        };
    }

    public async Task<ConversationDto> GetOrCreateDirectConversationAsync(int currentUserId, int targetUserId)
    {
        // Serialize creation for this pair so simultaneous tabs reuse one direct chat.
        await using var transaction = await _context.Database.BeginTransactionAsync();
        var lockUserId = Math.Min(currentUserId, targetUserId);
        await _context.Users.Where(u => u.Id == lockUserId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(u => u.LastSeenAt, u => u.LastSeenAt));
        // Check if direct conversation already exists between currentUserId and targetUserId
        var existingConv = await _context.Conversations
            .Where(c => !c.IsGroup && c.Members.Count == 2)
            .Where(c => c.Members.Any(m => m.UserId == currentUserId) && c.Members.Any(m => m.UserId == targetUserId))
            .Select(c => c.Id)
            .FirstOrDefaultAsync();

        if (existingConv != 0)
        {
            await transaction.CommitAsync();
            return (await GetConversationDetailsAsync(existingConv, currentUserId))!;
        }

        // Create new direct conversation
        var now = DateTime.UtcNow;
        var newConv = new Conversation
        {
            IsGroup = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        newConv.Members.Add(new ConversationMember { UserId = currentUserId, JoinedAt = now });
        newConv.Members.Add(new ConversationMember { UserId = targetUserId, JoinedAt = now });
        _context.Conversations.Add(newConv);
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();

        return (await GetConversationDetailsAsync(newConv.Id, currentUserId))!;
    }

    public async Task<ConversationDto> CreateGroupConversationAsync(int currentUserId, string title, List<int> memberIds)
    {
        var now = DateTime.UtcNow;
        var group = new Conversation
        {
            Title = string.IsNullOrWhiteSpace(title) ? "New Group" : title.Trim(),
            IsGroup = true,
            CreatedAt = now,
            UpdatedAt = now
        };
        _context.Conversations.Add(group);

        var membersToAdd = new HashSet<int>(memberIds) { currentUserId };
        foreach (var mId in membersToAdd)
        {
            group.Members.Add(new ConversationMember
            {
                UserId = mId,
                JoinedAt = now,
                IsAdmin = mId == currentUserId
            });
        }
        await _context.SaveChangesAsync();

        return (await GetConversationDetailsAsync(group.Id, currentUserId))!;
    }

    public async Task<bool> IsUserMemberAsync(int conversationId, int userId)
    {
        return await _context.ConversationMembers.AnyAsync(cm => cm.ConversationId == conversationId && cm.UserId == userId);
    }

    public async Task<List<int>> GetConversationMemberUserIdsAsync(int conversationId)
    {
        return await _context.ConversationMembers
            .Where(cm => cm.ConversationId == conversationId)
            .Select(cm => cm.UserId)
            .ToListAsync();
    }

    public async Task<List<UserDto>> SearchContactsAsync(int currentUserId, string query)
    {
        var q = query.Trim().ToLowerInvariant();
        // Search only people you've already shared a chat with. New people go through Add contact (exact username).
        var known = _context.Users.AsNoTracking()
            .Where(u => u.Id != currentUserId && u.Memberships.Any(m =>
                m.Conversation.Members.Any(other => other.UserId == currentUserId)));

        if (!string.IsNullOrEmpty(q))
            known = known.Where(u => u.DisplayName.ToLower().Contains(q) || u.Username.ToLower().Contains(q));

        var users = await known.OrderBy(u => u.DisplayName).Take(40).ToListAsync();
        return users.Select(ToContact).ToList();
    }

    public async Task<UserDto?> FindContactByUsernameAsync(int currentUserId, string username)
    {
        var normalized = ContactCodes.NormalizeUsername(username);
        if (normalized == null) return null;
        var user = await _context.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Username == normalized && u.Id != currentUserId);
        return user == null ? null : ToContact(user);
    }

    UserDto ToContact(User user) => new()
    {
        Id = user.Id,
        Username = user.Username,
        DisplayName = user.DisplayName,
        AvatarUrl = AvatarAppearance.ForUser(user),
        About = user.About,
        IsOnline = _presenceService.IsUserOnline(user.Id)
    };
}
