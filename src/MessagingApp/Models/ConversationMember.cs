namespace MessagingApp.Models;

public class ConversationMember
{
    public int Id { get; set; }

    public int ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    public int? LastReadMessageId { get; set; }
    public DateTime? LastReadAt { get; set; }

    public bool IsAdmin { get; set; } = false;
}
