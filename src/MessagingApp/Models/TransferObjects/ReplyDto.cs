namespace MessagingApp.Models;

public class ReplyDto
{
    public int Id { get; set; }
    public string SenderName { get; set; } = string.Empty;
    public string? Content { get; set; }
    public MessageType Type { get; set; }
}
