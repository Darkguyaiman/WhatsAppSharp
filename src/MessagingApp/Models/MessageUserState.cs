namespace MessagingApp.Models;

// Private message actions belong to an account, never the shared message row.
public class MessageUserState
{
    public int MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public int UserId { get; set; }
    public bool IsHidden { get; set; }
    public bool IsStarred { get; set; }
    public string? Note { get; set; }
}
