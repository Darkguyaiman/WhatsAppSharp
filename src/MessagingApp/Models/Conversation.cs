using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class Conversation
{
    public int Id { get; set; }

    [MaxLength(100)]
    public string? Title { get; set; }

    public bool IsGroup { get; set; } = false;
    public int? CommunityId { get; set; }
    public Community? Community { get; set; }
    public bool IsAnnouncement { get; set; }

    [MaxLength(7)]
    public string AvatarColor { get; set; } = AvatarAppearance.RandomColor();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ConversationMember> Members { get; set; } = new List<ConversationMember>();
    public ICollection<Message> Messages { get; set; } = new List<Message>();
}
