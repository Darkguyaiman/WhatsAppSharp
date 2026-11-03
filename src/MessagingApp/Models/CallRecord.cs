using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class CallRecord
{
    [MaxLength(32)] public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int ConversationId { get; set; }
    public int CallerId { get; set; }
    public int RecipientId { get; set; }
    public bool Video { get; set; }
    [MaxLength(20)] public string State { get; set; } = "ringing";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? AnsweredAt { get; set; }
    public DateTime? EndedAt { get; set; }
}
