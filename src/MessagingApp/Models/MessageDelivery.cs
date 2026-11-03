namespace MessagingApp.Models;

public sealed class MessageDelivery
{
    public int MessageId { get; set; }
    public Message Message { get; set; } = null!;
    public int UserId { get; set; }
    public DateTime DeliveredAt { get; set; }
}
