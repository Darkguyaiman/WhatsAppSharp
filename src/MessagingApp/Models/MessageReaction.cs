using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class MessageReaction
{
    public int Id { get; set; }

    public int MessageId { get; set; }
    public Message Message { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    [Required]
    [MaxLength(64)]
    public string Emoji { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
