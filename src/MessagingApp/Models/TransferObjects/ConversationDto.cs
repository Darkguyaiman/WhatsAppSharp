namespace MessagingApp.Models;

public class ConversationDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public bool IsGroup { get; set; }
    public string MemberNames { get; set; } = string.Empty;
    public string AvatarUrl { get; set; } = string.Empty;
    public int? OtherUserId { get; set; }
    public string? OtherUserAbout { get; set; }
    public bool IsOnline { get; set; }
    public string? LastMessageContent { get; set; }
    public DateTime? LastMessageTimestamp { get; set; }
    public MessageType? LastMessageType { get; set; }
    public int? LastMessageSenderId { get; set; }
    public bool LastMessageIsRead { get; set; }
    public int UnreadCount { get; set; }
}
