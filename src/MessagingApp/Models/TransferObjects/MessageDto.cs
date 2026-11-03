namespace MessagingApp.Models;

public class MessageDto
{
    public MessageDto ForUser(int userId, MessageUserState? state = null, bool isAdmin = false)
    {
        var result = (MessageDto)MemberwiseClone();
        result.IsMine = SenderId == userId;
        result.IsStarred = state?.IsStarred == true;
        result.Note = state?.Note;
        result.CanDeleteForEveryone = !IsDeleted && (SenderId == userId || isAdmin);
        result.Reactions = Reactions.Select(r => new ReactionSummaryDto
        {
            Emoji = r.Emoji, Count = r.Count, UserNames = r.UserNames,
            HasReacted = r.UserIds.Contains(userId)
        }).ToList();
        return result;
    }
    public int Id { get; set; }
    public int ConversationId { get; set; }
    public int SenderId { get; set; }
    public string SenderName { get; set; } = string.Empty;
    public string SenderAvatarUrl { get; set; } = string.Empty;
    public string? Content { get; set; }
    public MessageType Type { get; set; }
    public string? AttachmentUrl { get; set; }
    public string? AttachmentName { get; set; }
    public long? AttachmentSize { get; set; }
    public ReplyDto? ReplyTo { get; set; }
    public bool IsEdited { get; set; }
    public bool IsDeleted { get; set; }
    public bool IsForwarded { get; set; }
    public bool IsStarred { get; set; }
    public bool IsPinned { get; set; }
    public bool CanDeleteForEveryone { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsMine { get; set; }
    public string ReadStatus { get; set; } = "sent"; // "sent", "delivered", "read"
    public List<ReactionSummaryDto> Reactions { get; set; } = new();
}
