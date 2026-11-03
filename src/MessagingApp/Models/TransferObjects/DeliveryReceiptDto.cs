namespace MessagingApp.Models;

public sealed class DeliveryReceiptDto
{
    public int MessageId { get; set; }
    public int ConversationId { get; set; }
    public int SenderId { get; set; }
    public DateTime DeliveredAt { get; set; }
}
