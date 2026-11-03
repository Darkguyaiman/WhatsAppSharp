using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class User
{
    public int Id { get; set; }

    [Required]
    [MaxLength(50)]
    public string Username { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    [MaxLength(255)]
    public string? GoogleSubject { get; set; }

    [Required]
    [MaxLength(100)]
    public string DisplayName { get; set; } = string.Empty;

    [MaxLength(255)]
    public string? AvatarUrl { get; set; }

    [MaxLength(7)]
    public string AvatarColor { get; set; } = AvatarAppearance.RandomColor();

    [MaxLength(255)]
    public string? About { get; set; } = "Hey there! I am using WhatsAppSharp.";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    public ICollection<ConversationMember> Memberships { get; set; } = new List<ConversationMember>();
    public ICollection<Message> Messages { get; set; } = new List<Message>();
    public ICollection<MessageReaction> Reactions { get; set; } = new List<MessageReaction>();
    public ICollection<MessageRead> Reads { get; set; } = new List<MessageRead>();
}
