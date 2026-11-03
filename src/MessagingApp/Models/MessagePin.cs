namespace MessagingApp.Models;

public class MessagePin
{
    public int MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public int ConversationId { get; set; }
    public int PinnedByUserId { get; set; }
    public DateTime ExpiresAt { get; set; }
}
